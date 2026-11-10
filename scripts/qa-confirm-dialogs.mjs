// Closing an agent session that has something to lose, and removing a workspace, both ask first.
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { qaEnvironment, assertQaWindowVisibility } from "./qa-environment.mjs";

const directory = await mkdtemp(join(tmpdir(), "wb-confirm-"));
const root = join(directory, "acme-api");
await mkdir(root);
const agent = (id, title, state) => ({ id, workspaceId: "qa", type: "agent", title, state });
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "acme-api", path: root, activeViewId: "term", views: [
    { id: "term", workspaceId: "qa", type: "terminal", title: "Terminal", state: { providerId: "terminal.local" } },
    agent("saved", "Fix flaky login test", { providerId: "claude.cli", autoTitle: false, cwd: root, conversation: { providerId: "claude.cli", id: "qa-conversation" } }),
    agent("blank", "Untitled", { autoTitle: true }),
  ] }, { id: "other", name: "Other", path: directory, views: [] }],
  activeWorkspaceId: "qa", layout: { rightPanel: "views", rightCollapsed: false, leftCollapsed: false }, personas: [], instructionOptions: [],
}));
const missing = join(directory, "missing-cli");
const app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CODEX_PATH: missing, WORKBENCH_CLAUDE_PATH: missing }) });
try {
  const page = await app.firstWindow(); await assertQaWindowVisibility(app);
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  const sidebar = page.getByRole("treegrid", { name: "Workspaces" });
  const session = (title) => sidebar.getByRole("row", { name: title, exact: true });
  const action = (name) => page.getByRole("menuitem", { name, exact: true });
  const dialog = page.getByRole("alertdialog");
  await session("Fix flaky login test").waitFor();

  // A session with a saved conversation asks; Cancel keeps it.
  await session("Fix flaky login test").click({ button: "right" }); await action("Close").click();
  await dialog.getByRole("heading", { name: "Close agent session" }).waitFor();
  await dialog.getByText("Resumable · Claude Code").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Cancel", "focus starts on Cancel");
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(directory, "close-session.png") });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await dialog.waitFor({ state: "detached" });
  await session("Fix flaky login test").waitFor();

  // Escape cancels too; confirming closes it.
  await session("Fix flaky login test").click({ button: "right" }); await action("Close").click();
  await dialog.waitFor(); await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
  await session("Fix flaky login test").click({ button: "right" }); await action("Close").click();
  await dialog.getByRole("button", { name: "Yes, Close Session" }).click();
  await session("Fix flaky login test").waitFor({ state: "detached" });

  // A session that never started closes without asking.
  await session("Untitled").click({ button: "right" }); await action("Close").click();
  await session("Untitled").waitFor({ state: "detached" });
  assert.equal(await dialog.count(), 0);

  // Removing a workspace asks once, cancelling keeps everything, confirming removes it.
  await page.getByRole("button", { name: "Add workspace" }).waitFor();
  const workspaceRow = sidebar.getByRole("row", { name: "acme-api" });
  await workspaceRow.click({ button: "right" }); await action("Remove Workspace").click();
  await dialog.getByRole("heading", { name: "Remove workspace" }).waitFor();
  await dialog.getByText("1 terminal", { exact: true }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(directory, "remove-workspace.png") });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await workspaceRow.waitFor();
  await workspaceRow.click({ button: "right" }); await action("Remove Workspace").click();
  await dialog.getByRole("button", { name: "Yes, Remove Workspace" }).click();
  await workspaceRow.waitFor({ state: "detached" });
  await page.waitForTimeout(500); // Past the persistence debounce.
  const saved = JSON.parse(await readFile(join(directory, "workbench-state.json"), "utf8"));
  assert.deepEqual(saved.workspaces.map((w) => w.id), ["other"]);
  assert.deepEqual(errors, []);
  console.log(`Confirm dialog QA passed. Screenshots in ${directory}`);
} finally {
  await app.close();
}
