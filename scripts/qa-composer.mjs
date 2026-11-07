import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

// QA inventory: shell layout and the Work list with nested sessions, the restart card of a session that isn't running,
// the Instructions menu (including a conditional option and a migrated instruction), composed
// prompt order, title from the first prompt, quote/preview/recall, uncertain delivery handoff,
// the explorer (Files tree with search by name and inside files, a preview tab, editing and ⌘S, a diff, Changes and
// commit, Ship), a Game and a Feel tab sharing one game, tab overflow, and layout persistence across restart.
// Runs against a deterministic fake CLI; no model calls.
const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-composer-qa-")));
const repo = join(directory, "repo");
const executable = join(directory, "fixture-cli");
const log = join(directory, "prompts.jsonl");
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
await writeFile(join(repo, "tracked.txt"), "two\n");
await writeFile(join(repo, "notes.md"), "# Notes\n");
await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve("scripts/fixtures/composer-cli.mjs"))} "$@"\n`, { mode: 0o755 });
// Written in the pre-prompt-options format, so loading also exercises the migration.
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Composer QA", path: repo, activeViewId: "agent", views: [
    { id: "agent", workspaceId: "qa", type: "agent", title: "Untitled", state: { autoTitle: true } },
    { id: "other", workspaceId: "qa", type: "agent", title: "Other", state: { providerId: "codex.cli" } },
  ] }], activeWorkspaceId: "qa",
  appendedInstructions: [{ id: "i", workspaceId: "qa", content: "Explain the tradeoffs.", enabled: true }],
}));

const OPEN_PR = "When the change is ready, open a draft pull request that summarizes the change and how it was verified.";
const WRITE_TESTS = "Add or update unit tests that cover this change, and run them before finishing.";
let app;
try {
  const launch = async () => {
    app = await electron.launch({ args: ["."], env: { ...process.env, STUDIO_REPO_ROOT: repo, WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CODEX_PATH: executable,
      WORKBENCH_CLAUDE_PATH: join(directory, "missing-claude"), COMPOSER_QA_LOG: log } });
    const window = await app.firstWindow();
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
  const prompt = () => page.getByRole("textbox", { name: "Prompt", exact: true });
  const waitFeedback = (value) => page.waitForFunction((text) => document.querySelector(".composer-feedback")?.textContent.includes(text), value)
    .catch(async (error) => { throw new Error(`Waiting for "${value}", the composer says "${await page.locator(".composer-feedback").first().textContent().catch(() => "?")}": ${error.message}`); });
  const sidebar = page.getByRole("treegrid", { name: "Main checkout" });

  // Shell: work, the middle, the explorer; the main checkout with nested sessions. A saved session from before has no
  // CLI running: it shows the small restart card (new tabs start their CLI at once).
  await sidebar.getByRole("row", { name: /^main/ }).waitFor();
  assert.match(await sidebar.getByRole("row", { name: /Untitled/ }).innerText(), /Not running/);
  await page.getByRole("heading", { name: /Start an agent/ }).waitFor();
  assert.match(await page.getByRole("combobox", { name: "Coding CLI" }).innerText(), /Claude Code \(not installed\)/);
  assert.equal(await page.getByRole("radio", { name: "New worktree" }).count(), 0, "Run in and Location are gone");
  await page.getByRole("complementary", { name: "Explorer" }).waitFor();
  await shot("launcher");

  assert.equal(await page.getByRole("button", { name: "Persona", exact: true }).count(), 0, "Personas are dropped for now");

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

  await page.getByRole("button", { name: /Model/ }).click();
  await page.getByRole("option", { name: "gpt-6-astra", exact: true }).click();
  await page.getByRole("button", { name: /Effort/ }).click();
  await page.getByRole("option", { name: "high", exact: true }).click();

  // First send creates the worktree, starts the CLI, waits for its input, and delivers the composed prompt.
  await prompt().fill("Explain this failure.");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await waitFeedback("Prompt handed");
  const [first] = await prompts();
  assert.equal(first.prompt, ["Explain this failure.", OPEN_PR, WRITE_TESTS, "Focus the new tests on error handling.", "Explain the tradeoffs."].join("\n\n"));
  assert.equal(first.model, "gpt-6-astra");
  assert.equal(first.effort, "high");
  assert.equal(first.cwd, repo);
  assert.equal(await prompt().inputValue(), "");
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

  // Model and effort are launch arguments: changing them after a prompt offers a restart that keeps the draft.
  await page.getByRole("button", { name: /Model/ }).click();
  await page.getByRole("option", { name: "gpt-6-luna", exact: true }).click();
  await waitFeedback("Restart to use gpt-6-luna high");
  await shot("restart-model");
  await page.getByRole("button", { name: "Restart with gpt-6-luna high" }).click();
  await prompt().fill("After the restart");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await waitFeedback("Prompt handed");
  const restarted = (await prompts()).at(-1);
  assert.match(restarted.prompt, /^After the restart/);
  assert.equal(restarted.model, "gpt-6-luna");
  assert.equal(restarted.effort, "high");

  // 📎 this section and the prompt starters, from the composer toolbar.
  await prompt().fill("");
  await page.getByRole("button", { name: "Attach this game section" }).click();
  await page.locator(".composer-quotation summary").filter({ hasText: /^Game/ }).waitFor();
  await page.getByRole("button", { name: "Prompt starters" }).click();
  await page.getByRole("menuitem", { name: /^Fix/ }).click();
  assert.match(await prompt().inputValue(), /What's wrong: $/);
  assert.match((await page.evaluate(() => document.querySelector(".composer-quotation pre")?.textContent)) ?? "", /The game section Dad is looking at/);
  await shot("starter-fix");
  await prompt().fill("");

  // Files: the explorer's tree, search by name and inside files, a preview tab you can edit and save (⌘S), a diff.
  const explorer = page.getByRole("complementary", { name: "Explorer" });
  await explorer.getByRole("tab", { name: "Files" }).click();
  const tree = page.getByRole("treegrid", { name: "Files in Composer QA" });
  await tree.getByRole("row", { name: /^src/ }).waitFor();
  await page.getByRole("textbox", { name: "Find files" }).fill("notes");
  await page.getByRole("list", { name: "Matching files" }).getByRole("listitem").filter({ hasText: "notes.md" }).waitFor();
  await page.getByRole("textbox", { name: "Find files" }).fill("");
  await tree.getByRole("button", { name: "Expand src" }).click();
  await tree.getByRole("row", { name: /^app\.ts/ }).click();
  await page.locator(".view-tab.is-preview").filter({ hasText: "app.ts" }).waitFor();
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("export const answer"));
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("\n// Edited in Studio.");
  await page.locator(".view-tab:not(.is-preview)").filter({ hasText: "app.ts" }).waitFor();
  await page.getByRole("button", { name: "Close app.ts (unsaved)" }).waitFor();
  // Over to the agent and back: the unsaved edit is still there (the editor doesn't outlive its tab, its text does).
  await page.getByRole("tab", { name: "Explain this failure." }).click();
  await page.getByRole("tab", { name: "app.ts" }).click();
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Edited in Studio."));
  await page.getByRole("button", { name: "Close app.ts (unsaved)" }).waitFor();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+s");
  await page.getByRole("button", { name: "Close app.ts", exact: true }).waitFor();
  assert.match(await readFile(join(repo, "src", "app.ts"), "utf8"), /\/\/ Edited in Studio\.\n?$/);
  // An agent changes the file: a tab without edits reloads by itself.
  await writeFile(join(repo, "src", "app.ts"), "export const answer: number = 43;\n");
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("= 43"));
  await page.getByRole("button", { name: "⇄ Diff" }).click();
  await page.locator(".cm-changedLine, .cm-insertedLine").first().waitFor();
  await shot("file-diff");
  await page.getByRole("radio", { name: "Contents" }).click();
  await page.getByRole("textbox", { name: "Search inside files" }).fill("two");
  await page.locator(".search-line").filter({ hasText: "two" }).first().click();
  await page.getByRole("tab", { name: "tracked.txt" }).waitFor();
  await shot("file-view");

  // Changes, in the explorer: list changes, a click opens the diff, commit them all.
  await explorer.getByRole("tab", { name: /Changes/ }).click();
  const changes = page.getByRole("grid", { name: "Changes" });
  await changes.getByRole("row", { name: /tracked\.txt/ }).waitFor();
  assert.match(await changes.getByRole("row", { name: /notes\.md/ }).innerText(), /U/);
  await shot("source-control");
  await page.getByRole("textbox", { name: "Commit message" }).fill("QA commit");
  await page.getByRole("button", { name: "Commit 3 changes" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Commit", exact: true }).click();
  await page.getByText("No uncommitted changes.").waitFor();
  assert.equal(git("log", "-1", "--format=%s").trim(), "QA commit");

  // Ship, the explorer's last tab: Verify runs in this piece of work's Ship terminal tab; the QR opens.
  await explorer.getByRole("tab", { name: "Ship" }).click();
  await page.getByRole("region", { name: "Ship" }).getByRole("button", { name: /Verify/ }).click();
  await page.getByRole("tab", { name: "Ship: verify" }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll(".kept-view:not([hidden]) .xterm-rows")].some((rows) => rows.textContent.includes("npm run verify")));
  await page.getByRole("region", { name: "Ship" }).getByRole("button", { name: "QR" }).click();
  await page.getByRole("img", { name: /QR code for https:\/\/neb636\.github\.io\/Kaylee-Gamepack\// }).waitFor();
  await shot("ship");
  await page.getByRole("tab", { name: "Ship: verify" }).getByRole("button", { name: /Close/ }).click();

  // The game and a lab are tabs: one game for both (this fixture repo has no game, so it says why it can't start).
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("menuitem", { name: /^🎮 Game/ }).click();
  await page.getByRole("tab", { name: "Game" }).waitFor();
  await page.getByRole("region", { name: "Game" }).waitFor();
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("menuitem", { name: /Feel lab/ }).click();
  await page.getByRole("tab", { name: "Feel lab", selected: true }).waitFor();
  assert.equal(await page.locator("section.game-pane").count(), 1, "One game for every game tab");
  await page.getByRole("tab", { name: "Explain this failure." }).click();
  assert.equal(await page.locator("section.game-pane").count(), 1, "The game stays loaded behind the agent");
  assert.equal(await page.locator(".kept-view:has(section.game-pane)").getAttribute("hidden"), "");
  await shot("game-tabs");

  // The tab overflow menu.
  assert.equal(await page.getByRole("radio", { name: "Active views" }).count(), 0, "Active views is gone");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "New tab" }).click();
    await page.getByRole("menuitem", { name: /^Codex/ }).click();
  }
  await page.locator(".tab-overflow").waitFor();
  await page.locator(".tab-overflow").click();
  assert((await page.getByRole("menu", { name: "More tabs" }).getByRole("menuitem").count()) >= 1);
  await shot("tab-overflow");
  await page.keyboard.press("Escape");

  // Layout persists across restart.
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Show sidebar" }).waitFor();
  await page.waitForTimeout(400);
  assert.deepEqual(errors, []);
  await app.close();
  page = await launch();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("treegrid", { name: "Main checkout" }).getByRole("row", { name: /Explain this failure\./ }).waitFor();
  console.log("Composer QA passed. Artifacts:", directory);
} finally { if (app) await app.close(); console.log("QA artifacts:", directory); }
