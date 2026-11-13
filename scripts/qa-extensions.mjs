/* global window */
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { assertQaWindowVisibility, qaEnvironment } from "./qa-environment.mjs";

// QA inventory, with the simulated CLI and no model use:
// - Layers: an older profile's instructions move to ~/.dimsum/instructions.json (everywhere) and
//   .dimsum/instructions.local.json (only me here, with a .gitignore); shared ones are still read from .workbench/.
// - A user extension (~/.dimsum/extensions) runs at once; a workspace extension waits for trust, and its saved view
//   shows a placeholder until then.
// - Trusting starts it: its view, panel and composer menu appear; a harness() condition shows only for its CLI.
// - Worktrees of the trusted repo run their own copy; an untrusted workspace offers none of it.
// - Saving a file reloads it; a syntax error keeps the last version and shows the error.
// - Guards: the extension's block, the built-in native-command block, the built-in secrets warning (confirm sends).
// - Turning it off writes settings.local.json and stops it; scaffolding creates a new one that loads.
const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-extensions-qa-")));
const shots = process.env.QA_SHOTS ?? directory;
const home = join(directory, "dimsum-home");
const repo = join(directory, "repo");
const copy = join(directory, "repo-worktrees", "copy");
const other = join(directory, "other");
const executable = join(directory, "fixture-cli");
const log = join(directory, "prompts.jsonl");
await writeFile(executable, `#!/bin/sh\nexec '${process.execPath}' '${resolve("scripts/fixtures/composer-cli.mjs")}' "$@"\n`, { mode: 0o755 });

const hello = (folder) => Promise.all([
  mkdir(join(folder, ".dimsum", "extensions", "hello"), { recursive: true }).then(() => Promise.all([
    writeFile(join(folder, ".dimsum", "extensions", "hello", "label.ts"), `export const label = "Hello";\n`),
    writeFile(join(folder, ".dimsum", "extensions", "hello", "index.tsx"), `import { useState } from "react";
import { defineExtension, group, guard, harness, pattern, promptMenu, toggle, type ViewComponentProps } from "@dimsum/sdk";
import { label } from "./label";

const Icon = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" /></svg>;

function Board({ workspace }: ViewComponentProps) {
  const [count, setCount] = useState(0);
  return <div className="qa-board"><h2>{label} board in {workspace.name}</h2><button type="button" onClick={() => setCount(count + 1)}>Count {count}</button></div>;
}

export default defineExtension({
  name: "Hello",
  description: "QA extension",
  activate(ctx) {
    ctx.views.register({ id: "hello.board", label: "Hello board", description: "A QA view.", icon: Icon, component: Board });
    ctx.panels.register({ id: "hello.panel", label: "Hello panel", icon: Icon, order: 50, component: ({ workspace }) => <p className="qa-hello-panel">Hello panel for {workspace.name}</p> });
    ctx.promptMenus.register(promptMenu({ id: "hello.menu", label: "Hello", icon: Icon, items: [group("QA", [
      toggle("hello.codex", { label: "Codex only", text: "HELLO-CODEX", defaultOn: true, when: harness("codex.cli") }),
      toggle("hello.claude", { label: "Claude only", text: "HELLO-CLAUDE", defaultOn: true, when: harness("claude.cli") }),
    ])] }));
    ctx.beforeSend(guard("hello.no-forbidden", pattern(/FORBIDDEN/, "Hello says no."), { onMatch: "block" }));
    ctx.events.on("prompt.sent", (event) => { (window as unknown as { helloSent?: string }).helloSent = event.prompt; });
  },
});
`),
  ])),
]);
await mkdir(repo, { recursive: true });
execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
await hello(repo);
await hello(copy);
await hello(other);
// Shared instructions where older versions kept them.
await mkdir(join(repo, ".workbench"));
await writeFile(join(repo, ".workbench", "instructions.json"), JSON.stringify({ version: 1, instructions: [
  { id: "team-style", kind: "toggle", label: "Team style", category: "Team", defaultOn: false, text: "TEAM-STYLE" },
] }));
// The person's own extension: a status bar widget, in every workspace.
await mkdir(join(home, "extensions", "greeter"), { recursive: true });
await writeFile(join(home, "extensions", "greeter", "index.tsx"), `import { defineExtension } from "@dimsum/sdk";
export default defineExtension({ name: "Greeter", activate(ctx) {
  ctx.widgets.register({ id: "greeter.status", slot: "statusbar.start", order: 99, component: () => <span className="qa-greeter">Greeter ready</span> });
} });
`);
const agent = { id: "agent", workspaceId: "qa", type: "agent", title: "Agent", state: { providerId: "codex.cli", runIn: { kind: "checkout" }, modelSettings: { "codex.cli": { model: "gpt-6-luna", effort: "low" } } } };
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [
    { id: "qa", name: "Extensions QA", path: repo, activeViewId: "board", views: [{ id: "board", workspaceId: "qa", type: "hello.board", title: "Board" }, agent] },
    { id: "copy", name: "Copy", path: copy, views: [] },
    { id: "other", name: "Other", path: other, views: [] },
  ],
  activeWorkspaceId: "qa", personas: [], seededInstructionIds: [],
  // An older profile: instructions in the saved state, one everywhere and one for this workspace only.
  instructionOptions: [
    { scope: "global", option: { id: "mine-everywhere", kind: "toggle", label: "Mine everywhere", defaultOn: false, text: "MINE-EVERYWHERE" } },
    { scope: "workspace", workspaceId: "qa", option: { id: "mine-here", kind: "toggle", label: "Mine here", defaultOn: false, text: "MINE-HERE" } },
  ],
  layout: { leftCollapsed: false, rightCollapsed: false, rightPanel: "extensions" },
}));

const app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, DIMSUM_HOME: home, WORKBENCH_CODEX_PATH: executable,
  WORKBENCH_CLAUDE_PATH: join(directory, "missing"), COMPOSER_QA_LOG: log, COMPOSER_QA_LAUNCHES: join(directory, "launches.jsonl") }) });
const page = await app.firstWindow();
await assertQaWindowVisibility(app);
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const shot = async (name) => {
  await page.waitForTimeout(200);
  const bytes = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const [width, height] = w.getContentSize(); return (await w.capturePage()).resize({ width, height }).toPNG(); });
  await writeFile(join(shots, `${name}.png`), Buffer.from(bytes));
};
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const until = async (check, what) => { for (let i = 0; i < 100; i++) { if (await check().catch(() => false)) return; await page.waitForTimeout(100); } throw new Error(`Timed out waiting for ${what}`); };
const panel = page.locator(".extensions-panel");
const row = (name) => panel.locator(".extension-row").filter({ hasText: name });
const selectWorkspace = (name) => page.getByRole("treegrid", { name: "Workspaces" }).getByRole("row", { name: new RegExp(name) }).first().click();
const prompt = () => page.getByRole("textbox", { name: "Prompt", exact: true });
const feedback = (text) => page.waitForFunction((value) => document.querySelector(".composer-feedback")?.textContent.includes(value), text);

try {
  // Before trust: the user extension runs, the workspace one waits, and its saved view keeps its place.
  await page.locator(".qa-greeter", { hasText: "Greeter ready" }).waitFor();
  await row("hello").getByText("Waiting for trust").waitFor();
  await page.getByRole("heading", { name: "View unavailable" }).waitFor();
  await page.getByRole("button", { name: "Show extensions" }).waitFor();
  await shot("1-needs-trust");

  // Layers: the saved state's instructions moved to their files, merged with the seeded defaults.
  const everywhere = await json(join(home, "instructions.json"));
  assert.ok(everywhere.instructions.some((option) => option.id === "mine-everywhere"));
  assert.ok(everywhere.instructions.some((option) => option.id === "app-extension-guide"));
  assert.deepEqual((await json(join(repo, ".dimsum", "instructions.local.json"))).instructions.map((option) => option.id), ["mine-here"]);
  assert.match(await readFile(join(repo, ".dimsum", ".gitignore"), "utf8"), /\*\.local\.\*/);

  // Trust: the dialog is answered as the person would, then the extension starts.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await panel.getByRole("button", { name: "Trust workspace" }).click();
  await page.getByRole("heading", { name: "Hello board in Extensions QA" }).waitFor();
  await row("Hello").getByText("Running").waitFor();
  await page.getByRole("button", { name: "Count 0" }).click();
  await page.getByRole("button", { name: "Count 1" }).waitFor();
  await page.getByRole("radio", { name: "Hello panel" }).waitFor();
  await shot("2-trusted");

  // Saving reloads; a broken save keeps the version that worked and says why.
  await writeFile(join(repo, ".dimsum", "extensions", "hello", "label.ts"), `export const label = "Howdy";\n`);
  await page.getByRole("heading", { name: "Howdy board in Extensions QA" }).waitFor();
  await writeFile(join(repo, ".dimsum", "extensions", "hello", "label.ts"), `export const label = "Broken;\n`);
  await row("Howdy").or(row("Hello")).locator(".extension-error-text").waitFor();
  assert.match(await panel.locator(".extension-error-text").innerText(), /label\.ts:1/);
  await page.getByRole("heading", { name: "Howdy board in Extensions QA" }).waitFor();
  await shot("3-reload-error");
  await writeFile(join(repo, ".dimsum", "extensions", "hello", "label.ts"), `export const label = "Hello";\n`);
  await page.getByRole("heading", { name: "Hello board in Extensions QA" }).waitFor();
  await until(async () => (await panel.locator(".extension-error-text").count()) === 0, "the error to clear");

  // Composer: the extension's menu (harness condition), its guard, and the built-in guards.
  await page.getByRole("tab", { name: "Agent" }).click();
  await prompt().fill("Please do the FORBIDDEN thing");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await feedback("Hello says no.");
  await prompt().fill("/help");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await feedback("Use native commands directly in the terminal.");
  await prompt().fill("Use key AKIAABCDEFGHIJKLMNOP to deploy");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await page.getByRole("alertdialog").getByText(/an AWS access key/).waitFor();
  await shot("4-secret-warning");
  await page.getByRole("button", { name: "Send anyway" }).click();
  await until(async () => (await readFile(log, "utf8")).includes("AKIAABCDEFGHIJKLMNOP"), "the prompt to reach the CLI");
  const sent = await readFile(log, "utf8");
  assert.ok(sent.includes("HELLO-CODEX"), "the codex-only option is sent to Codex");
  assert.ok(!sent.includes("HELLO-CLAUDE"), "the claude-only option is hidden for Codex");
  assert.ok(!sent.includes("FORBIDDEN"), "a blocked prompt never reaches the CLI");
  // The extension heard about it through prompt.sent, once the CLI took it.
  await until(async () => /AKIAABCDEFGHIJKLMNOP/.test(await page.evaluate(() => window.helloSent ?? "")), "the prompt.sent event");
  // Instructions from every layer are offered, the legacy shared file included.
  await page.getByRole("button", { name: /^Instructions/ }).click();
  for (const label of ["Team style", "Mine everywhere", "Mine here"]) await page.getByRole("dialog").getByText(label, { exact: true }).waitFor();
  await shot("5-instruction-layers");
  await page.keyboard.press("Escape");

  // Worktrees run their own copy; an untrusted workspace offers none of it.
  await selectWorkspace("Copy");
  await row("Hello").getByText("Running").waitFor();
  await page.getByRole("button", { name: "Create view" }).click();
  await page.getByRole("menuitem", { name: /Hello board/ }).waitFor();
  await page.keyboard.press("Escape");
  await selectWorkspace("Other");
  await row("hello").getByText("Waiting for trust").waitFor();
  await page.getByRole("button", { name: "Create view" }).click();
  await page.getByRole("menuitem", { name: /Terminal/ }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: /Hello board/ }).count(), 0);
  await page.keyboard.press("Escape");
  await shot("6-untrusted-workspace");

  // Turning it off is the person's own setting for this workspace.
  await selectWorkspace("Extensions QA");
  await page.getByRole("tab", { name: "Board" }).click();
  await row("Hello").locator(".instruction-row-switch").click();
  await page.getByRole("heading", { name: "View unavailable" }).waitFor();
  assert.deepEqual((await json(join(repo, ".dimsum", "settings.local.json"))).extensions.disabled, ["workspace:hello"]);
  await row("hello").locator(".instruction-row-switch").click();
  await page.getByRole("heading", { name: "Hello board in Extensions QA" }).waitFor();

  // A new extension from the panel: files, guide and types are written, and it loads.
  await panel.getByRole("button", { name: "New workspace extension" }).click();
  await panel.getByRole("textbox", { name: "Folder name" }).fill("qa-made");
  await panel.getByRole("button", { name: "Create" }).click();
  await row("Qa Made").getByText("Running").waitFor();
  await stat(join(repo, ".dimsum", "AGENTS.md"));
  await stat(join(repo, ".dimsum", ".sdk", "sdk", "index.d.ts"));
  assert.ok((await json(join(repo, ".dimsum", "tsconfig.json"))).compilerOptions.paths["@dimsum/sdk"]);
  await page.getByRole("button", { name: "Create view" }).click();
  await page.getByRole("menuitem", { name: /Qa Made/ }).click();
  await page.getByRole("heading", { name: "Qa Made" }).waitFor();
  await shot("7-scaffolded");

  assert.deepEqual(errors, []);
  console.log(`Extensions QA passed. Screenshots: ${shots}`);
} catch (error) {
  await shot("failure").catch(() => undefined);
  console.error(`Failed; see ${shots}/failure.png`);
  throw error;
} finally {
  await app.close();
}
