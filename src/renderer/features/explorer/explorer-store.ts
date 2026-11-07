import { create } from "zustand";
import type { ExplorerTab } from "../../../shared/models";
import { useWorkbenchStore } from "../../state/workbench-store";

/** One-shot requests to the explorer (⇧⌘F focuses Contents search). Not persisted. */
interface ExplorerRequests {
  search?: { mode: "names" | "contents"; nonce: number };
}

export const useExplorerRequests = create<ExplorerRequests>(() => ({}));

export function toggleExplorer(collapsed?: boolean): void {
  const { layout, updateLayout } = useWorkbenchStore.getState();
  updateLayout({ explorer: { ...layout.explorer, collapsed: collapsed ?? !layout.explorer?.collapsed } });
}

/** Shows the explorer on a tab (and optionally focuses its search). */
export function openExplorer(tab: ExplorerTab, options: { search?: "names" | "contents" } = {}): void {
  const { layout, updateLayout } = useWorkbenchStore.getState();
  updateLayout({ explorer: { ...layout.explorer, collapsed: false, tab } });
  if (options.search) useExplorerRequests.setState({ search: { mode: options.search, nonce: Date.now() } });
}
