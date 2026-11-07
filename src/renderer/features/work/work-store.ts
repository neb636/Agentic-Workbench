import { create } from "zustand";
import type { WorkItemInfo, WorkList } from "../../../shared/models";
import { useWorkbenchStore } from "../../state/workbench-store";

interface WorkListStore {
  list?: WorkList;
  error?: string;
  loading: boolean;
  /** `pullRequests` asks GitHub again instead of using the minute-old copy. */
  refresh: (pullRequests?: boolean) => Promise<void>;
}

let inFlight: Promise<void> | undefined;

export const useWorkList = create<WorkListStore>((set) => ({
  loading: false,
  refresh: (pullRequests = false) => {
    const root = useWorkbenchStore.getState().repoRoot;
    if (!root) return Promise.resolve();
    if (inFlight && !pullRequests) return inFlight;
    set({ loading: true });
    const next = window.workbench.work.list(root, pullRequests)
      .then((list) => set({ list, error: undefined }))
      .catch((error: unknown) => set({ error: String(error).replace(/^Error: /, "") }))
      .finally(() => { set({ loading: false }); if (inFlight === next) inFlight = undefined; });
    inFlight = next;
    return next;
  },
}));

export type WorkGroup = "main" | "active" | "finished";

/** Merged, closed or vanished work is finished: it only waits to be cleaned up. */
export function workGroup(item: WorkItemInfo): WorkGroup {
  if (item.main) return "main";
  if (item.missing || item.pr?.state === "MERGED" || item.pr?.state === "CLOSED") return "finished";
  return "active";
}

/** The branch without the `login/` prefix every branch in this repo has. */
export function shortBranch(branch?: string): string | undefined {
  return branch?.includes("/") ? branch.slice(branch.indexOf("/") + 1) : branch;
}
