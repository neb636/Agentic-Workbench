/* global window */
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
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
    // Code from elsewhere in the workspace, which the extension imports.
    writeFile(join(folder, "shared-label.ts"), `export const shared = "shared-0";\n`),
    writeFile(join(folder, ".dimsum", "extensions", "hello", "index.tsx"), `import { useState } from "react";
import { defineExtension, group, guard, harness, pattern, promptMenu, toggle, type ViewComponentProps } from "@dimsum/sdk";
import { label } from "./label";
import { shared } from "../../../shared-label";

const Icon = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" /></svg>;

function Board({ workspace }: ViewComponentProps) {
  const [count, setCount] = useState(0);
  return <div className="qa-board"><h2>{label} board in {workspace.name}</h2><p className="qa-shared">{shared}</p><button type="button" onClick={() => setCount(count + 1)}>Count {count}</button></div>;
}

export default defineExtension({
  name: "Hello",
  description: "QA extension",
  activate(ctx) {
    ctx.views.register({ id: "hello.board", label: "Hello board", description: "A QA view.", icon: Icon, component: Board });
    // An icon that fails: menus and tabs leave its spot empty instead of the workbench going down.
    ctx.views.register({ id: "hello.fragile", label: "Fragile view", description: "Its icon throws.", icon: () => { throw new Error("Fragile icon"); }, component: () => <p>Fragile</p> });
    ctx.panels.register({ id: "hello.panel", label: "Hello panel", icon: Icon, order: 50, component: ({ workspace }) => <p className="qa-hello-panel">Hello panel for {workspace.name}</p> });
    ctx.promptMenus.register(promptMenu({ id: "hello.menu", label: "Hello", icon: Icon, items: [group("QA", [
      toggle("hello.codex", { label: "Codex only", text: "HELLO-CODEX", defaultOn: true, when: harness("codex.cli") }),
      toggle("hello.claude", { label: "Claude only", text: "HELLO-CLAUDE", defaultOn: true, when: harness("claude.cli") }),
    ])] }));
    // A global regex: every check must still match, not resume from where the last one stopped.
    ctx.beforeSend(guard("hello.no-forbidden", pattern(/FORBIDDEN/g, "Hello says no."), { onMatch: "block" }));
    ctx.events.on("prompt.sent", (event) => { (window as unknown as { helloSent?: string }).helloSent = event.prompt; });
    // Widgets in the slots that aren't tied to a view: they show while this workspace is the active one.
    ctx.widgets.register({ id: "hello.footer", slot: "sidebar.footer", component: ({ workspaceId }) => <span className="qa-hello-footer">Hello footer {workspaceId}</span> });
    ctx.widgets.register({ id: "hello.settings", slot: "settings.general", component: ({ workspaceId }) => <p className="qa-hello-settings">Hello settings {workspaceId}</p> });
    // A handler that changes the store as it hears about a view: each view is still announced once.
    ctx.events.on("view.opened", (event) => {
      if (event.workspaceId !== ctx.extension.workspaceId) return;
      const seen = ((window as unknown as { helloOpened?: Record<string, number> }).helloOpened ??= {});
      seen[event.viewId] = (seen[event.viewId] ?? 0) + 1;
      void ctx.commands.execute("view.activate", { workspaceId: event.workspaceId, viewId: event.viewId });
    });
    // A menu whose options can't be computed: the composer leaves it empty and keeps working.
    ctx.promptMenus.register({ id: "hello.broken", label: "Broken menu", description: "Its options throw.", icon: Icon, kind: "instruction",
      placement: "append", resetAfterSend: false, options: () => { throw new Error("Broken options"); } });
    // Its own command, called with arguments of its own shape.
    ctx.commands.register("hello.double", (args: { value: number }) => args.value * 2);
    void ctx.commands.execute("hello.double", { value: 3 }).then((result) => { (window as unknown as { helloDoubled?: unknown }).helloDoubled = result; },
      (error: unknown) => { (window as unknown as { helloDoubled?: unknown }).helloDoubled = String(error); });
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
// An extension whose second guard can't register: it fails, and its first guard must not stay behind.
await mkdir(join(repo, ".dimsum", "extensions", "leaky"), { recursive: true });
await writeFile(join(repo, ".dimsum", "extensions", "leaky", "index.tsx"), `import { defineExtension, guard, pattern } from "@dimsum/sdk";
const block = guard("leaky.block", pattern(/LEAKY/, "Leaked guard."), { onMatch: "block" });
export default defineExtension({ name: "Leaky", activate(ctx) { ctx.beforeSend([block, block]); } });
`);
// An extension that takes a while to activate: a save that lands meanwhile must still end up running.
await mkdir(join(repo, ".dimsum", "extensions", "slow"), { recursive: true });
await writeFile(join(repo, ".dimsum", "extensions", "slow", "label.ts"), `export const label = "slow-0";\n`);
await writeFile(join(repo, ".dimsum", "extensions", "slow", "index.tsx"), `import { defineExtension } from "@dimsum/sdk";
import { label } from "./label";
export default defineExtension({ name: "Slow", async activate(ctx) {
  await new Promise((done) => setTimeout(done, 1500));
  ctx.widgets.register({ id: "slow.status", slot: "statusbar.end", component: () => <span className="qa-slow">{label}</span> });
} });
`);
// An ignore file the team already has: the local-file exclusion is added to it, nothing is lost.
await writeFile(join(repo, ".dimsum", ".gitignore"), "node_modules/\n");
// A workspace whose .dimsum links outside it: nothing is ever read or written through the link.
const linked = join(directory, "linked");
const outside = join(directory, "outside");
await mkdir(linked);
await mkdir(outside);
await symlink(outside, join(linked, ".dimsum"));
// An ordinary .dimsum whose guide links outside the workspace: scaffolding refuses rather than overwrite it.
const outsideGuide = join(directory, "outside-guide.md");
await writeFile(outsideGuide, "KEEP ME\n");
await mkdir(join(other, ".dimsum"), { recursive: true });
await symlink(outsideGuide, join(other, ".dimsum", "AGENTS.md"));
// A workspace's shared settings can't turn off the person's own extension (it runs once, for every workspace).
await writeFile(join(repo, ".dimsum", "settings.json"), JSON.stringify({ version: 1, extensions: { disabled: ["user:greeter"] } }));
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
    { id: "linked", name: "Linked", path: linked, activeViewId: "linked-agent", views: [{ ...agent, id: "linked-agent", workspaceId: "linked", title: "Linked agent" }] },
  ],
  activeWorkspaceId: "qa", personas: [], seededInstructionIds: [],
  // An older profile: instructions in the saved state, one everywhere and one for this workspace only.
  instructionOptions: [
    { scope: "global", option: { id: "mine-everywhere", kind: "toggle", label: "Mine everywhere", defaultOn: false, text: "MINE-EVERYWHERE" } },
    { scope: "workspace", workspaceId: "qa", option: { id: "mine-here", kind: "toggle", label: "Mine here", defaultOn: false, text: "MINE-HERE" } },
    { scope: "workspace", workspaceId: "linked", option: { id: "mine-linked", kind: "toggle", label: "Mine linked", defaultOn: false, text: "MINE-LINKED" } },
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
  await row("Greeter").getByText("Running").waitFor();
  await row("hello").getByText("Waiting for trust").waitFor();
  await page.getByRole("heading", { name: "View unavailable" }).waitFor();
  await page.getByRole("button", { name: "Show extensions" }).waitFor();
  await shot("1-needs-trust");

  // Layers: the saved state's instructions moved to their files, merged with the seeded defaults.
  const everywhere = await json(join(home, "instructions.json"));
  assert.ok(everywhere.instructions.some((option) => option.id === "mine-everywhere"));
  assert.ok(everywhere.instructions.some((option) => option.id === "app-extension-guide"));
  assert.deepEqual((await json(join(repo, ".dimsum", "instructions.local.json"))).instructions.map((option) => option.id), ["mine-here"]);
  const ignore = await readFile(join(repo, ".dimsum", ".gitignore"), "utf8");
  assert.match(ignore, /^node_modules\/\n/);
  assert.match(ignore, /^\*\.local\.\*$/m);
  assert.deepEqual(await readdir(outside), [], "nothing is written through a .dimsum symlink");

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
  assert.match(await row("Howdy").or(row("Hello")).locator(".extension-error-text").innerText(), /label\.ts:1/);
  await page.getByRole("heading", { name: "Howdy board in Extensions QA" }).waitFor();
  await shot("3-reload-error");
  await writeFile(join(repo, ".dimsum", "extensions", "hello", "label.ts"), `export const label = "Hello";\n`);
  await page.getByRole("heading", { name: "Hello board in Extensions QA" }).waitFor();
  await until(async () => (await row("Hello").locator(".extension-error-text").count()) === 0, "the error to clear");
  // Saving a workspace file the extension imports (outside .dimsum) rebuilds it.
  await page.locator(".qa-shared", { hasText: "shared-0" }).waitFor();
  await writeFile(join(repo, "shared-label.ts"), `export const shared = "shared-1";\n`);
  await page.locator(".qa-shared", { hasText: "shared-1" }).waitFor();
  // The failing icon was drawn in the Create view menu and left nothing broken behind.
  await page.getByRole("button", { name: "Create view" }).click();
  await page.getByRole("menuitem", { name: /Fragile view/ }).waitFor();
  await page.keyboard.press("Escape");
  // A second save while the first is still starting: the newer one wins.
  await page.locator(".qa-slow", { hasText: "slow-0" }).waitFor();
  await writeFile(join(repo, ".dimsum", "extensions", "slow", "label.ts"), `export const label = "slow-1";\n`);
  await page.waitForTimeout(700);
  await writeFile(join(repo, ".dimsum", "extensions", "slow", "label.ts"), `export const label = "slow-2";\n`);
  await page.locator(".qa-slow", { hasText: "slow-2" }).waitFor({ timeout: 15_000 });
  // The extension found its own command with arguments; the failed one left no guard behind.
  await until(async () => (await page.evaluate(() => window.helloDoubled)) === 6, "hello.double to run");
  await row("Leaky").locator(".extension-error-text").waitFor();

  // Composer: the extension's menu (harness condition), its guard, and the built-in guards.
  await page.getByRole("tab", { name: "Agent" }).click();
  await prompt().fill("Please do the FORBIDDEN thing");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await feedback("Hello says no.");
  // Trying again is blocked again.
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await page.waitForTimeout(500);
  await feedback("Hello says no.");
  await prompt().fill("/help");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await feedback("Use native commands directly in the terminal.");
  await prompt().fill("Use key AKIAABCDEFGHIJKLMNOP to deploy LEAKY");
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
  // Slots outside views: the footer and General settings show this workspace's extension widgets.
  await page.locator(".qa-hello-footer", { hasText: "Hello footer qa" }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Settings" }).locator(".qa-hello-settings", { hasText: "Hello settings qa" }).waitFor();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Done" }).click();

  // An instruction that couldn't move to its file (Linked's .dimsum is a link) is still offered from the saved state.
  await selectWorkspace("Linked");
  await page.getByRole("tab", { name: "Linked agent" }).click();
  await page.getByRole("button", { name: /^Instructions/ }).click();
  await page.getByRole("dialog").getByText("Mine linked", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".qa-hello-footer").count(), 0, "an untrusted workspace shows no extension widgets");

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
  await panel.getByRole("button", { name: "New workspace extension" }).click();
  await panel.getByRole("textbox", { name: "Folder name" }).fill("linked-guide");
  await panel.getByRole("button", { name: "Create" }).click();
  await panel.getByRole("alert").filter({ hasText: "symbolic link" }).waitFor();
  assert.equal(await readFile(outsideGuide, "utf8"), "KEEP ME\n", "scaffolding never writes through a linked guide");
  await assert.rejects(stat(join(other, ".dimsum", "extensions", "linked-guide")), "nothing is scaffolded when the guide is linked");
  await page.keyboard.press("Escape");

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
  const opened = await page.evaluate(() => window.helloOpened ?? {});
  assert.ok(Object.keys(opened).length > 0, "the extension heard view.opened");
  assert.ok(Object.values(opened).every((count) => count === 1), `each view is announced once: ${JSON.stringify(opened)}`);
  await shot("7-scaffolded");

  // A name that starts with a digit still makes a valid component name.
  await panel.getByRole("button", { name: "New workspace extension" }).click();
  await panel.getByRole("textbox", { name: "Folder name" }).fill("2d-board");
  await panel.getByRole("button", { name: "Create" }).click();
  await row("2d Board").getByText("Running").waitFor();

  assert.deepEqual(errors, []);
  console.log(`Extensions QA passed. Screenshots: ${shots}`);
} catch (error) {
  await shot("failure").catch(() => undefined);
  console.error(`Failed; see ${shots}/failure.png`);
  throw error;
} finally {
  await app.close();
}
