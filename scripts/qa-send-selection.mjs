import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { assertQaWindowVisibility, qaEnvironment } from "./qa-environment.mjs";

// Sending selected code from a file tab to an agent session's composer: the pill, the picker, ⌘L on an empty
// selection, the context menu item, the last-used ordering, a new session, and delivery through the simulated CLI.
const directory = await mkdtemp(join(tmpdir(), "wb-send-"));
const out = directory;
const repo = join(directory, "repo");
await mkdir(join(repo, "src"), { recursive: true });
execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
const code = `import { readFile } from 'node:fs/promises'

const path = process.env.CONFIG_PATH
const fallback = { retries: 3 }
const strict = process.env.CONFIG_STRICT === 'true'

export const hasConfig = Boolean(path) && !strict

if (path && strict) {
  throw new Error('Strict mode needs a config file')
}
`;
await writeFile(join(repo, "src/config.ts"), code);
const executable = join(directory, "fixture-cli");
const log = join(directory, "prompts.jsonl");
await writeFile(executable, `#!/bin/sh\nexec '${process.execPath}' '${resolve("scripts/fixtures/composer-cli.mjs")}' "$@"\n`, { mode: 0o755 });
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Send QA", path: repo, activeViewId: "file", views: [
    { id: "agent", workspaceId: "qa", type: "agent", title: "Tighten config loading", state: { providerId: "codex.cli", runIn: { kind: "checkout" }, draft: "Why is this guarded?", modelSettings: { "codex.cli": { model: "gpt-6-luna", effort: "low" } } } },
    { id: "file", workspaceId: "qa", type: "file", title: "config.ts", state: { root: repo, path: "src/config.ts" } },
  ] }], activeWorkspaceId: "qa", personas: [], instructionOptions: [], layout: { leftCollapsed: false, rightCollapsed: true },
}));
const app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CODEX_PATH: executable,
  WORKBENCH_CLAUDE_PATH: join(directory, "missing"), COMPOSER_QA_LOG: log, COMPOSER_QA_LAUNCHES: join(directory, "launches.jsonl") }) });
const page = await app.firstWindow();
await assertQaWindowVisibility(app);
page.setDefaultTimeout(10_000);
const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const shot = async (name) => {
  await page.waitForTimeout(200);
  const bytes = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const [width, height] = w.getContentSize(); return (await w.capturePage()).resize({ width, height }).toPNG(); });
  await writeFile(join(out, `${name}.png`), Buffer.from(bytes));
};
const prompt = () => page.getByRole("textbox", { name: "Prompt", exact: true });
try {
  await page.locator(".cm-line").nth(8).waitFor();
  // Select lines 9-11 with the keyboard.
  await page.locator(".cm-line").nth(8).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("Shift+End");
  const pill = page.getByRole("button", { name: "Send selection to agent" });
  await pill.waitFor();
  await shot("1-pill");
  await pill.click();
  await page.getByRole("menu", { name: "Send selection to" }).waitFor();
  await shot("2-picker");
  await page.getByRole("menuitem", { name: /Tighten config loading/ }).click();
  await page.getByRole("tab", { name: "Tighten config loading", selected: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Prompt");
  const draft = await prompt().inputValue();
  assert.equal(draft, "Why is this guarded?\n\nsrc/config.ts:9-11\n```ts\nif (path && strict) {\n  throw new Error('Strict mode needs a config file')\n}\n```\n");
  await shot("3-existing");
  // Back to the file: ⌘L with no selection sends the cursor's line, to a new session.
  await page.getByRole("tab", { name: "config.ts" }).click();
  await page.locator(".cm-line").nth(6).click();
  await page.keyboard.press("Meta+l");
  await page.getByRole("menu", { name: "Send selection to" }).waitFor();
  assert.match(await page.locator(".selection-popover-head").innerText(), /Line 7/);
  // The last-used session heads the list.
  assert.match(await page.getByRole("menuitem").first().innerText(), /Tighten config loading[\s\S]*Last used/);
  await shot("4-shortcut");
  await page.getByRole("menuitem", { name: /New session/ }).click();
  await page.getByRole("tab", { name: "Untitled", selected: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Prompt");
  assert.equal(await prompt().inputValue(), "src/config.ts:7\n```ts\nexport const hasConfig = Boolean(path) && !strict\n```\n");
  await page.keyboard.type("Is this right?");
  await shot("5-new");
  // Right-click offers it too; Escape on the picker gives focus back to the editor.
  await page.getByRole("tab", { name: "config.ts" }).click();
  await page.locator(".cm-line").nth(2).click({ clickCount: 3 });
  await page.locator(".cm-line").nth(2).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Send to Agent…/ }).waitFor();
  await shot("6-context-menu");
  await page.getByRole("menuitem", { name: /Send to Agent…/ }).click();
  await page.getByRole("menu", { name: "Send selection to" }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.classList.contains("cm-content"));
  // Mouse drag hides the pill until the drag ends.
  const box = await page.locator(".cm-line").nth(0).boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 45, { steps: 5 });
  assert.equal(await pill.count(), 0);
  await page.mouse.up();
  await pill.waitFor();
  // Sending the existing session's draft delivers the reference.
  await page.getByRole("tab", { name: "Tighten config loading" }).click();
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  for (let i = 0; i < 100 && !(await readFile(log, "utf8").catch(() => "")).trim(); i++) await page.waitForTimeout(100);
  const sent = JSON.parse((await readFile(log, "utf8")).trim().split("\n").at(-1)).prompt;
  assert.match(sent, /src\/config\.ts:9-11\n```ts\nif \(path && strict\)/);
  await shot("7-sent");
  assert.deepEqual(errors, []);
  console.log("QA passed", out);
} finally { await app.close(); }
