import { create } from "zustand";
import type { FileViewState, Workspace } from "../../../shared/models";
import { isFilesWorkspace } from "../../../shared/files-workspace";
import { isViewDirty } from "../../core/dirty-views";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";

export interface OpenFileArgs extends FileViewState {
  workspaceId: string;
}

/** ⌘P: the Go to File box is open (for the workspace on screen). */
export const useQuickOpen = create<{ open: boolean }>(() => ({ open: false }));

const fileState = (state: unknown) => state as FileViewState | undefined;

const SEPARATOR = /[\\/]/;
const trimEnd = (folder: string) => folder.replace(/[\\/]+$/, "");

/** Where an absolute path lives: the workspace (or one of its worktrees) holding it, and the path inside that root. */
function locate(workspaces: Workspace[], absolute: string): { workspaceId: string; root: string; path: string } | undefined {
  let best: { workspaceId: string; root: string; path: string } | undefined;
  for (const workspace of workspaces) {
    if (isFilesWorkspace(workspace) || !workspace.path) continue;
    const base = trimEnd(workspace.path);
    let root: string | undefined;
    if (absolute.startsWith(`${base}-worktrees`) && SEPARATOR.test(absolute.charAt(base.length + 10))) {
      // A worktree beside the workspace: `<workspace>-worktrees/<name>/…`.
      const name = absolute.slice(base.length + 11).split(SEPARATOR)[0];
      if (name) root = `${base}-worktrees${absolute.charAt(base.length + 10)}${name}`;
    } else if (absolute.startsWith(base) && SEPARATOR.test(absolute.charAt(base.length))) root = base;
    if (!root || absolute.length <= root.length + 1) continue;
    if (!best || root.length > best.root.length) best = { workspaceId: workspace.id, root, path: absolute.slice(root.length + 1).split(SEPARATOR).join("/") };
  }
  return best;
}

/**
 * Opens files the system handed the app (Finder, the dock, File ▸ Open File…), given as absolute paths. A file inside a
 * workspace opens there with everything the workspace offers; any other file opens on its own in the Files workspace.
 */
function openFromSystem(paths: string[]): void {
  for (const absolute of paths) {
    const store = useWorkbenchStore.getState();
    const found = locate(store.workspaces, absolute);
    const cut = Math.max(absolute.lastIndexOf("/"), absolute.lastIndexOf("\\"));
    if (!found && cut <= 0) continue;
    const target = found ?? { workspaceId: store.ensureFilesWorkspace(), root: absolute.slice(0, cut), path: absolute.slice(cut + 1) };
    void services.commands.execute<void>("file.open", { ...target, preview: false } satisfies OpenFileArgs);
    const view = useWorkbenchStore.getState().workspaces.find((item) => item.id === target.workspaceId)?.activeViewId;
    if (view) void services.commands.execute("view.activate", { workspaceId: target.workspaceId, viewId: view });
  }
}

/**
 * Opens a file in a tab: the tab already showing it comes forward; otherwise a preview tab (one click) takes the place
 * of the last unedited preview tab, and a kept tab (double click, a new file) opens beside the others.
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
    const replaceable = preview
      ? workspace.views.find((item) => item.type === "file" && fileState(item.state)?.preview && !isViewDirty(item.id))
      : undefined;
    const state: FileViewState = { root, path, preview, ...view };
    if (replaceable) {
      // The same tab position shows the new file; a new id remounts the editor cleanly.
      const id = store.createView(workspaceId, "file", title, state);
      store.moveView(workspaceId, id, replaceable.id);
      store.closeView(workspaceId, replaceable.id);
      store.selectView(workspaceId, id);
      return;
    }
    store.createView(workspaceId, "file", title, state);
  });
  services.commands.register<string[]>("file.openFromSystem", openFromSystem);
  services.commands.register("file.quickOpen", () => useQuickOpen.setState({ open: true }));
}
