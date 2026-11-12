import { assertInputBudget } from "../../../shared/input-budget";
import { create } from "zustand";
import { REPO_INSTRUCTIONS_PATH, serializeRepoInstructions } from "../../../shared/instruction-layers";
import type { PromptOptionDefinition } from "../../../shared/prompt-options";
import { repoInstructionsFileSchema } from "../../../shared/schemas";
import { watchWorkspace } from "../../core/workspace-watch";
import { useWorkbenchStore } from "../../state/workbench-store";

/** The shared instructions file of one workspace root, as last read from disk. */
export type RepoInstructions =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ok"; options: PromptOptionDefinition[]; hash: string }
  | { status: "invalid"; error: string; hash?: string };

export const useRepoInstructions = create<Record<string, RepoInstructions>>(() => ({}));

const LOADING: RepoInstructions = { status: "loading" };
const FOLDER = REPO_INSTRUCTIONS_PATH.split("/")[0];

export function repoInstructionsOf(root: string | undefined): RepoInstructions {
  return (root && useRepoInstructions.getState()[root]) || LOADING;
}

/** The shared options the composer offers; nothing while the file is missing, loading, or unreadable. */
export function sharedOptionsOf(root: string | undefined): PromptOptionDefinition[] {
  const current = repoInstructionsOf(root);
  return current.status === "ok" ? current.options : [];
}

function parse(content: string, hash: string): RepoInstructions {
  let json: unknown;
  try { json = JSON.parse(content); assertInputBudget(json); } catch (error) { return { status: "invalid", error: (error as Error).message, hash }; }
  const result = repoInstructionsFileSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { status: "invalid", error: `${issue.path.join(".") || "file"}: ${issue.message}`, hash };
  }
  return { status: "ok", options: result.data.instructions, hash };
}

const reads = new Map<string, number>();

export async function loadRepoInstructions(root: string): Promise<RepoInstructions> {
  const read = (reads.get(root) ?? 0) + 1;
  reads.set(root, read);
  let next: RepoInstructions;
  try {
    const [found] = await window.workbench.files.exists(root, [REPO_INSTRUCTIONS_PATH]);
    if (!found) next = { status: "missing" };
    else {
      const file = await window.workbench.files.read(root, REPO_INSTRUCTIONS_PATH);
      next = file.binary || file.truncated ? { status: "invalid", error: "The file is not readable text.", hash: file.hash } : parse(file.content, file.hash);
    }
  } catch (error) {
    next = { status: "invalid", error: (error as Error).message };
  }
  // A newer read started while this one waited: it has the fresher answer.
  if (reads.get(root) === read) useRepoInstructions.setState({ [root]: next });
  return next;
}

/**
 * Rewrites the shared file with `update` applied to its current options. Writes only over the version last read;
 * when the file changed on disk meanwhile, nothing is written, the new version is loaded, and an error comes back.
 */
export async function saveRepoInstructions(
  root: string,
  update: (options: PromptOptionDefinition[]) => PromptOptionDefinition[],
): Promise<string | undefined> {
  const current = repoInstructionsOf(root);
  if (current.status === "invalid") return `Fix ${REPO_INSTRUCTIONS_PATH} before changing shared instructions.`;
  if (current.status === "loading") return "Shared instructions are still loading. Try again.";
  const options = update(current.status === "ok" ? current.options : []);
  try {
    if (current.status === "missing") {
      const [folder] = await window.workbench.files.exists(root, [FOLDER]);
      if (!folder) await window.workbench.files.create(root, FOLDER, "directory").catch(() => undefined);
    }
    const result = await window.workbench.files.write(root, REPO_INSTRUCTIONS_PATH, serializeRepoInstructions(options),
      current.status === "ok" ? current.hash : null);
    if (!result.ok) {
      await loadRepoInstructions(root);
      return `${REPO_INSTRUCTIONS_PATH} changed on disk and was reloaded. Try again.`;
    }
    reads.set(root, (reads.get(root) ?? 0) + 1);
    useRepoInstructions.setState({ [root]: { status: "ok", options, hash: result.hash } });
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Keeps every workspace's shared instructions loaded and current, so prompts include them before Manage opens. */
export function startRepoInstructions(): () => void {
  const watching = new Map<string, () => void>();
  const sync = (roots: string[]) => {
    for (const [root, stop] of watching) {
      if (roots.includes(root)) continue;
      stop();
      watching.delete(root);
    }
    for (const root of roots) {
      if (watching.has(root)) continue;
      void loadRepoInstructions(root);
      watching.set(root, watchWorkspace(root, (event) => {
        if (event.paths.some((path) => path === FOLDER || path.startsWith(`${FOLDER}/`))) void loadRepoInstructions(root);
      }));
    }
  };
  const rootsOf = () => [...new Set(useWorkbenchStore.getState().workspaces.map((workspace) => workspace.path))];
  let last = "";
  const onChange = () => {
    if (!useWorkbenchStore.getState().isHydrated) return;
    const roots = rootsOf();
    const key = roots.join("\0");
    if (key === last) return;
    last = key;
    sync(roots);
  };
  onChange();
  const unsubscribe = useWorkbenchStore.subscribe(onChange);
  return () => {
    unsubscribe();
    for (const stop of watching.values()) stop();
    watching.clear();
  };
}
