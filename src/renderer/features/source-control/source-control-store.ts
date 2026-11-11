import { useEffect } from "react";
import { create } from "zustand";
import type { SourceControlChange, SourceControlStatus, Workspace } from "../../../shared/models";
import { errorMessage } from "../../core/errors";
import { watchWorkspace } from "../../core/workspace-watch";

interface SourceControlEntry {
  /** `null` when the folder is not under source control. */
  status?: SourceControlStatus | null;
  loading: boolean;
  error?: string;
}

export const useSourceControl = create<Record<string, SourceControlEntry>>(() => ({}));
const inFlight = new Map<string, Promise<void>>();
const STATUS_EVERY_MS = 2000;

export function refreshSourceControl(root: string): Promise<void> {
  const running = inFlight.get(root);
  if (running) return running;
  useSourceControl.setState((state) => ({ [root]: { ...state[root], loading: true } }));
  const promise = window.workbench.sourceControl.status(root)
    .then((status) => useSourceControl.setState({ [root]: { status, loading: false } }))
    .catch((error: unknown) => useSourceControl.setState((state) => ({ [root]: { ...state[root], loading: false, error: errorMessage(error) } })))
    .finally(() => inFlight.delete(root));
  inFlight.set(root, promise);
  return promise;
}

interface SourceControlActivity {
  /** What is running now, in words; one thing at a time per folder. */
  running?: string;
  error?: string;
  /** Goes up whenever the repository may have changed in a way status doesn't show. */
  revision: number;
}

export const useSourceControlActivity = create<Record<string, SourceControlActivity>>(() => ({}));

function updateActivity(root: string, change: (current: SourceControlActivity) => Partial<SourceControlActivity>): void {
  useSourceControlActivity.setState((state) => {
    const current = state[root] ?? { revision: 0 };
    return { [root]: { ...current, ...change(current) } };
  });
}

/** Runs something that changes the repository: false if it failed (the panel shows why) or another was already running. */
export async function runSourceControlTask(root: string, label: string, task: () => Promise<unknown>): Promise<boolean> {
  if (useSourceControlActivity.getState()[root]?.running) return false;
  updateActivity(root, () => ({ running: label, error: undefined }));
  try {
    await task();
    return true;
  } catch (error) {
    updateActivity(root, () => ({ error: errorMessage(error) }));
    return false;
  } finally {
    updateActivity(root, ({ revision }) => ({ running: undefined, revision: revision + 1 }));
    void refreshSourceControl(root);
  }
}

export function dismissSourceControlError(root: string): void {
  updateActivity(root, () => ({ error: undefined }));
}

/** Rereads status, history and stashes. */
export function reloadSourceControl(root: string): void {
  updateActivity(root, ({ revision }) => ({ revision: revision + 1 }));
  void refreshSourceControl(root);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "3 days ago", from Unix seconds. */
export function relativeTime(seconds: number): string {
  const elapsed = Date.now() / 1000 - seconds;
  for (const [unit, size] of RELATIVE_UNITS) if (elapsed >= size) return relativeFormat.format(-Math.floor(elapsed / size), unit);
  return "just now";
}

/** Status for a folder, refreshed on focus and, when live, as its files change. */
export function useSourceControlStatus(root: string | undefined, live: boolean): SourceControlEntry | undefined {
  const entry = useSourceControl((state) => (root ? state[root] : undefined));
  useEffect(() => {
    if (!root) return;
    void refreshSourceControl(root);
    const refresh = () => void refreshSourceControl(root);
    window.addEventListener("focus", refresh);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // At most one status every 2 s while files keep changing (an agent writing, a build), and one after they stop.
    let last = 0;
    const changed = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; last = Date.now(); refresh(); }, Math.max(400, last + STATUS_EVERY_MS - Date.now()));
    };
    const off = live ? watchWorkspace(root, changed) : undefined;
    return () => { window.removeEventListener("focus", refresh); clearTimeout(timer); off?.(); };
  }, [root, live]);
  return entry;
}

/** The folder the active view works in: a session's worktree or the folder its file came from, otherwise the workspace. */
export function activeRoot(workspace: Workspace): string {
  const active = workspace.views.find((view) => view.id === workspace.activeViewId);
  const state = active?.state as { cwd?: unknown; root?: unknown } | undefined;
  // A file or commit opened from this panel keeps the panel on the same folder.
  const folder = state?.cwd || state?.root;
  return typeof folder === "string" && folder ? folder : workspace.path;
}

export const CHANGE_LETTERS: Record<SourceControlChange["kind"], string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "C" };
