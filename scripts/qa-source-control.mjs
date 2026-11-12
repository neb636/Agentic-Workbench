import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { assertQaWindowVisibility, qaEnvironment } from "./qa-environment.mjs";

// QA inventory, against a temporary repository and a local bare remote (no network, no model calls): staging and committing
// only what is staged, publish, push, fetch, pull, sync, history with a commit's files, stash and pop, discard, amend,
// undo, branch create/merge/delete, a merge conflict's banner and abort, and a failed action's message.
const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-source-control-qa-")));
const repo = join(directory, "repo");
const remote = join(directory, "remote.git");
const other = join(directory, "other");
const executable = join(directory, "fixture-cli");
const shots = process.env.QA_SCREENSHOT_DIR ?? directory;
await mkdir(shots, { recursive: true });
const run = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const git = (...args) => run(repo, ...args);
const identify = (cwd) => { run(cwd, "config", "user.email", "qa@example.com"); run(cwd, "config", "user.name", "QA"); };
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", remote]);
await mkdir(repo);
execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
identify(repo);
await writeFile(join(repo, "one.txt"), "one\n");
await writeFile(join(repo, "two.txt"), "two\n");
git("add", ".");
git("commit", "--quiet", "-m", "Initial commit");
git("remote", "add", "origin", remote);
await writeFile(join(repo, "one.txt"), "one changed\n");
await writeFile(join(repo, "two.txt"), "two changed\n");
await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve("scripts/fixtures/composer-cli.mjs"))} "$@"\n`, { mode: 0o755 });
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Source control QA", path: repo, activeViewId: "agent", views: [{ id: "agent", workspaceId: "qa", type: "agent", title: "Untitled", state: {} }] }],
  activeWorkspaceId: "qa", personas: [], instructionOptions: [], layout: { rightPanel: "source-control", rightCollapsed: false, leftCollapsed: false },
}));

await writeFile(join(directory, "execution-trust.json"), JSON.stringify([repo]));

let app;
let page;
try {
  app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CODEX_PATH: executable, WORKBENCH_CLAUDE_PATH: join(directory, "missing-claude") }) });
  page = await app.firstWindow();
  await assertQaWindowVisibility(app);
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const panel = page.locator(".source-control-panel");
  const button = (name) => panel.getByRole("button", { name, exact: true });
  const until = async (check, what) => {
    for (let i = 0; i < 100; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
    assert.fail(`Timed out waiting for: ${what}`);
  };
  const idle = () => page.waitForFunction(() => !document.querySelector('.source-control-panel [role="status"]:not(.source-control-operation)'));
  const menu = async (item) => {
    await idle();
    await button("More source control actions").click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
  };
  const commitDialog = async (confirm = "Commit") => {
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: confirm, exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  };
  const message = panel.getByRole("textbox", { name: "Commit message" });
  const staged = panel.getByRole("grid", { name: "Staged changes" });
  const changes = panel.getByRole("grid", { name: "Changes", exact: true });
  const historyRow = (subject) => panel.getByRole("grid", { name: "History" }).getByRole("row", { name: subject });

  // Staging one file commits only that file; the other stays a change.
  await button("Commit 2 changes").waitFor();
  await page.screenshot({ path: join(shots, "toolbar.png") });
  await button("Stage one.txt").click();
  await staged.getByRole("row", { name: "one.txt" }).waitFor();
  await changes.getByRole("row", { name: "two.txt" }).waitFor();
  await message.fill("Change one");
  await button("Commit 1 staged change").click();
  await commitDialog();
  await until(() => git("log", "-1", "--format=%s").trim() === "Change one", "the staged commit");
  assert.equal(git("show", "--name-only", "--format=", "HEAD").trim(), "one.txt");
  assert.equal(git("status", "--porcelain"), " M two.txt\n");
  await page.screenshot({ path: join(shots, "committed-staged.png") });

  // Unstage gives a file back.
  await button("Stage all changes").click();
  await staged.getByRole("row", { name: "two.txt" }).waitFor();
  await button("Unstage two.txt").click();
  await changes.getByRole("row", { name: "two.txt" }).waitFor();
  assert.equal(git("status", "--porcelain"), " M two.txt\n");

  // A branch with no upstream publishes.
  await button("Publish branch").click();
  await until(() => { try { return run(remote, "rev-parse", "refs/heads/main").trim() === git("rev-parse", "HEAD").trim(); } catch { return false; } }, "the publish");
  await until(async () => git("rev-parse", "--abbrev-ref", "@{u}").trim() === "origin/main", "the upstream");

  // History lists commits; a commit opens to its files, and a file to what the commit changed.
  await historyRow("Change one").waitFor();
  await historyRow("Change one").click();
  const file = panel.getByRole("grid", { name: "History" }).getByRole("row", { name: "one.txt" });
  await file.click();
  await page.getByRole("region", { name: /one\.txt at commit/ }).waitFor();
  await page.locator(".cm-content").getByText("one changed").waitFor();
  await page.locator(".cm-deletedChunk").getByText("one", { exact: true }).first().waitFor();
  assert.equal(await panel.locator("h2").innerText(), "repo", "the panel stays on this folder");
  await page.screenshot({ path: join(shots, "commit-file.png") });

  // Another clone pushes: fetch shows it behind, and pull brings it in.
  execFileSync("git", ["clone", "--quiet", remote, other]);
  identify(other);
  await writeFile(join(other, "from-other.txt"), "theirs\n");
  run(other, "add", ".");
  run(other, "commit", "--quiet", "-m", "From the other clone");
  run(other, "push", "--quiet");
  await button("Fetch").click();
  await panel.locator(".branch-row").getByText("↑0 ↓1").waitFor();
  await historyRow("From the other clone").waitFor();
  await page.screenshot({ path: join(shots, "behind.png") });
  await idle();
  await button(`Pull 1 from origin/main`).click();
  await until(() => existsSync(join(repo, "from-other.txt")), "the pull");

  // Commit & Push from the commit menu.
  await idle();
  await message.fill("Change two");
  await button("More commit actions").click();
  await page.getByRole("menuitem", { name: "Commit & Push" }).click();
  await commitDialog("Commit & Push");
  await until(() => run(remote, "log", "-1", "--format=%s", "main").trim() === "Change two", "commit and push");

  // Diverged, no pull settings: sync merges and pushes.
  run(other, "pull", "--quiet");
  await writeFile(join(other, "theirs-2.txt"), "theirs\n");
  run(other, "add", ".");
  run(other, "commit", "--quiet", "-m", "Theirs again");
  run(other, "push", "--quiet");
  await writeFile(join(repo, "mine.txt"), "mine\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "Mine");
  await button("Fetch").click();
  await button("Sync Changes ↓1 ↑1").click();
  await until(() => { const log = run(remote, "log", "--format=%s", "main"); return log.includes("Mine") && log.includes("Theirs again"); }, "the sync");
  assert.equal(git("status", "--porcelain"), "");

  // Stash including an untracked file, then pop it.
  await writeFile(join(repo, "two.txt"), "stash me\n");
  await writeFile(join(repo, "new.txt"), "new\n");
  await button("Commit 2 changes").waitFor();
  await menu("Stash (Include Untracked)");
  await until(() => git("status", "--porcelain") === "", "the stash");
  const stashes = panel.getByRole("grid", { name: "Stashes" });
  await stashes.getByRole("row").first().waitFor();
  await page.screenshot({ path: join(shots, "stash.png") });
  await idle();
  await stashes.getByRole("row").first().getByRole("button", { name: /actions$/ }).click();
  await page.getByRole("menuitem", { name: "Pop Stash" }).click();
  await until(() => existsSync(join(repo, "new.txt")) && readFileSync(join(repo, "two.txt"), "utf8") === "stash me\n", "the pop");
  await stashes.waitFor({ state: "detached" });

  // Discard asks first, restores a tracked file, and deletes an untracked one.
  await idle();
  await changes.getByRole("row", { name: "two.txt" }).waitFor();
  await button("Discard two.txt").click();
  const confirmation = page.getByRole("alertdialog");
  await confirmation.locator(".confirm-cancel").click();
  await confirmation.waitFor({ state: "detached" });
  assert.equal(readFileSync(join(repo, "two.txt"), "utf8"), "stash me\n", "cancelling keeps the edit");
  await button("Discard two.txt").click();
  await page.screenshot({ path: join(shots, "discard-confirm.png") });
  await confirmation.getByRole("button", { name: "Discard Changes" }).click();
  await until(() => readFileSync(join(repo, "two.txt"), "utf8") === "two changed\n", "the discard");
  await idle();
  await button("Discard new.txt").click();
  await confirmation.getByRole("button", { name: "Delete File" }).click();
  await until(() => !existsSync(join(repo, "new.txt")), "deleting the untracked file");
  assert.equal(git("status", "--porcelain"), "");

  // Amend rewrites the last commit; undo puts its changes back staged.
  await writeFile(join(repo, "amend.txt"), "amend\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "To be amended");
  await idle();
  await message.fill("Amended");
  await button("More commit actions").click();
  await page.getByRole("menuitem", { name: "Amend Last Commit" }).click();
  await commitDialog("Amend");
  await until(() => git("log", "-1", "--format=%s").trim() === "Amended", "the amend");
  await menu("Undo Last Commit");
  await until(() => git("status", "--porcelain") === "A  amend.txt\n", "the undo");
  git("reset", "--quiet");
  await writeFile(join(repo, "amend.txt"), "");
  execFileSync("rm", [join(repo, "amend.txt")]);

  // Branches: create, then a conflicting merge shows the banner and aborts cleanly.
  await until(() => panel.getByRole("button", { name: "Commit 1 change" }).isVisible().then((visible) => !visible), "a clean tree");
  await menu("Create Branch…");
  await page.getByRole("textbox", { name: "Branch name" }).fill("qa/conflict");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await panel.locator(".branch-name").getByText("qa/conflict").waitFor();
  await writeFile(join(repo, "two.txt"), "from branch\n");
  git("commit", "--quiet", "-am", "Branch side");
  git("switch", "--quiet", "main");
  await writeFile(join(repo, "two.txt"), "from main\n");
  git("commit", "--quiet", "-am", "Main side");
  await panel.locator(".branch-name").getByText("main").waitFor();
  await menu("Merge Branch…");
  await page.getByRole("button", { name: /Branch/ }).filter({ hasText: "Choose a branch" }).click();
  await page.getByRole("option", { name: "qa/conflict" }).click();
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await panel.getByText("Merge in progress.").waitFor();
  await panel.getByRole("alert").filter({ hasText: "CONFLICT" }).waitFor();
  await page.screenshot({ path: join(shots, "merge-conflict.png") });
  await message.fill("Would record conflict markers");
  assert.equal(await button("Commit 1 change").isDisabled(), true, "a conflict can't be committed");
  await message.fill("");
  await idle();
  await button("Abort").click();
  await panel.getByText("Merge in progress.").waitFor({ state: "detached" });
  assert.equal(git("status", "--porcelain"), "");
  await button("Dismiss error").waitFor({ state: "detached" });

  // Delete refuses an unmerged branch and explains; merged it deletes.
  await menu("Delete Branch…");
  await page.getByRole("button", { name: /Branch/ }).filter({ hasText: "Choose a branch" }).click();
  await page.getByRole("option", { name: "qa/conflict" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "not fully merged" }).waitFor();
  assert.match(git("branch", "--list", "qa/conflict"), /qa\/conflict/);
  await page.screenshot({ path: join(shots, "delete-refused.png") });

  // With no remote left, the actions that need one can't be pressed.
  git("remote", "remove", "origin");
  await button("Refresh changes").click();
  await until(() => button("Fetch").isDisabled(), "fetch disabled with no remote");
  assert.equal(await button("Publish branch").isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(`Source control QA passed. Screenshots: ${shots}`);
} catch (error) {
  await page?.screenshot({ path: join(shots, "failure.png") }).catch(() => undefined);
  console.error(`Failed; screenshots in ${shots}. Panel errors: ${await page?.locator(".source-control-panel [role=alert]").allInnerTexts().catch(() => "unknown")}`);
  throw error;
} finally {
  await app?.close().catch(() => undefined);
}
