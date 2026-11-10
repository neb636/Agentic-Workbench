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
const emptyState = seedDefaultInstructions(unseededEmptyState) as PersistedState;

function statePath() {
  return path.join(app.getPath("userData"), "workbench-state.json");
}

export async function loadState(): Promise<PersistedState> {
  try {
    const source = await fs.readFile(statePath(), "utf8");
    const result = persistedStateSchema.safeParse(migratePersistedState(JSON.parse(source)));
    if (!result.success) console.error("Workbench state did not validate; starting fresh", result.error.issues.slice(0, 5));
    return result.success ? result.data : emptyState;
  } catch (error) {
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
  const save = ++latestSave;
  const target = statePath();
  const temporary = `${target}.next`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  if (save === latestSave) await fs.rename(temporary, target);
  return state;
}

/** The last save of a closing window; written before returning because the app may exit right after. */
export function saveStateNow(input: unknown): void {
  const state = persistedStateSchema.parse(input);
  latestSave++;
  const target = statePath();
  const temporary = `${target}.closing`;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
  renameSync(temporary, target);
}
