import { create } from "zustand";
import { useWorkbenchStore } from "../../state/workbench-store";

export type FileSearchMode = "names" | "contents";

/** One-shot requests to the Files panel (⇧⌘F focuses its Contents search). Not persisted. */
interface ExplorerRequests {
  search?: { mode: FileSearchMode; nonce: number };
}

export const useExplorerRequests = create<ExplorerRequests>(() => ({}));

/** Shows the right sidebar on a panel, optionally focusing the Files panel's search. */
export function openPanel(panelId: string, options: { search?: FileSearchMode } = {}): void {
  useWorkbenchStore.getState().updateLayout({ rightPanel: panelId, rightCollapsed: false });
  if (options.search) useExplorerRequests.setState({ search: { mode: options.search, nonce: Date.now() } });
}
