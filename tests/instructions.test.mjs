import assert from "node:assert/strict";
import test from "node:test";
import defaultsModule from "../dist-electron/shared/default-instructions.js";
import layersModule from "../dist-electron/shared/instruction-layers.js";
import optionsModule from "../dist-electron/shared/prompt-options.js";
import schemasModule from "../dist-electron/shared/schemas.js";

const { defaultInstructions } = defaultsModule;
const { activeInstructions, layerInstructions, serializeRepoInstructions } = layersModule;
const { toggle } = optionsModule;
const { migratePersistedState, persistedStateSchema, repoInstructionsFileSchema } = schemasModule;

const defaultIds = defaultInstructions.map((option) => option.id);
const load = (input) => persistedStateSchema.parse(migratePersistedState(input));

test("defaults are seeded once as ordinary global instructions", () => {
  const state = load({});
  assert.deepEqual(state.instructionOptions.map((item) => [item.scope, item.option.id]), defaultIds.map((id) => ["global", id]));
  assert.deepEqual(state.seededInstructionIds, defaultIds);
  // A second load changes nothing.
  assert.deepEqual(load(state), state);
});

test("a deleted default stays deleted, and an edited one is kept", () => {
  const seeded = load({});
  const edited = { ...seeded.instructionOptions[1], option: { ...seeded.instructionOptions[1].option, text: "My own PR text." } };
  const state = load({ ...seeded, instructionOptions: [edited] });
  assert.deepEqual(state.instructionOptions, [edited]);
});

test("state from before seeding gets the defaults ahead of its own instructions", () => {
  const own = { scope: "workspace", workspaceId: "w", option: toggle("mine", { label: "Mine", text: "Mine." }) };
  const state = load({ instructionOptions: [own] });
  assert.deepEqual(state.instructionOptions.map((item) => item.option.id), [...defaultIds, "mine"]);
});

test("a default already present under its id is not added twice", () => {
  const custom = { scope: "workspace", workspaceId: "w", option: toggle("open-pr", { label: "Open PR my way", text: "x" }) };
  const state = load({ instructionOptions: [custom] });
  assert.equal(state.instructionOptions.filter((item) => item.option.id === "open-pr").length, 1);
  assert.equal(state.instructionOptions.find((item) => item.option.id === "open-pr").option.label, "Open PR my way");
});

test("workspaces remember which instructions are off there", () => {
  const state = load({ workspaces: [{ id: "w", name: "W", path: "/w", views: [], disabledInstructionIds: ["open-pr"] }] });
  assert.deepEqual(state.workspaces[0].disabledInstructionIds, ["open-pr"]);
});

test("the repo instructions file is versioned and validated", () => {
  const option = toggle("team", { label: "Team rule", text: "Follow the team rule." });
  const text = serializeRepoInstructions([option]);
  assert.ok(text.endsWith("}\n"));
  assert.match(text, /\n {2}"version": 1,/);
  assert.equal(repoInstructionsFileSchema.safeParse(JSON.parse(text)).success, true);
  assert.equal(repoInstructionsFileSchema.safeParse({ version: 2, instructions: [] }).success, false);
  assert.equal(repoInstructionsFileSchema.safeParse({ version: 1, instructions: [{ id: "x", kind: "toggle" }] }).success, false);
  assert.equal(repoInstructionsFileSchema.safeParse({ instructions: [] }).success, false);
});

test("layers order, turn off, and replace instructions for one workspace", () => {
  const global = (id) => ({ scope: "global", option: toggle(id, { label: id, text: id }) });
  const personal = (id, workspaceId) => ({ scope: "workspace", workspaceId, option: toggle(id, { label: id, text: id }) });
  const shared = [toggle("team", { label: "team", text: "team" }), toggle("replaced", { label: "shared copy", text: "s" }), toggle("team", { label: "dupe", text: "d" })];
  const layered = layerInstructions({
    stored: [personal("mine", "w"), global("a"), global("off"), global("replaced"), personal("elsewhere", "other")],
    shared,
    workspaceId: "w",
    disabledIds: ["off", "team", "mine"],
  });
  assert.deepEqual(layered.map((item) => [item.layer, item.option.id, item.disabled, item.replaced]), [
    ["global", "a", false, false],
    ["global", "off", true, false],
    ["global", "replaced", false, true],
    ["shared", "team", true, false],
    ["shared", "replaced", false, false],
    // Personal instructions are deleted, not turned off.
    ["personal", "mine", false, false],
  ]);
  assert.deepEqual(activeInstructions(layered).map((item) => item.option.label), ["a", "shared copy", "mine"]);
});
