import type { PersistedState, StoredPromptOption } from "../shared/models";
import type { PromptOptionDefinition } from "../shared/prompt-options";
import { readLayers, writeLayer } from "./config-layers";

/**
 * Instructions used to live in the app's saved state. They now live in layered files: everywhere-instructions in
 * `~/.dimsum/instructions.json`, one workspace's own in `<workspace>/.dimsum/instructions.local.json`. Anything still
 * in the saved state (an older profile, or defaults seeded just now) moves there, merged by id: a file's own entry
 * is never replaced. What can't be written stays in the state and is tried again on the next start.
 */
export async function moveInstructionsToFiles(state: PersistedState): Promise<PersistedState> {
  if (!state.instructionOptions.length) return state;
  const targets = new Map<string, { scope: "user" | "local"; root?: string; items: StoredPromptOption[] }>();
  for (const item of state.instructionOptions) {
    const workspace = item.scope === "workspace" ? state.workspaces.find((entry) => entry.id === item.workspaceId && entry.kind !== "files" && entry.path) : undefined;
    // A workspace instruction whose workspace is gone had nowhere to show; it stays put.
    if (item.scope === "workspace" && !workspace) continue;
    const key = workspace ? workspace.path : "";
    const target = targets.get(key) ?? { scope: workspace ? "local" as const : "user" as const, root: workspace?.path, items: [] };
    target.items.push(item);
    targets.set(key, target);
  }
  const moved = new Set<StoredPromptOption>();
  for (const target of targets.values()) {
    try {
      const layers = await readLayers("instructions", target.root);
      const document = target.scope === "user" ? layers.user : layers.local;
      if (document?.status === "invalid") continue;
      const existing = (document?.value as { instructions: PromptOptionDefinition[] } | undefined)?.instructions ?? [];
      const ids = new Set(existing.map((option) => option.id));
      const added = target.items.map((item) => item.option).filter((option) => !ids.has(option.id));
      const result = added.length
        ? await writeLayer("instructions", target.scope, target.root, { version: 1, instructions: [...existing, ...added] }, document?.hash ?? null)
        : { ok: true as const };
      if (result.ok) for (const item of target.items) moved.add(item);
    } catch (error) {
      console.warn("Could not move instructions to their files; they stay in the saved state for now.", String(error));
    }
  }
  return { ...state, instructionOptions: state.instructionOptions.filter((item) => !moved.has(item)) };
}
