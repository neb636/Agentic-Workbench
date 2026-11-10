import assert from "node:assert/strict";
import test from "node:test";
import optionsModule from "../dist-electron/shared/prompt-options.js";
import assemblyModule from "../dist-electron/shared/prompt-assembly.js";
import schemasModule from "../dist-electron/shared/schemas.js";

const {
  allOf, anyOf, choice, createEvaluator, duplicateOptionIds, isChoice, isOn, multiSelect, not,
  resetSelections, resolveOptions, select, textInput, toggle, valueOf,
} = optionsModule;
const { assemblePrompt } = assemblyModule;
const { migratePersistedState, persistedStateSchema, promptOptionDefinitionSchema } = schemasModule;

const testPolicy = select("test-policy", { label: "Test policy", choices: [choice("default", "Repo defaults"), choice("custom", "Custom", "Use the custom test settings below.")] });
const testTypes = multiSelect("test-types", { label: "Test types", when: isChoice("test-policy", "custom"),
  choices: [choice("unit", "Unit", "Write unit tests."), choice("e2e", "E2E", "Write end-to-end tests.")], defaults: ["unit"] });
const openPr = toggle("open-pr", { label: "Open PR", category: "delivery", text: "Open a draft pull request." });
const reviewer = textInput("reviewer", { label: "Reviewer", when: isOn("open-pr"), template: "Request review from {{value}}." });
const options = [testPolicy, testTypes, openPr, reviewer];

test("builders produce plain data with defaults", () => {
  assert.deepEqual(toggle("t", { label: "T", text: "x" }), {
    id: "t", label: "T", description: undefined, category: undefined, when: undefined, display: undefined, resetAfterSend: undefined,
    kind: "toggle", defaultOn: false, text: "x",
  });
  assert.equal(testPolicy.defaultChoice, "default");
  assert.equal(select("empty", { label: "E", choices: [] }).defaultChoice, "");
  assert.deepEqual(textInput("x", { label: "X", template: "{{value}}" }).maxLength, 120);
  assert.deepEqual(choice("a", "A"), { id: "a", label: "A", text: "", description: undefined });
});

test("conditions combine and fall back to defaults", () => {
  const evaluator = createEvaluator(options, {});
  assert.equal(evaluator.evaluate(isChoice("test-policy", "default")), true);
  assert.equal(evaluator.evaluate(isOn("open-pr")), false);
  assert.equal(evaluator.evaluate(not(isOn("open-pr"))), true);
  assert.equal(evaluator.evaluate(allOf([isChoice("test-policy", "default"), not(isOn("open-pr"))])), true);
  assert.equal(evaluator.evaluate(anyOf([isOn("open-pr"), isChoice("test-policy", "custom")])), false);
  assert.equal(evaluator.evaluate(isOn("missing")), false);
  assert.equal(evaluator.isVisible("test-types"), false);
  assert.equal(createEvaluator(options, { "test-policy": "custom" }).evaluate(isChoice("test-types", "unit")), true);
});

test("hidden options contribute nothing and conditions on them are false", () => {
  assert.deepEqual(resolveOptions(options, { "test-types": ["e2e"], reviewer: "sam" }), []);
  const chained = toggle("chained", { label: "Chained", when: isOn("reviewer"), text: "chained" });
  assert.deepEqual(resolveOptions([...options, chained], { reviewer: "sam" }), []);
});

test("cyclic conditions resolve as hidden", () => {
  const a = toggle("a", { label: "A", when: isOn("b"), text: "a", defaultOn: true });
  const b = toggle("b", { label: "B", when: isOn("a"), text: "b", defaultOn: true });
  assert.deepEqual(resolveOptions([a, b], {}), []);
});

test("each kind resolves to its text", () => {
  const resolved = resolveOptions(options, { "test-policy": "custom", "test-types": ["unit", "e2e"], "open-pr": true, reviewer: "  sam " });
  assert.deepEqual(resolved.map((item) => item.text), [
    "Use the custom test settings below.",
    "Write unit tests.\nWrite end-to-end tests.",
    "Open a draft pull request.",
    "Request review from sam.",
  ]);
});

test("stale selections fall back to valid values", () => {
  assert.equal(valueOf(testPolicy, { "test-policy": "deleted" }), "default");
  assert.deepEqual(valueOf(testTypes, { "test-types": ["unit", "gone"] }), ["unit"]);
  assert.equal(valueOf(openPr, { "open-pr": "yes" }), false);
  assert.equal(valueOf(textInput("short", { label: "S", template: "{{value}}", maxLength: 3 }), { short: "abcdef" }), "abc");
});

test("reset after send honors option overrides of the menu default", () => {
  const sticky = toggle("sticky", { label: "Sticky", text: "s", resetAfterSend: false });
  const once = toggle("once", { label: "Once", text: "o", resetAfterSend: true });
  assert.deepEqual(resetSelections([sticky, once, openPr], { sticky: true, once: true, "open-pr": true }, false), { sticky: true, "open-pr": true });
  assert.deepEqual(resetSelections([sticky, once, openPr], { sticky: true, once: true, "open-pr": true }, true), { sticky: true });
});

test("duplicate option ids are reported", () => {
  assert.deepEqual(duplicateOptionIds([openPr, openPr, testPolicy]), ["open-pr"]);
});

test("assembly places prepended context before and appended context after the prompt", () => {
  const assembled = assemblePrompt("Fix the bug.", [
    { id: "i", source: "Instructions", kind: "instruction", content: "Open a draft PR.", enabled: true, placement: "append" },
    { id: "p", source: "Persona", kind: "persona", content: "Be careful.", enabled: true, placement: "prepend" },
    { id: "q", source: "Selection", kind: "context", content: "> log", enabled: true },
    { id: "off", source: "Off", kind: "instruction", content: "nope", enabled: false, placement: "append" },
  ]);
  assert.equal(assembled.content, "Be careful.\n\n> log\n\nFix the bug.\n\nOpen a draft PR.");
  assert.deepEqual(assembled.contributions.map((item) => item.id), ["p", "q", "i"]);
});

test("DSL definitions round-trip through the persisted schema", () => {
  for (const definition of options) {
    assert.deepEqual(promptOptionDefinitionSchema.parse(JSON.parse(JSON.stringify(definition))), JSON.parse(JSON.stringify(definition)));
  }
  assert.equal(promptOptionDefinitionSchema.safeParse({ ...openPr, when: { kind: "nope" } }).success, false);
});

test("legacy appended instructions migrate to workspace toggles", () => {
  const legacy = { workspaces: [], personas: [], selectedPersonaByWorkspace: { w: "p" }, appendedInstructions: [
    { id: "i1", workspaceId: "w", content: "Explain tradeoffs.\nAlways.", enabled: true },
    { id: "i2", workspaceId: "w", content: "   ", enabled: false },
  ] };
  const state = persistedStateSchema.parse(migratePersistedState(legacy));
  assert.deepEqual(state.instructionOptions.filter((item) => item.scope === "workspace"), [{ scope: "workspace", workspaceId: "w", option: {
    id: "i1", kind: "toggle", label: "Explain tradeoffs.", category: "Custom", defaultOn: true, text: "Explain tradeoffs.\nAlways.",
  } }]);
  assert.equal("appendedInstructions" in state, false);
  assert.deepEqual(state.layout, { leftCollapsed: false, rightCollapsed: false });
});

test("the Default CLI choice survives the persisted state schema", () => {
  assert.equal(persistedStateSchema.parse({ defaultAgentProviderId: "some.cli" }).defaultAgentProviderId, "some.cli");
  assert.equal(persistedStateSchema.parse({}).defaultAgentProviderId, undefined);
});

test("a workspace keeps a valid icon and loses only a bad one", () => {
  const workspace = (icon) => ({ workspaces: [{ id: "w", name: "W", path: "/w", icon, views: [] }] });
  const icon = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(persistedStateSchema.parse(workspace(icon)).workspaces[0].icon, icon);
  for (const bad of ["https://example.com/a.png", "data:image/svg+xml;base64,PHN2Zz4=", `data:image/png;base64,${"A".repeat(70 * 1024)}`, 7]) {
    const [parsed] = persistedStateSchema.parse(workspace(bad)).workspaces;
    assert.equal(parsed.id, "w");
    assert.equal(parsed.icon, undefined);
  }
});
