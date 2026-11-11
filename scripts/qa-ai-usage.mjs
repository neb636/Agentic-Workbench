/* global window */
import { _electron as electron } from "playwright";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { assertQaWindowVisibility, qaEnvironment } from "./qa-environment.mjs";

// QA inventory, with no sign-in, network or model use:
// - Claude's figures come from a recorded OAuth reply (WORKBENCH_AI_USAGE_FIXTURES/claude.json).
// - Codex's come through the real app-server probe, from the fixture CLI's `app-server` mode.
// - Checks: the status bar chips; the popover in Detailed and Compact; the Claude detail flyout with its windows and
//   credits; a new Claude session gets the status line --settings, and its command's payload updates the chip live;
//   a status line the person configured still runs and shows, fed the same payload; a failed read keeps the last figures marked old;
//   an unavailable provider is listed with its reason; turning the setting off removes the chip and stops reading.
const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-ai-usage-qa-")));
const shots = process.env.QA_SHOTS ?? directory;
const executable = join(directory, "fixture-cli");
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve("scripts/fixtures/composer-cli.mjs"))} "$@"\n`, { mode: 0o755 });
const fixtures = join(directory, "fixtures");
const claudeConfig = join(directory, "claude-config");
const codexHome = join(directory, "codex-home");
await Promise.all([fixtures, claudeConfig, codexHome].map((folder) => mkdir(folder, { recursive: true })));
await writeFile(join(codexHome, "auth.json"), "{}");
const runStatusLine = (command, input) => new Promise((done, fail) => { const child = execFile("/bin/sh", ["-c", command], (error, stdout) => error ? fail(error) : done(stdout)); child.stdin.end(input); });
const hours = (count) => Math.floor(Date.now() / 1000 + count * 3600);
const claudeReply = { status: 200, body: {
  five_hour: { utilization: 2, resets_at: new Date(Date.now() + 4.5 * 3600_000).toISOString() },
  seven_day: { utilization: 25, resets_at: new Date(Date.now() + 97 * 3600_000).toISOString() },
  limits: [{ kind: "weekly_scoped", percent: 10, resets_at: hours(97), scope: { model: { display_name: "Fable" } } }],
  spend: { used: { amount_minor: 0, currency: "USD", exponent: 2 }, limit: { amount_minor: 3000, currency: "USD", exponent: 2 }, enabled: true },
} };
await writeFile(join(fixtures, "claude.json"), JSON.stringify(claudeReply));
const rateLimits = join(directory, "rate-limits.json");
await writeFile(rateLimits, JSON.stringify({ result: { rateLimits: { primary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: hours(167) }, secondary: null } } }));
const launches = join(directory, "launches.jsonl");
const agentView = (id, title) => ({ id, workspaceId: "qa", type: "agent", title, state: { providerId: "claude.cli", runIn: { kind: "checkout" }, modelSettings: { "claude.cli": { model: "haiku", effort: "low" } } } });
const workspacePath = join(directory, "workspace");
await mkdir(workspacePath);
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Usage QA", path: workspacePath, activeViewId: "claude-1", views: [agentView("claude-1", "Claude One"), agentView("claude-2", "Claude Two")] }],
  activeWorkspaceId: "qa", personas: [], instructionOptions: [], layout: { leftCollapsed: false, rightCollapsed: false },
}));

const app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CLAUDE_PATH: executable, WORKBENCH_CODEX_PATH: executable,
  WORKBENCH_AI_USAGE_FIXTURES: fixtures, CLAUDE_CONFIG_DIR: claudeConfig, CODEX_HOME: codexHome, COMPOSER_QA_RATE_LIMITS: rateLimits,
  COMPOSER_QA_APP_SERVER: join(directory, "app-server.jsonl"), COMPOSER_QA_LAUNCHES: launches, COMPOSER_QA_LOG: join(directory, "prompts.jsonl") }) });
try {
  const page = await app.firstWindow();
  await assertQaWindowVisibility(app);
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const until = async (check, what, tries = 100) => { for (let i = 0; i < tries; i++) { if (await check()) return; await page.waitForTimeout(100); } throw new Error(`Timed out: ${what}`); };
  const status = page.locator(".ai-usage-status");
  const statusText = async () => (await status.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const closeAll = async () => { for (let i = 0; i < 5 && await page.getByRole("dialog").count(); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(150); } assert.equal(await page.getByRole("dialog").count(), 0, "popovers closed"); };
  const snapshot = () => page.evaluate(() => window.workbench.aiUsage.snapshot());
  const provider = async (id) => (await snapshot()).providers.find((item) => item.providerId === id);

  // Both agents' figures reach the status bar.
  await until(async () => /2% 4h 30m · 25% 4d 1h · 10% Fable/.test(await statusText()), "Claude chip");
  await until(async () => /1% 6d 23h/.test(await statusText()), "Codex chip");
  const appServer = JSON.parse((await readFile(join(directory, "app-server.jsonl"), "utf8")).trim().split("\n")[0]);
  assert.deepEqual(appServer.argv.slice(-5), ["-s", "read-only", "-a", "never", "app-server"], "Codex is read through a read-only app-server");
  console.log("STATUS", await statusText());
  await page.locator(".status-bar").screenshot({ path: join(shots, "ai-usage-status.png") });

  // The popover, detailed and compact.
  await page.getByRole("button", { name: /^AI usage/ }).click();
  const popover = page.getByRole("dialog", { name: "AI usage", exact: true });
  await popover.waitFor();
  assert.match(await popover.innerText(), /Claude Code[\s\S]*Resets in 4h 30m[\s\S]*5h[\s\S]*2%[\s\S]*wk[\s\S]*25%[\s\S]*Fable[\s\S]*10%/);
  assert.match(await popover.innerText(), /Codex[\s\S]*Resets in 6d 23h[\s\S]*wk[\s\S]*1%/);
  await page.screenshot({ path: join(shots, "ai-usage-popover.png") });
  await popover.getByRole("radio", { name: "Compact" }).click();
  await until(async () => (await statusText()) === "Used 1% 6d 23h 25% 4d 1h", "compact chips");
  await page.screenshot({ path: join(shots, "ai-usage-compact.png") });
  await popover.getByRole("radio", { name: "Detailed" }).click();

  // The Claude flyout: every window and the credits.
  await popover.getByRole("button", { name: /Claude Code/ }).click();
  const detail = page.getByRole("dialog", { name: "Claude Code usage" });
  await detail.waitFor();
  const detailText = await detail.innerText();
  for (const expected of [/Updated just now/, /Session[\s\S]*2% used[\s\S]*Resets in 4h 30m/, /Weekly[\s\S]*25% used[\s\S]*Resets in 4d 1h/, /Fable[\s\S]*10% used/, /Usage credits[\s\S]*\$0\.00 \/ \$30\.00[\s\S]*0% used/]) assert.match(detailText, expected);
  assert.equal(await detail.getByRole("meter").count(), 4);
  await page.screenshot({ path: join(shots, "ai-usage-detail.png") });
  await closeAll();

  // A new Claude session gets the status line; the payload its command writes updates the chip.
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await until(async () => (await readFile(launches, "utf8").catch(() => "")).includes("--settings"), "launch with --settings");
  const argv = JSON.parse((await readFile(launches, "utf8")).trim().split("\n").at(-1)).argv;
  const settings = JSON.parse(argv[argv.indexOf("--settings") + 1]);
  assert.equal(settings.statusLine.type, "command");
  const payload = JSON.stringify({ model: { id: "haiku" }, rate_limits: { five_hour: { used_percentage: 42, resets_at: hours(2) }, seven_day: { used_percentage: 30, resets_at: hours(97) } } });
  const output = await runStatusLine(settings.statusLine.command, payload);
  assert.equal(output, "", "the status line prints nothing");
  await until(async () => /42% 2h 0m · 30% 4d 1h · 10% Fable/.test(await statusText()), "live figures");
  assert.equal((await provider("claude.cli")).source, "live");

  // A status line the person configured keeps working: it runs inside ours, with the same payload, and is what shows.
  await writeFile(join(claudeConfig, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "read -r line; echo \"mine:${#line}\"", padding: 2 } }));
  const before = (await readFile(launches, "utf8")).trim().split("\n").length;
  await page.getByRole("tab", { name: /Claude Two/ }).click();
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await until(async () => (await readFile(launches, "utf8")).trim().split("\n").length > before, "second launch");
  const second = JSON.parse((await readFile(launches, "utf8")).trim().split("\n").at(-1)).argv;
  const wrapped = JSON.parse(second[second.indexOf("--settings") + 1]).statusLine;
  assert.equal(wrapped.padding, 2, "their other status line settings are kept");
  const theirs = await runStatusLine(wrapped.command, payload.replace("42", "55"));
  assert.equal(theirs, `mine:${payload.length}\n`, "their command's output, from the same payload");
  await until(async () => /55% 2h 0m/.test(await statusText()), "live figures through their status line");

  // Failures: Claude keeps its last figures, marked old; Codex not signed in is listed with its reason.
  await writeFile(join(fixtures, "claude.json"), JSON.stringify({ status: 429, retryAfter: "120" }));
  await writeFile(rateLimits, JSON.stringify({ error: "API key authentication requires a ChatGPT account" }));
  await page.waitForTimeout(31_000); // past the 30 s floor between manual refreshes
  await page.evaluate(() => window.workbench.aiUsage.refresh());
  await until(async () => (await provider("claude.cli")).status === "stale", "stale Claude");
  assert.equal((await provider("claude.cli")).message, "Anthropic asked to check less often.");
  assert.equal((await provider("codex.cli")).status, "unavailable");
  await until(async () => (await status.locator(".ai-usage-warning").count()) === 1 && !/6d 23h/.test(await statusText()), "warning shown, Codex chip gone");
  await page.getByRole("button", { name: /^AI usage/ }).click();
  assert.match(await popover.innerText(), /Claude Code[\s\S]*Anthropic asked to check less often\./);
  assert.match(await popover.innerText(), /Codex\nSigned in with an API key, which has no plan limits\./);
  await page.screenshot({ path: join(shots, "ai-usage-failures.png") });
  await closeAll();

  // Off: the chip goes and the main process reads nothing.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByText("Show plan usage in the status bar").waitFor();
  await page.screenshot({ path: join(shots, "ai-usage-settings.png") });
  await dialog.getByText("Show plan usage in the status bar").click();
  await until(async () => (await status.count()) === 0, "chip removed");
  await until(async () => (await snapshot()).providers.length === 0, "service idle");
  await dialog.getByRole("button", { name: "Done" }).click();
  await until(async () => JSON.parse(await readFile(join(directory, "workbench-state.json"), "utf8")).featureSettings?.["ai-usage"]?.enabled === false, "setting saved");
  assert.deepEqual(errors, []);
  console.log(`AI usage QA passed. Screenshots in ${shots}`);
} finally {
  await app.close();
}
