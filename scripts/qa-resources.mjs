/* global window */
import { _electron as electron } from "playwright";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { assertQaWindowVisibility, qaEnvironment } from "./qa-environment.mjs";

// QA inventory: a terminal survives a tab switch with its screen and shell; closing its tab ends the shell and a
// background job; an agent session (fake CLI) shows in the resource manager with memory and history; a session no
// view shows is listed and ended from the Sessions tab; a reload ends every session; noisy output arrives batched.
const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-resources-qa-")));
const executable = join(directory, "fixture-cli");
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve("scripts/fixtures/composer-cli.mjs"))} "$@"\n`, { mode: 0o755 });
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Resource QA", path: directory, activeViewId: "term", views: [
    { id: "term", workspaceId: "qa", type: "terminal", title: "Term" },
    { id: "agent", workspaceId: "qa", type: "agent", title: "Agent", state: { providerId: "codex.cli", runIn: { kind: "checkout" },
      modelSettings: { "codex.cli": { model: "gpt-6-luna", effort: "low" } } } },
    { id: "noisy", workspaceId: "qa", type: "terminal", title: "Noisy" },
  ] }], activeWorkspaceId: "qa", personas: [], selectedPersonaByWorkspace: {}, appendedInstructions: [],
}));

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CODEX_PATH: executable,
  WORKBENCH_CLAUDE_PATH: join(directory, "missing-claude"), COMPOSER_QA_LOG: join(directory, "prompts.jsonl") }) });
try {
  const page = await app.firstWindow();
  await assertQaWindowVisibility(app);
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const until = async (check, what) => { for (let i = 0; i < 100; i++) { if (await check()) return; await page.waitForTimeout(100); } throw new Error(`Timed out: ${what}`); };
  const screen = () => page.locator(".xterm-rows").innerText().catch(() => "");
  const snapshot = () => page.evaluate(() => window.workbench.resources.snapshot());
  const session = async (viewId) => (await snapshot()).sessions.find((item) => item.viewId === viewId);
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const type = async (text) => { await page.locator(".xterm-helper-textarea").focus(); await page.keyboard.type(text); await page.keyboard.press("Enter"); };

  // A terminal keeps its shell, background job and screen across a tab switch.
  await page.locator(".xterm-rows").waitFor();
  await until(async () => Boolean(await session("term")), "terminal session");
  const shellPid = (await session("term")).pid;
  await type("sleep 600 & echo SLEEP=$!");
  await type("echo QA-MARKER");
  await until(async () => /SLEEP=\d+/.test(await screen()) && (await screen()).includes("QA-MARKER"), "marker on screen");
  const sleepPid = Number((await screen()).match(/SLEEP=(\d+)/)[1]);
  await tab("Noisy").click();
  await until(async () => Boolean(await session("noisy")), "second terminal");
  await tab("Term").click();
  await until(async () => (await screen()).includes("QA-MARKER"), "marker after switching back");
  assert.equal((await session("term")).pid, shellPid, "the same shell after a tab switch");
  assert.ok(alive(shellPid) && alive(sleepPid));

  // Noisy output arrives in batches, not a message per chunk.
  await tab("Noisy").click();
  await page.evaluate(() => { globalThis.qaPtyMessages = 0; window.workbench.pty.onData(() => { globalThis.qaPtyMessages++; }); });
  await page.locator(".xterm-helper-textarea").focus();
  await type("yes | head -c 4000000; echo QA-DONE");
  await until(async () => (await screen()).includes("QA-DONE"), "noisy command finished");
  const messages = await page.evaluate(() => globalThis.qaPtyMessages);
  console.log(`4 MB of output arrived in ${messages} messages`);
  assert.ok(messages < 1500, `too many output messages: ${messages}`);

  // Closing a terminal's tab ends its shell and what it started.
  await tab("Term").getByRole("button", { name: "Close Term" }).click();
  await until(() => !alive(shellPid) && !alive(sleepPid), "shell and background job ended");

  // An agent session shows under its workspace with memory, and its history grows.
  await tab("Agent").click();
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await until(async () => Boolean(await session("agent")), "agent session");
  await page.getByRole("button", { name: "Resource manager" }).click();
  const popover = page.getByRole("dialog", { name: "Resource manager" });
  await popover.waitFor();
  await until(async () => (await popover.innerText()).includes("Resource QA"), "workspace group");
  assert.match(await popover.innerText(), /Agent/);
  assert.match(await popover.innerText(), /Renderer/);
  await until(async () => (await session("agent")).history.length >= 3, "history samples");
  assert.ok((await session("agent")).memoryBytes > 0, "agent memory measured");
  const agentPid = (await session("agent")).pid;

  // A session no open view shows is listed apart and can be ended.
  const ghost = await page.evaluate((cwd) => window.workbench.pty.create({ cwd, cols: 80, rows: 24, viewId: "ghost" }), directory);
  await popover.getByRole("tab", { name: "Sessions" }).click();
  await until(async () => (await popover.innerText()).includes("No open view"), "orphan listed");
  await popover.getByRole("button", { name: "End all" }).click();
  await page.getByRole("button", { name: "End Session", exact: true }).click();
  await until(async () => !(await snapshot()).sessions.some((item) => item.sessionId === ghost), "orphan ended");
  await page.keyboard.press("Escape");

  // A reload ends every session the page started.
  const noisyPid = (await session("noisy")).pid;
  await page.reload();
  await until(() => !alive(agentPid) && !alive(noisyPid), "sessions ended on reload");
  await page.locator(".app-shell").waitFor();
  assert.deepEqual(errors, []);
  console.log("Resource QA passed.");
} finally {
  await app.close();
}
