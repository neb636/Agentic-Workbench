/* global ClipboardEvent, DataTransfer, DragEvent, File */
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { assertQaWindowVisibility, qaEnvironment } from "./qa-environment.mjs";

// QA inventory: shell layout and sidebar sessions, launcher with a new worktree, Persona and
// Instructions menus (including a conditional option and a migrated instruction), composed
// prompt order, title from the first prompt, quote/preview/recall, attachments (picker, drop, paste,
// limit, restart, cleanup), resuming after a restart (the tab the app opens on resumes, others wait for a click; draft and attachments stay),
// uncertain delivery handoff, Plan chosen before the CLI starts,
// Files tree and read-only viewer, Source control commit, Active views, tab overflow, and
// layout persistence across restart. Runs against a deterministic fake CLI; no model calls.
const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-composer-qa-")));
const repo = join(directory, "repo");
const executable = join(directory, "fixture-cli");
const log = join(directory, "prompts.jsonl");
const launchLog = join(directory, "launches.jsonl");
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
await mkdir(join(repo, "src"), { recursive: true });
execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
git("config", "user.email", "qa@example.com");
git("config", "user.name", "QA");
await writeFile(join(repo, "tracked.txt"), "one\n");
await writeFile(join(repo, "src", "app.ts"), "export const answer: number = 42;\n// The workbench renders this file read-only.\n");
git("add", ".");
git("commit", "--quiet", "-m", "initial");
// Remote-tracking refs without a reachable remote: the picker lists them and the fetch before creating fails quietly.
const originBranch = (name) => git("update-ref", `refs/remotes/origin/${name}`, "HEAD");
originBranch("main");
originBranch("feature/qa-base");
originBranch("feature/other");
git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
git("branch", "local/qa-branch");
await writeFile(join(repo, "tracked.txt"), "two\n");
await writeFile(join(repo, "notes.md"), "# Notes\n");
await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve("scripts/fixtures/composer-cli.mjs"))} "$@"\n`, { mode: 0o755 });
// Written in the pre-prompt-options format, so loading also exercises the migration.
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Composer QA", path: repo, activeViewId: "agent", views: [
    { id: "agent", workspaceId: "qa", type: "agent", title: "Untitled", state: { autoTitle: true } },
    { id: "other", workspaceId: "qa", type: "agent", title: "Other", state: { providerId: "codex.cli" } },
    { id: "plan-first", workspaceId: "qa", type: "agent", title: "Plan first", state: { providerId: "codex.cli", runIn: { kind: "checkout" } } },
    { id: "plan-held", workspaceId: "qa", type: "agent", title: "Plan held", state: { providerId: "codex.cli", runIn: { kind: "checkout" } } },
  ] }], activeWorkspaceId: "qa",
  personas: [{ id: "p", name: "Concise", instructions: "Be concise.", description: "Brief answers", scope: "global" }],
  selectedPersonaByWorkspace: { qa: "p" },
  appendedInstructions: [{ id: "i", workspaceId: "qa", content: "Explain the tradeoffs.", enabled: true }],
}));

const OPEN_PR = "When the change is ready, open a draft pull request that summarizes the change and how it was verified.";
const WRITE_TESTS = "Add or update unit tests that cover this change, and run them before finishing.";
let app;
try {
  const launch = async () => {
    app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CODEX_PATH: executable,
      WORKBENCH_CLAUDE_PATH: join(directory, "missing-claude"), COMPOSER_QA_LOG: log, COMPOSER_QA_LAUNCHES: launchLog }) });
    const window = await app.firstWindow();
    await assertQaWindowVisibility(app);
    window.setDefaultTimeout(10_000);
    return window;
  };
  let page = await launch();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const shot = async (name) => {
    await page.waitForTimeout(150);
    const bytes = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const [width, height] = win.getContentSize();
      return (await win.capturePage()).resize({ width, height }).toPNG();
    });
    await writeFile(join(directory, `${name}.png`), Buffer.from(bytes));
  };
  const prompts = async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const launches = async () => (await readFile(launchLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const prompt = () => page.getByRole("textbox", { name: "Prompt", exact: true });
  const waitFeedback = (value) => page.waitForFunction((text) => document.querySelector(".composer-feedback")?.textContent.includes(text), value)
    .catch(async (error) => { throw new Error(`Waiting for "${value}", the composer says "${await page.locator(".composer-feedback").first().textContent().catch(() => "?")}": ${error.message}`); });
  const sidebar = page.getByRole("treegrid", { name: "Workspaces" });

  // Shell: three panes, nested sessions, and the launcher for a session that has not started.
  await sidebar.getByRole("row", { name: /Composer QA/ }).waitFor();
  assert.match(await sidebar.getByRole("row", { name: /Untitled/ }).innerText(), /Setup/);
  await page.getByRole("heading", { name: "Start a new session" }).waitFor();
  assert.match(await page.locator(".harness-option").filter({ hasText: "Claude Code" }).innerText(), /Not installed/);
  await page.getByRole("radio", { name: /Codex/ }).waitFor();
  // A new worktree is the default, created from origin's default branch; the picker searches the other branches.
  await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent.includes("New worktree"));
  await page.getByRole("button", { name: "Create from: origin/main" }).click();
  for (const group of ["Remote", "Local"]) await page.getByRole("group", { name: group }).waitFor();
  await page.getByRole("option", { name: "local/qa-branch" }).waitFor();
  await shot("create-from-open");
  await page.getByRole("searchbox", { name: "Search branches" }).fill("qa-b");
  await page.getByRole("option", { name: "origin/feature/qa-base" }).waitFor();
  assert.equal(await page.getByRole("option", { name: "origin/feature/other" }).count(), 0);
  await shot("create-from-search");
  await page.keyboard.press("Enter"); // The first match is already active.
  await page.getByRole("button", { name: "Create from: origin/feature/qa-base" }).waitFor();
  await page.getByRole("textbox", { name: "Branch" }).fill("local/qa-branch");
  await page.getByText("A branch with this name already exists.").waitFor();
  await page.getByRole("textbox", { name: "Branch" }).fill("wb/qa-task");
  assert.match(await page.locator(".launcher-location").innerText(), /repo-worktrees\/wb-qa-task$/);
  await shot("launcher");

  // Persona menu: a list select from stored personas, prepended, cleared after send.
  await page.getByRole("button", { name: "Persona", exact: true }).click();
  await page.getByRole("option", { name: /Concise/ }).click();
  await shot("persona-menu");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Persona: Concise" }).waitFor();

  // Instructions menu: built-ins, the migrated instruction, and a conditional text option.
  await page.getByRole("button", { name: "Instructions: 1" }).click();
  assert.equal(await page.getByRole("switch", { name: "Explain the tradeoffs." }).isChecked(), true);
  assert.equal(await page.getByRole("textbox", { name: "Test focus" }).count(), 0);
  await page.getByText("Open PR", { exact: true }).click();
  assert.equal(await page.getByRole("switch", { name: "Open PR" }).isChecked(), true);
  await page.getByRole("radio", { name: "Write new" }).click();
  await page.getByRole("textbox", { name: "Test focus" }).fill("error handling");
  await shot("instructions-menu");
  await page.keyboard.press("Escape");

  // No model is chosen for a new session, so neither Send nor Start session can go yet.
  await prompt().fill("Waiting for a model");
  await page.getByRole("button", { name: /Select model/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Send prompt", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Start session", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Resume previous…", exact: true }).isDisabled(), false);
  await waitFeedback("Choose a model to start.");
  await shot("no-model-selected");

  // Model and effort are launch arguments of the new conversation. The list is the one the CLI just reported.
  await page.getByRole("button", { name: /Model/ }).click();
  await page.getByRole("option", { name: "qa-fresh-model", exact: true }).waitFor();
  assert.equal(await page.getByRole("option", { name: /CLI default/ }).count(), 0);
  assert.equal(await page.getByRole("option", { name: "qa-hidden-model", exact: true }).count(), 0);
  await shot("model-list");
  await page.getByRole("option", { name: "gpt-6-astra", exact: true }).click();
  await page.getByRole("button", { name: /Effort/ }).click();
  await page.getByRole("option", { name: "high", exact: true }).click();

  // First send creates the worktree, starts the CLI, waits for its input, and delivers the composed prompt.
  await prompt().fill("Explain this failure.");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await waitFeedback("Prompt handed");
  const [first] = await prompts();
  assert.equal(first.prompt, ["Be concise.", "Explain this failure.", OPEN_PR, WRITE_TESTS, "Focus the new tests on error handling.", "Explain the tradeoffs."].join("\n\n"));
  assert.equal(first.cwd, join(directory, "repo-worktrees", "wb-qa-task"));
  assert.equal(first.model, "gpt-6-astra");
  assert.equal(first.effort, "high");
  assert.equal(git("worktree", "list").includes("wb-qa-task"), true);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: first.cwd, encoding: "utf8" }), git("rev-parse", "origin/feature/qa-base"));
  assert.equal(await prompt().inputValue(), "");
  await page.getByRole("button", { name: "Persona", exact: true }).waitFor();
  await page.getByRole("button", { name: "Instructions: 4" }).waitFor();
  await page.getByRole("tab", { name: "Explain this failure." }).waitFor();
  assert.match(await sidebar.getByRole("row", { name: /Explain this failure\./ }).innerText(), /Ready · Codex/);
  await shot("session");

  // Composer tools: quote terminal output, preview placement, recall a previous prompt.
  const row = page.locator(".xterm-rows > div").filter({ hasText: "ERROR: Connection refused" });
  await row.click({ clickCount: 3 });
  await page.getByRole("button", { name: "Add to prompt" }).click();
  await prompt().fill("Second prompt");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = await page.getByRole("dialog", { name: "Prompt preview" }).locator("pre").innerText();
  assert.match(preview, /^Terminal selection 1:\n> ERROR: Connection refused/);
  assert.match(preview, /Second prompt\n\nWhen the change is ready/);
  assert(preview.endsWith("Explain the tradeoffs."));
  await shot("preview");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Activity" }).click();
  await page.getByRole("button", { name: "Use as draft" }).click();
  assert.equal(await prompt().inputValue(), "Explain this failure.");

  // Uncertain delivery keeps the draft and offers the terminal handoff.
  await page.getByRole("button", { name: "Remove terminal selection 1" }).click().catch(() => undefined);
  await prompt().fill("UNCERTAIN");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".session-pill")?.textContent.includes("Needs input"));
  await page.getByRole("button", { name: "Focus terminal" }).waitFor();
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+c");
  await page.waitForFunction(() => document.querySelector(".session-pill")?.textContent.includes("Ready"));

  // Changing the model after a prompt offers a restart that keeps the draft.
  await page.getByRole("button", { name: /Model/ }).click();
  await page.getByRole("option", { name: "gpt-6-luna", exact: true }).click();
  await waitFeedback("Restart to use gpt-6-luna high");
  await shot("restart-model");
  await page.getByRole("button", { name: "Restart with gpt-6-luna high" }).click();
  await prompt().fill("After the restart");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await waitFeedback("Prompt handed");
  const restarted = (await prompts()).at(-1);
  assert.match(restarted.prompt, /After the restart/);
  assert.equal(restarted.model, "gpt-6-luna");
  assert.equal(restarted.effort, "high");

  // Attachments: the picker, a drop and a pasted screenshot all become tiles; the prompt carries their stored paths.
  const picture = async (name, from, to) => {
    const data = await page.evaluate(([start, end]) => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 480, height: 320 });
      const context = canvas.getContext("2d");
      const fill = context.createLinearGradient(0, 0, 480, 320);
      fill.addColorStop(0, start); fill.addColorStop(1, end);
      context.fillStyle = fill; context.fillRect(0, 0, 480, 320);
      return canvas.toDataURL("image/png").split(",")[1];
    }, [from, to]);
    const file = join(directory, name);
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  };
  const tiles = page.locator(".attachment-tile");
  const firstPicture = await picture("reference one.png", "#f472d0", "#38e1dc");
  const notes = join(directory, "requirements.md");
  await writeFile(notes, "# Requirements\n");
  await page.locator(".composer-box input[type=file]").setInputFiles([firstPicture, notes]);
  await tiles.nth(1).waitFor();
  await page.locator('.attachment-tile img[alt="reference one.png"]').waitFor();
  assert.equal(await tiles.nth(1).locator("img").count(), 0);
  assert.match(await tiles.nth(1).innerText(), /requirements\s+MD/);
  const synthesized = (type) => page.evaluate((eventType) => {
    const box = document.querySelector(".composer-box");
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([137, 80, 78, 71])], eventType === "drop" ? "dropped.txt" : "image.png", { type: eventType === "drop" ? "text/plain" : "image/png" }));
    if (eventType === "paste") box.querySelector("textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    else box.dispatchEvent(new DragEvent(eventType, { dataTransfer: data, bubbles: true, cancelable: true }));
  }, type);
  await synthesized("dragover");
  await page.getByText("Drop to attach").waitFor();
  await page.waitForTimeout(500);
  await shot("attachments-drop");
  await synthesized("drop");
  await page.getByText("Drop to attach").waitFor({ state: "detached" });
  await tiles.nth(2).waitFor();
  await synthesized("paste");
  await tiles.nth(3).waitFor();
  await page.getByRole("button", { name: "Remove dropped.txt" }).click();
  await page.getByRole("button", { name: "Remove image.png" }).click();
  assert.equal(await tiles.count(), 2);
  await prompt().fill("Build this from the references");
  await page.getByRole("button", { name: "Preview" }).click();
  const attachedPreview = await page.getByRole("dialog", { name: "Prompt preview" }).locator("pre").innerText();
  assert.match(attachedPreview, /^Attached files \(read them from these paths\):\n- .*\/attachments\/.*\/reference one\.png\n- .*\/requirements\.md\n\nBuild this/);
  await page.keyboard.press("Escape");
  await shot("attachments");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".attachment-tile"));
  const attachedPrompt = (await prompts()).at(-1).prompt;
  const storedPicture = attachedPrompt.match(/^- (.*reference one\.png)$/m)[1];
  assert.deepEqual(await readFile(storedPicture), await readFile(firstPicture));
  assert(storedPicture.startsWith(join(directory, "attachments")));

  // A prompt holds ten attachments; the tiles scroll instead of growing the composer. One stays for the restart below.
  const manyFiles = [firstPicture];
  for (let index = 1; index <= 11; index += 1) { manyFiles.push(join(directory, `file-${index}.csv`)); await writeFile(manyFiles[index], "a,b\n"); }
  await page.locator(".composer-box input[type=file]").setInputFiles(manyFiles);
  await waitFeedback("A prompt can hold 10 attachments.");
  assert.equal(await tiles.count(), 10);
  assert.equal(await page.getByRole("button", { name: "Attach files" }).isDisabled(), true);
  await page.waitForTimeout(400);
  await shot("attachments-full");
  for (let index = 0; index < 9; index += 1) await page.locator(".attachment-remove").last().click();
  assert.equal(await tiles.count(), 1);

  // Plan before the CLI exists: Send starts it, waits for startup, enters Plan mode (the fixture shows it late), then delivers.
  const chooseModel = async () => {
    await page.getByRole("button", { name: /Select model/ }).click();
    await page.getByRole("option", { name: "gpt-6-luna", exact: true }).click();
  };
  const choosePlan = async () => {
    await page.locator(".mode-select button").click();
    await page.getByRole("option", { name: /^Plan/ }).click();
  };
  await page.getByRole("tab", { name: "Plan first" }).click();
  await page.getByRole("heading", { name: "Start a new session" }).waitFor();
  await chooseModel();
  await choosePlan();
  await prompt().fill("Plan the first step");
  await shot("plan-before-start");
  await page.getByRole("button", { name: "Send for planning", exact: true }).click();
  await waitFeedback("Planning request handed");
  const planned = (await prompts()).at(-1);
  assert.match(planned.prompt, /Plan the first step/);
  assert.equal(planned.plan, true);
  await page.locator(".xterm-rows").getByText("Plan mode").waitFor();
  await shot("plan-after-start");
  // The composer returns to Code after a send, and sending with Code leaves Plan mode.
  await prompt().fill("Now build it");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".composer-feedback")?.textContent.includes("Prompt handed"));
  assert.equal((await prompts()).at(-1).plan, false);
  // A new conversation is a new session: the model has to be chosen again.
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("heading", { name: "Start a new session" }).waitFor();
  await page.getByRole("button", { name: /Select model/ }).waitFor();
  await prompt().fill("Needs a model again");
  assert.equal(await page.getByRole("button", { name: "Send prompt", exact: true }).isDisabled(), true);
  await prompt().fill("");

  // A first Plan prompt waits out startup work instead of being refused.
  await page.getByRole("tab", { name: "Plan held" }).click();
  await chooseModel();
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".session-pill")?.textContent.includes("Ready"));
  await choosePlan();
  await prompt().fill("Plan after startup work");
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+b");
  await page.waitForFunction(() => /working/i.test(document.querySelector(".session-pill")?.textContent ?? ""));
  await page.getByRole("button", { name: "Send for planning", exact: true }).click();
  await waitFeedback("Waiting for the CLI to be ready");
  await waitFeedback("Planning request handed");
  assert.equal((await prompts()).at(-1).plan, true);
  await page.getByRole("tab", { name: "Explain this failure." }).click();

  // Files: lazy tree, a preview tab you can edit and save (⌘S), search by name.
  await page.getByRole("radio", { name: "Files" }).click();
  const tree = page.getByRole("treegrid", { name: "Files in Composer QA" });
  await tree.getByRole("row", { name: "src" }).waitFor();
  await tree.getByRole("button", { name: "Expand src" }).click();
  await tree.getByRole("row", { name: "app.ts" }).click();
  await page.getByRole("tab", { name: "app.ts" }).waitFor();
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("export const answer"));
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.type("// saved from QA\n");
  await page.locator(".view-tab .dirty-dot").waitFor();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  await page.waitForFunction(() => document.querySelector(".code-footer")?.textContent.includes("Saved"));
  assert.match(await readFile(join(repo, "src", "app.ts"), "utf8"), /saved from QA/);
  await page.getByRole("searchbox", { name: "Find files" }).fill("notes");
  await page.getByRole("grid", { name: "Matching files" }).getByRole("row", { name: /notes\.md/ }).waitFor();
  await page.getByRole("searchbox", { name: "Find files" }).fill("");
  await shot("file-view");

  // Source control for the workspace checkout: list changes, commit them all.
  await page.getByRole("radio", { name: "Source control" }).click();
  const changes = page.getByRole("grid", { name: "Changes" });
  await changes.getByRole("row", { name: /tracked\.txt/ }).waitFor();
  assert.match(await changes.getByRole("row", { name: /notes\.md/ }).innerText(), /U/);
  // A change opens as a diff against the last commit.
  await changes.getByRole("row", { name: /tracked\.txt/ }).click();
  await page.getByRole("tab", { name: "tracked.txt" }).waitFor();
  await page.waitForFunction(() => document.querySelector(".code-footer")?.textContent.includes("diff vs last commit"));
  await shot("source-control");
  await page.getByRole("textbox", { name: "Commit message" }).fill("QA commit");
  await page.getByRole("button", { name: "Commit 3 changes" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Commit", exact: true }).click();
  await page.getByText("No uncommitted changes.").waitFor();
  assert.equal(git("log", "-1", "--format=%s").trim(), "QA commit");

  // Active views panel and the tab overflow menu.
  await page.getByRole("radio", { name: "Active views" }).click();
  await page.getByRole("grid", { name: "Agent session" }).getByRole("row").first().waitFor();
  // The edited app.ts stays open; the tracked.txt diff is a preview tab.
  assert.equal(await page.getByRole("grid", { name: "File" }).getByRole("row").count(), 2);
  // Resuming stays in the checkout, where the CLI's earlier conversations are, even with a worktree as the default.
  await page.getByRole("tab", { name: "Other" }).click();
  await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent.includes("New worktree"));
  const worktrees = git("worktree", "list");
  await page.getByRole("button", { name: "Resume previous…" }).click();
  await page.locator(".terminal-card").waitFor();
  assert.equal(git("worktree", "list"), worktrees);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "Create view" }).click();
    await page.getByRole("menuitem", { name: /Agent session/ }).click();
  }
  await page.locator(".tab-overflow").waitFor();
  await page.locator(".tab-overflow").click();
  assert((await page.getByRole("menu", { name: "More views" }).getByRole("menuitem").count()) >= 1);
  await shot("tab-overflow");
  await page.keyboard.press("Escape");

  // Layout persists across restart.
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Show sidebar" }).waitFor();
  await page.waitForTimeout(400);
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("treegrid", { name: "Workspaces" }).getByRole("row", { name: /Explain this failure\./ }).click();
  await prompt().waitFor();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Show sidebar" }).waitFor();
  await page.waitForTimeout(400);
  // Typed right before quitting: the save on close has to catch it.
  await prompt().fill("Keep this draft");
  await app.close();
  let launchesBefore = (await launches()).length;
  // The CLI logs its launch a moment after the terminal appears; the pause also catches any launch that shouldn't happen.
  const settledLaunches = async (expected) => {
    for (let waited = 0; waited < 5000 && (await launches()).length < expected; waited += 100) await page.waitForTimeout(100);
    await page.waitForTimeout(600);
    assert.equal((await launches()).length, expected);
    return (await launches()).at(-1);
  };
  const assertResumed = (launched) => {
    assert.deepEqual(launched.argv.slice(0, 2), ["resume", "--last"]);
    assert.equal(launched.cwd, first.cwd);
    assert.equal(launched.argv.includes("--model"), false);
  };
  const restoredRow = () => page.getByRole("treegrid", { name: "Workspaces" }).getByRole("row", { name: /Explain this failure\./ });
  // Selected without a click (arrow keys), so the pane stays.
  const arrowToSaved = async () => {
    await page.getByRole("tab", { name: "Other" }).focus();
    await page.keyboard.press("ArrowLeft");
    await page.getByRole("heading", { name: "Resume this session" }).waitFor();
  };
  await mkdir(join(directory, "attachments", "closed-view"), { recursive: true });
  page = await launch();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  // The tab the app opens on resumes by itself, in its folder, with its composer intact; nothing else starts.
  await page.locator(".terminal-card").waitFor();
  assertResumed(await settledLaunches(launchesBefore + 1));
  assert.equal(await prompt().inputValue(), "Keep this draft");
  // A draft's attachment survives the restart; the folder of a view that no longer exists does not.
  await page.locator('.attachment-tile img[alt="reference one.png"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".attachment-tile img")?.naturalWidth > 0);
  assert.equal(await stat(join(directory, "attachments", "closed-view")).then(() => true, () => false), false);

  // A saved session that isn't the one the app opens on waits, with its composer intact, until it's clicked.
  await page.getByRole("tab", { name: "Other" }).click();
  await page.waitForTimeout(400);
  await app.close();
  launchesBefore = (await launches()).length;
  page = await launch();
  await page.getByRole("heading", { name: "Start a new session" }).waitFor();
  await restoredRow().waitFor();
  assert.match(await restoredRow().innerText(), /Resumable · Codex/);
  await settledLaunches(launchesBefore);
  await arrowToSaved();
  await page.locator('.attachment-tile img[alt="reference one.png"]').waitFor();
  assert.equal(await prompt().inputValue(), "Keep this draft");
  await settledLaunches(launchesBefore);
  await shot("resume-pane");
  await page.getByRole("tab", { name: "Explain this failure." }).locator(".view-tab-title").click();
  await page.locator(".terminal-card").waitFor();
  assertResumed(await settledLaunches(launchesBefore + 1));
  assert.equal(await prompt().inputValue(), "Keep this draft");

  // Sending from the resume pane continues the conversation too, instead of starting a new one.
  await page.getByRole("tab", { name: "Other" }).click();
  await page.waitForTimeout(400);
  await app.close();
  launchesBefore = (await launches()).length;
  page = await launch();
  await page.getByRole("heading", { name: "Start a new session" }).waitFor();
  await arrowToSaved();
  await prompt().fill("Sent while waiting to resume");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await waitFeedback("Prompt handed");
  assertResumed(await settledLaunches(launchesBefore + 1));
  assert.match((await prompts()).at(-1).prompt, /Sent while waiting to resume/);
  assert.equal(await page.locator(".attachment-tile").count(), 0);

  // A conversation the CLI can't reopen fails in the terminal; starting over from there keeps what was typed.
  await page.waitForTimeout(400);
  await prompt().fill("A different idea");
  await page.waitForTimeout(400);
  await app.close();
  await writeFile(`${log}.no-conversations`, "");
  page = await launch();
  await page.locator(".terminal-card").waitFor();
  await page.getByRole("button", { name: "Start new session" }).click();
  await page.getByRole("heading", { name: "Start a new session" }).waitFor();
  assert.equal(await prompt().inputValue(), "A different idea");
  console.log("Composer QA passed. Artifacts:", directory);
} finally { if (app) await app.close(); console.log("QA artifacts:", directory); }
