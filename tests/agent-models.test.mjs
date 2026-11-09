import assert from "node:assert/strict";
import { mock } from "node:test";
import console from "node:console";
import process from "node:process";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import catalogueModule from "../dist-electron/main/agent-model-catalogue.js";
import managerModule from "../dist-electron/main/agent-session-manager.js";
import codexModule from "../dist-electron/main/providers/codex-agent-provider.js";
import claudeModule from "../dist-electron/main/providers/claude-agent-provider.js";

const { AgentModelCatalogue } = catalogueModule;
const { AgentSessionManager } = managerModule;
const { CodexAgentProvider } = codexModule;
const { ClaudeAgentProvider } = claudeModule;
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** A CLI simulated by node: prints `text` and exits, or fails. */
const printing = (text, parse = JSON.parse, code = 0) => ({
  id: "fake", label: "Fake", executable: process.execPath, models: [{ id: "static", label: "Static", efforts: ["low"] }],
  listModels: { args: ["-e", `process.stdout.write(${JSON.stringify(text)}); process.exitCode = ${code}`], parse },
  modelArgs: (settings) => ["--model", settings.model],
  args: () => [],
});
const choices = [{ id: "fresh", label: "Fresh", efforts: ["low", "high"] }];

test("Claude's recorded handshake lists every model except the CLI's default", () => {
  const models = new ClaudeAgentProvider().listModels.parse(fixture("claude-models.jsonl"));
  assert.equal(models.some((model) => model.id === "default"), false);
  assert.deepEqual(models.find((model) => model.id === "fable"), { id: "fable", label: "Fable 5.2", efforts: ["low", "medium", "high", "xhigh", "max"] });
  // An older model with no effort levels stays listed, with none.
  assert.deepEqual(models.find((model) => model.id === "claude-haiku-4-5-20251001")?.efforts, []);
});

test("Codex's recorded catalogue lists what its own picker shows", () => {
  const models = new CodexAgentProvider().listModels.parse(fixture("codex-models.json"));
  assert.equal(models.some((model) => model.id === "gpt-reserve"), false, "hidden models are left out");
  assert.deepEqual(models.find((model) => model.id === "gpt-6-luna"), { id: "gpt-6-luna", label: "GPT-6-Luna", efforts: ["low", "medium", "high", "xhigh", "max"] });
});

test("a model without effort levels launches with no effort argument", () => {
  assert.deepEqual(new ClaudeAgentProvider().modelArgs({ model: "old" }), ["--model", "old"]);
  assert.deepEqual(new CodexAgentProvider().modelArgs({ model: "old" }), ["--model", "old"]);
});

test("the catalogue replaces the adapter's list once the CLI has answered, and reports only real changes", async () => {
  const provider = printing(JSON.stringify(choices));
  const catalogue = new AgentModelCatalogue([provider]);
  assert.deepEqual(catalogue.modelsFor(provider), provider.models);
  assert.equal(await catalogue.refresh(), true);
  assert.deepEqual(catalogue.modelsFor(provider), choices);
  assert.equal(await catalogue.refresh(), false);
});

test("a failed or empty read keeps the last good list", async () => {
  const provider = printing(JSON.stringify(choices));
  const catalogue = new AgentModelCatalogue([provider]);
  await catalogue.refresh();
  const warn = mock.method(console, "warn", () => {});
  try {
    Object.assign(provider, printing("not json"));
    assert.equal(await catalogue.refresh(), false);
    Object.assign(provider, printing(JSON.stringify(choices), JSON.parse, 3));
    assert.equal(await catalogue.refresh(), false);
    assert.equal(warn.mock.callCount(), 2);
  } finally { warn.mock.restore(); }
  Object.assign(provider, printing("[]"));
  assert.equal(await catalogue.refresh(), false);
  assert.deepEqual(catalogue.modelsFor(provider), choices);
  // No executable: nothing to ask.
  const missing = { ...provider, executable: "/nonexistent/cli" };
  assert.equal(await new AgentModelCatalogue([missing]).refresh(), false);
});

test("what a CLI lists can't become a flag or break out of a launch argument", async () => {
  const bad = [{ id: "--dangerously-skip-permissions", label: "x", efforts: [] }, { id: "ok[1m]", label: "ok", efforts: ["low", 'high" -c evil="1'] }];
  const provider = printing(JSON.stringify(bad));
  const catalogue = new AgentModelCatalogue([provider]);
  await catalogue.refresh();
  assert.deepEqual(catalogue.modelsFor(provider), [{ id: "ok[1m]", label: "ok", efforts: ["low"] }]);
});

test("a CLI that stays open after answering is stopped once it has", async () => {
  const provider = printing("");
  provider.listModels = {
    args: ["-e", `process.stdin.once("data", (d) => console.log(JSON.stringify({ got: String(d).trim(), models: ${JSON.stringify(choices)} }))); setInterval(() => {}, 1000);`],
    input: "hello\n", ready: (stdout) => stdout.endsWith("\n"),
    parse: (stdout) => { const answer = JSON.parse(stdout); assert.equal(answer.got, "hello"); return answer.models; },
  };
  const catalogue = new AgentModelCatalogue([provider]);
  assert.equal(await catalogue.refresh(), true);
  assert.deepEqual(catalogue.modelsFor(provider), choices);
});

test("the list is read at startup and every 30 minutes, overlapping reads joined", async () => {
  const provider = printing(JSON.stringify(choices));
  const catalogue = new AgentModelCatalogue([provider]);
  const refresh = mock.method(catalogue, "refresh", () => Promise.resolve(true));
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    let changes = 0;
    catalogue.start(() => { changes += 1; });
    assert.equal(refresh.mock.callCount(), 1);
    mock.timers.tick(30 * 60_000 - 1);
    assert.equal(refresh.mock.callCount(), 1);
    mock.timers.tick(1);
    assert.equal(refresh.mock.callCount(), 2);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(changes, 2);
    catalogue.stop();
    mock.timers.tick(60 * 60_000);
    assert.equal(refresh.mock.callCount(), 2);
  } finally { mock.timers.reset(); refresh.mock.restore(); }
  const joined = new AgentModelCatalogue([provider]);
  assert.equal(joined.refresh(), joined.refresh());
  await joined.refresh();
});

test("launch validation and discovery follow the fetched list", async () => {
  const provider = printing(JSON.stringify([...choices, { id: "plain", label: "Plain", efforts: [] }]));
  const spawned = [];
  const catalogue = new AgentModelCatalogue([provider]);
  const manager = new AgentSessionManager([provider], (_c, args) => { spawned.push(args); return { onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }; }, undefined, catalogue);
  const create = (viewId, settings) => manager.create({ providerId: "fake", workspacePath: process.cwd(), viewId, cols: 80, rows: 24, settings }, {});
  await catalogue.refresh();
  assert.deepEqual(manager.discover()[0].models.map((model) => model.id), ["fresh", "plain"]);
  create("a", { model: "fresh", effort: "high" });
  create("b", { model: "plain" });
  assert.equal(spawned.length, 2);
  assert.throws(() => create("c", { model: "static", effort: "low" }), /Unsupported model/);
  assert.throws(() => create("d", { model: "fresh" }), /Unsupported model/);
  assert.throws(() => create("e", { model: "plain", effort: "low" }), /Unsupported model/);
  manager.terminateAll();
});
