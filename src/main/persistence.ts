import { assertInputBudget } from "../shared/input-budget";
import { app } from "electron";
import { mkdirSync, promises as fs, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PersistedState } from "../shared/models";
import { migratePersistedState, persistedStateSchema, seedDefaultInstructions } from "../shared/schemas";

const unseededEmptyState: PersistedState = {
  workspaces: [],
  personas: [
    {
      id: "persona-thoughtful-collaborator",
      name: "Thoughtful collaborator",
      description: "Clear, pragmatic, and attentive to tradeoffs.",
      instructions:
        "Work as a thoughtful collaborator. Be concise, surface important tradeoffs, and ask only questions that materially change the result.",
      scope: "global",
    },
  ],
  instructionOptions: [],
  layout: { leftCollapsed: false, rightCollapsed: false },
};
const STATE_BYTE_LIMIT = 32 * 1024 * 1024;
class StateSizeError extends Error {}
let preserveExistingState = false;

function serializedState(state: PersistedState): string {
  if (preserveExistingState) throw new Error("Existing saved state could not be safely loaded; it has been preserved. Resolve the saved-state size before saving.");
  assertInputBudget(state);
  const serialized = JSON.stringify(state, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > STATE_BYTE_LIMIT) throw new StateSizeError("Saved state exceeds 32 MB. Shorten drafts or close unused views before saving. The previous state was preserved.");
  return serialized;
}

const emptyState = seedDefaultInstructions(unseededEmptyState) as PersistedState;

function statePath() {
  return path.join(app.getPath("userData"), "workbench-state.json");
}

export async function loadState(strict = false): Promise<PersistedState> {
  try {
    await fs.chmod(statePath(), 0o600);
    if ((await fs.stat(statePath())).size > STATE_BYTE_LIMIT) throw new StateSizeError(`Existing saved state at ${statePath()} exceeds 32 MB and was preserved. Reduce its size before reopening this profile.`);
    const source = await fs.readFile(statePath(), "utf8");
    const data: unknown = JSON.parse(source);
    assertInputBudget(data);
    const result = persistedStateSchema.safeParse(migratePersistedState(data));
    if (!result.success && strict) throw new Error("Saved state did not validate.");
    if (!result.success) console.error("Workbench state did not validate; starting fresh", result.error.issues.slice(0, 5));
    return result.success ? result.data : emptyState;
  } catch (error) {
    if (error instanceof StateSizeError) { preserveExistingState = true; throw error; }
    if (strict) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Could not load workbench state", error);
    }
    return emptyState;
  }
}

/** Bumped by every save, so one still writing can't replace the state from a newer save. */
let latestSave = 0;

export async function saveState(input: unknown): Promise<PersistedState> {
  const state = persistedStateSchema.parse(input);
  const serialized = serializedState(state);
  const save = ++latestSave;
  const target = statePath();
  const temporary = `${target}.${save}.next`;
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
  if (save === latestSave) await fs.rename(temporary, target);
  else await fs.rm(temporary, { force: true });
  return state;
}

/** The last save of a closing window; written before returning because the app may exit right after. */
export function saveStateNow(input: unknown): void {
  const state = persistedStateSchema.parse(input);
  const serialized = serializedState(state);
  latestSave++;
  const target = statePath();
  const temporary = `${target}.closing`;
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
}
