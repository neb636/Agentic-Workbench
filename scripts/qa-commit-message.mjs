/* global setTimeout, window */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { assertQaWindowVisibility, qaEnvironment } from "./qa-environment.mjs";

// QA inventory: the Default CLI setting (lists every agent, disables a missing one, persists across restart, routes the run) and
// generating a commit message (fills the box, in-progress state, no duplicate sends, draft protection, repeat limit).
// Runs against a deterministic fake CLI; no model calls.
const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-commit-message-qa-")));
const repo = join(directory, "repo");
const executable = join(directory, "fixture-cli");
const oneShots = join(directory, "one-shots.jsonl");
const shots = process.env.QA_SCREENSHOT_DIR ?? directory;
await mkdir(shots, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
await mkdir(repo);
execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
git("config", "user.email", "qa@example.com");
git("config", "user.name", "QA");
await writeFile(join(repo, "tracked.txt"), "one\n");
git("add", ".");
git("commit", "--quiet", "-m", "initial");
await writeFile(join(repo, "tracked.txt"), "two\n");
await writeFile(join(repo, "notes.md"), "# Notes from QA\n");
await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve("scripts/fixtures/composer-cli.mjs"))} "$@"\n`, { mode: 0o755 });
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Commit QA", path: repo, activeViewId: "agent", views: [{ id: "agent", workspaceId: "qa", type: "agent", title: "Untitled", state: {} }] }],
  activeWorkspaceId: "qa", personas: [], instructionOptions: [], layout: { rightPanel: "source-control", rightCollapsed: false, leftCollapsed: false },
}));

const sent = () => existsSync(oneShots) ? readFileSync(oneShots, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
let app;
let page;
try {
  const launch = async ({ claude = join(directory, "missing-claude") } = {}) => {
    app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CODEX_PATH: executable,
      WORKBENCH_CLAUDE_PATH: claude, COMPOSER_QA_ONE_SHOTS: oneShots }) });
    const window = await app.firstWindow();
    await assertQaWindowVisibility(app);
    window.setDefaultTimeout(10_000);
    return window;
  };
  page = await launch();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const openSettings = async () => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "General" }).waitFor();
  };
  const defaultCli = () => page.getByRole("button", { name: /Default CLI/ });

  // Default CLI: every agent listed, the one that isn't installed can't be chosen.
  await openSettings();
  assert.match(await defaultCli().innerText(), /Codex/, "with nothing chosen, the first installed CLI shows");
  await defaultCli().click();
  const codexOption = page.getByRole("option", { name: "Codex" });
  const claudeOption = page.getByRole("option", { name: "Claude Code" });
  await codexOption.waitFor();
  assert.equal(await claudeOption.getAttribute("aria-disabled"), "true");
  assert.match(await claudeOption.innerText(), /Not installed/);
  await page.screenshot({ path: join(shots, "default-cli.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction(() => !document.querySelector(".wb-modal-overlay"));

  // Generating: the box is locked while it runs, then holds the cleaned-up message.
  const box = page.getByRole("textbox", { name: "Commit message" });
  const generate = page.getByRole("button", { name: "Generate commit message with Codex" });
  const commit = page.getByRole("button", { name: "Commit 2 changes" });
  await generate.waitFor();
  await page.screenshot({ path: join(shots, "sidebar-idle.png") });
  await box.fill("draft to keep commit enabled");
  await box.fill("");
  await generate.click();
  assert.equal(await box.getAttribute("readonly"), "");
  assert.equal(await commit.isDisabled(), true);
  assert.equal(await generate.isDisabled(), true);
  await page.screenshot({ path: join(shots, "sidebar-generating.png") });
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Commit message"]')?.value === "Add QA notes");
  assert.equal(await box.getAttribute("readonly"), null);
  assert.equal(await commit.isDisabled(), false);
  await page.screenshot({ path: join(shots, "sidebar-generated.png") });
  assert.equal(sent().length, 1);
  const first = sent()[0];
  assert.deepEqual(first.argv.slice(0, 2), ["exec", "--ephemeral"]);
  assert.equal(first.argv[first.argv.indexOf("--model") + 1], "gpt-6-luna");
  assert.ok(first.argv.includes('model_reasoning_effort="medium"'));
  assert.equal(first.cwd, join(directory, "internal-ai"));
  assert.match(first.prompt, /notes\.md/);
  assert.match(first.prompt, /^\+# Notes from QA$/m);
  assert.equal(git("status", "--porcelain"), " M tracked.txt\n?? notes.md\n", "generating leaves the index alone");

  // A hook or double call firing while one is running gets the same answer from one send.
  const answers = await page.evaluate((root) => Promise.all([1, 2, 3].map(() => window.workbench.sourceControl.generateCommitMessage(root, "codex.cli"))), repo);
  assert.deepEqual(answers, Array(3).fill("Add QA notes"));
  assert.equal(sent().length, 2);

  // A message typed by hand is only replaced on confirmation, and declining sends nothing.
  await box.fill("My own words");
  await generate.click();
  const replace = page.getByRole("alertdialog", { name: "Replace your commit message?" });
  await replace.getByRole("button", { name: "Cancel" }).click();
  assert.equal(await box.inputValue(), "My own words");
  assert.equal(sent().length, 2);
  await page.screenshot({ path: join(shots, "sidebar-draft-kept.png") });
  await generate.click();
  await replace.getByRole("button", { name: "Replace" }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Commit message"]')?.value === "Add QA notes");
  assert.equal(sent().length, 3);

  // A fourth identical request is refused without running the CLI, with no prompt since the text was generated.
  await generate.click();
  await page.getByRole("alert").filter({ hasText: "already sent 3 times" }).waitFor();
  assert.match(await page.getByRole("alert").filter({ hasText: "already sent" }).innerText(), /Try again in \d+ minutes?\./);
  assert.equal(sent().length, 3);
  assert.equal(await box.inputValue(), "Add QA notes");
  await page.screenshot({ path: join(shots, "sidebar-limit.png") });

  // With both installed, a chosen CLI is saved, survives a restart, and is the one that runs.
  await app.close();
  page = await launch({ claude: executable });
  page.on("pageerror", (error) => errors.push(String(error)));
  await openSettings();
  await defaultCli().click();
  await page.getByRole("option", { name: "Claude Code" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  const saved = () => JSON.parse(readFileSync(join(directory, "workbench-state.json"), "utf8")).defaultAgentProviderId;
  for (let i = 0; i < 40 && !saved(); i += 1) await new Promise((done) => setTimeout(done, 100));
  assert.equal(saved(), "claude.cli");
  await app.close();
  page = await launch({ claude: executable });
  page.on("pageerror", (error) => errors.push(String(error)));
  await openSettings();
  assert.match(await defaultCli().innerText(), /Claude Code/);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Generate commit message with Claude Code" }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Commit message"]')?.value === "Add QA notes");
  assert.equal(sent().length, 4);
  const claudeRun = sent()[3];
  assert.deepEqual(claudeRun.argv.slice(0, 2), ["-p", "--safe-mode"]);
  assert.equal(claudeRun.argv[claudeRun.argv.indexOf("--model") + 1], "haiku");
  assert.equal(claudeRun.argv[claudeRun.argv.indexOf("--effort") + 1], "medium");
  assert.deepEqual(errors, []);
  console.log(`Commit message QA passed. Screenshots: ${shots}`);
} catch (error) {
  await page?.screenshot({ path: join(shots, "failure.png") }).catch(() => undefined);
  console.error(`One-shot runs: ${sent().length}. Errors shown: ${await page?.locator(".agent-error").allInnerTexts().catch(() => "unknown")}`);
  throw error;
} finally {
  await app?.close().catch(() => undefined);
}
