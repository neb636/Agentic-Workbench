import { create } from "zustand";
import type { FileViewState } from "../../../shared/models";
import { services } from "../../core/services";
import { isViewDirty } from "../../core/dirty-views";
import { useWorkbenchStore } from "../../state/workbench-store";

export interface OpenFileArgs extends FileViewState {
  workspaceId: string;
}

/** ⌘P: the Go to File box is open (for the piece of work on screen). */
export const useQuickOpen = create<{ open: boolean }>(() => ({ open: false }));

const fileState = (state: unknown) => state as FileViewState | undefined;

/**
 * Opens a file in a tab: the tab already showing it comes forward; otherwise a preview tab (one click) takes the place
 * of the last preview tab, and a kept tab (double click, a new file) opens beside the others.
 */
export function registerFileCommands(): void {
  services.commands.register<OpenFileArgs>("file.open", ({ workspaceId, root, path, preview = false, line, diff, diffBase }) => {
    const store = useWorkbenchStore.getState();
    const workspace = store.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    const title = path.split("/").at(-1) ?? path;
    const jump = line ? { line, lineNonce: Date.now() } : {};
    const view: Partial<FileViewState> = { ...jump, ...(diff !== undefined ? { diff } : {}), ...(diffBase ? { diffBase } : {}) };
    const existing = workspace.views.find((item) => item.type === "file" && fileState(item.state)?.root === root && fileState(item.state)?.path === path);
    if (existing) {
      store.updateViewState(workspaceId, existing.id, { ...view, ...(preview ? {} : { preview: false }) });
      store.selectView(workspaceId, existing.id);
      return;
    }
    const replaceable = preview ? workspace.views.find((item) => item.type === "file" && fileState(item.state)?.preview && !isViewDirty(item.id)) : undefined;
    const state: FileViewState = { root, path, preview, ...view };
    if (replaceable) {
      // The same tab shows the new file: a new id remounts the editor cleanly.
      const id = store.createView(workspaceId, "file", title, state);
      store.moveView(workspaceId, id, replaceable.id);
      store.closeView(workspaceId, replaceable.id);
      store.selectView(workspaceId, id);
      return;
    }
    store.createView(workspaceId, "file", title, state);
  });
  services.commands.register("file.quickOpen", () => useQuickOpen.setState({ open: true }));
}
