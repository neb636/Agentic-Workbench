import type { StoredPromptOption } from "./models";
import type { PromptOptionDefinition } from "./prompt-options";

/**
 * Where an instruction lives:
 * - global: the person's own, in every workspace (app state);
 * - shared: checked into the workspace (`.workbench/instructions.json`), for everyone who works there;
 * - personal: the person's own, in one workspace only (app state, never committed).
 */
export type InstructionLayer = "global" | "shared" | "personal";

export const REPO_INSTRUCTIONS_PATH = ".workbench/instructions.json";

export interface LayeredInstruction {
  layer: InstructionLayer;
  option: PromptOptionDefinition;
  /** Turned off for this workspace by the person. */
  disabled: boolean;
  /** A shared instruction with the same id takes its place in this workspace. */
  replaced: boolean;
}

export function layerOf(stored: StoredPromptOption): InstructionLayer {
  return stored.scope === "global" ? "global" : "personal";
}

/**
 * Every instruction that applies to one workspace, in menu order: global, shared, then personal.
 * A shared instruction replaces a stored one with the same id, so the team's version wins in its repo.
 */
export function layerInstructions(input: {
  stored: StoredPromptOption[];
  shared: PromptOptionDefinition[];
  workspaceId: string;
  disabledIds: readonly string[];
}): LayeredInstruction[] {
  const disabled = new Set(input.disabledIds);
  const sharedIds = new Set<string>();
  const shared: PromptOptionDefinition[] = [];
  for (const option of input.shared) {
    if (sharedIds.has(option.id)) continue;
    sharedIds.add(option.id);
    shared.push(option);
  }
  const stored = input.stored.filter((item) => item.scope === "global" || item.workspaceId === input.workspaceId);
  const entry = (layer: InstructionLayer, option: PromptOptionDefinition): LayeredInstruction => ({
    layer,
    option,
    disabled: layer !== "personal" && disabled.has(option.id),
    replaced: layer !== "shared" && sharedIds.has(option.id),
  });
  return [
    ...stored.filter((item) => item.scope === "global").map((item) => entry("global", item.option)),
    ...shared.map((option) => entry("shared", option)),
    ...stored.filter((item) => item.scope === "workspace").map((item) => entry("personal", item.option)),
  ];
}

/** The options the composer offers in a workspace: everything not turned off or replaced. */
export function activeInstructions(layered: LayeredInstruction[]): LayeredInstruction[] {
  return layered.filter((item) => !item.disabled && !item.replaced);
}

/** The text of a shared instructions file: stable and pretty, so its diffs are easy to review. */
export function serializeRepoInstructions(options: PromptOptionDefinition[]): string {
  return `${JSON.stringify({ version: 1, instructions: options }, null, 2)}\n`;
}
