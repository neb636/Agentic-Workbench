import { create } from "zustand";
import type { FileEffect, FileHistoryState, FileLocation, FileOperation } from "../../../shared/file-operations";
import type { FileViewState, Workspace } from "../../../shared/models";
import { fileBuffers, isViewDirty, setViewDirty } from "../../core/dirty-views";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { openPanel, useExplorerRequests } from "../explorer/explorer-store";
import type { ContextAction } from "../../ui/ContextMenu";

export const useFileActions = create<{ clipboard?: { paths: FileLocation[]; cut: boolean }; history: FileHistoryState; busy: boolean; notice: string }>(() => ({ history: { undoPaths: [], redoPaths: [] }, busy: false, notice: "" }));
export const fileSaveHandlers = new Map<string, () => Promise<boolean>>();
const within = (file: FileViewState, location: FileLocation) => file.root === location.root && (file.path === location.path || file.path.startsWith(`${location.path}/`));
export async function prepareFiles(paths: FileLocation[]): Promise<boolean> {
  const dirty = useWorkbenchStore.getState().workspaces.flatMap((w) => w.views).filter((v) => v.type === "file" && isViewDirty(v.id) && paths.some((p) => within(v.state as FileViewState, p)));
  if (!dirty.length) return true;
  if (!window.confirm(`${dirty.length} open file(s) have unsaved changes. Save and continue? Cancel leaves the files unchanged.`)) return false;
  for (const view of dirty) {
    const handler = fileSaveHandlers.get(view.id);
    if (handler) { if (!await handler()) return false; }
    else {
      const buffer = fileBuffers.get(view.id), state = view.state as FileViewState;
      if (!buffer) throw new Error("Could not find unsaved text. Open the file and save it first.");
      const result = await window.workbench.files.write(state.root, state.path, buffer.text, buffer.hash);
      if (!result.ok) throw new Error(`Save conflict in ${state.path}. Open it to resolve the conflict first.`);
      fileBuffers.delete(view.id); setViewDirty(view.id, false);
    }
  }
  return true;
}
function reconcile(effects: FileEffect[]) {
  const store = useWorkbenchStore.getState();
  for (const effect of effects) {
    if (!effect.source) continue;
    for (const workspace of store.workspaces) for (const view of workspace.views) {
      if (view.type !== "file" || !within(view.state as FileViewState, effect.source)) continue;
      if (effect.removed) { store.closeView(workspace.id, view.id); fileBuffers.delete(view.id); setViewDirty(view.id, false); }
      else if (effect.target) {
        const state = view.state as FileViewState, path = effect.target.path + state.path.slice(effect.source.path.length);
        store.updateViewState(workspace.id, view.id, { root: effect.target.root, path });
        store.renameView(workspace.id, view.id, path.split("/").at(-1) ?? path);
      }
    }
  }
  window.dispatchEvent(new CustomEvent("workbench:file-effects", { detail: effects }));
}
export async function refreshFileHistory() { const history = await window.workbench.files.operate({ kind: "status" }); useFileActions.setState({ history }); }
export async function operateFiles(operation: FileOperation): Promise<void> { return services.commands.execute("file.operate", operation); }
export async function performFileOperation(operation: FileOperation): Promise<void> {
  if (useFileActions.getState().busy) return;
  const history = useFileActions.getState().history;
  const paths = "sources" in operation ? operation.sources : "source" in operation ? [operation.source] : operation.kind === "undo" ? history.undoPaths : operation.kind === "redo" ? history.redoPaths : [];
  useFileActions.setState({ busy: true, notice: "Working…" });
  try {
    if (!await prepareFiles(paths)) { useFileActions.setState({ notice: "Canceled" }); return; }
    const result = await window.workbench.files.operate(operation);
    reconcile(result.effects);
    if (operation.kind === "transfer" && operation.move) {
      const clip = useFileActions.getState().clipboard;
      if (clip) useFileActions.setState({ clipboard: { ...clip, paths: clip.paths.filter((p) => !result.effects.some((e) => e.source?.root === p.root && e.source.path === p.path)) } });
    }
    useFileActions.setState({ history: result, notice: result.errors.length ? result.errors.join("\n") : `${result.effects.length} item(s) updated` });
  } catch (error) { useFileActions.setState({ notice: String(error) }); throw error; }
  finally { useFileActions.setState({ busy: false }); }
}
export function revealFile(workspace: Workspace, location: FileLocation) {
  openPanel("files"); useExplorerRequests.setState({ reveal: { ...location, workspaceId: workspace.id, nonce: Date.now() } });
}
export async function copyPath(location: FileLocation, relative = false) { await navigator.clipboard.writeText(relative ? location.path : await window.workbench.files.locate(location.root, location.path)); }
export async function terminalAt(workspace: Workspace, location: FileLocation) {
  const cwd = await window.workbench.files.locate(location.root, location.path);
  useWorkbenchStore.getState().createView(workspace.id, "terminal", location.path.split("/").at(-1) || "Terminal", { providerId: "terminal.local", cwd });
}
function baseLocationActions(workspace: Workspace, location: FileLocation, directory = false, available = true, line?: number): ContextAction[] {
  return [
    ...(!directory ? [{ id: "open-file", label: "Open", disabled: !available, section: "open", run: () => services.commands.execute("file.open", { workspaceId: workspace.id, ...location, preview: false, diff: false, line }) }] : []),
    ...(!directory && workspace.views.some((v) => v.type === "file" && (v.state as FileViewState).root === location.root && (v.state as FileViewState).path === location.path && (v.state as FileViewState).preview) ? [{ id: "keep-open", label: "Keep Open", section: "open", run: () => services.commands.execute("file.open", { workspaceId: workspace.id, ...location, preview: false }) }] : []),
    { id: "reveal-files", label: "Reveal in Files", disabled: !available, section: "open", run: () => revealFile(workspace, location) },
    { id: "reveal-system", label: window.workbench.platform === "darwin" ? "Reveal in Finder" : window.workbench.platform === "win32" ? "Reveal in File Explorer" : "Reveal in File Manager", disabled: !available, section: "open", run: () => window.workbench.files.reveal(location.root, location.path) },
    ...(!directory ? [{ id: "open-default", label: "Open in Default App", disabled: !available, section: "open", run: () => window.workbench.files.openExternal(location.root, location.path) }] : []),
    { id: "terminal", label: directory ? "Open in Terminal" : "Open Containing Folder in Terminal", disabled: !available, section: "open", run: () => terminalAt(workspace, { root: location.root, path: directory ? location.path : location.path.split("/").slice(0, -1).join("/") }) },
    { id: "copy-absolute", label: "Copy Path", section: "paths", run: () => copyPath(location) },
    { id: "copy-relative", label: "Copy Relative Path", section: "paths", run: () => copyPath(location, true) },
  ];
}

export function registerFileActionContributions(): void {
  window.workbench.files.onProgress(({ completed, total, path }) => useFileActions.setState({ notice: `${completed + 1} of ${total}: ${path}` }));
  services.commands.register<FileOperation>("file.operate", performFileOperation);
  services.contextMenus.register({ id: "file.location-actions", kind: "file", items: (context) => context.kind === "file" ? baseLocationActions(context.workspace, context.location, context.directory, context.available, context.line) : [] });
}
export function locationActions(workspace: Workspace, location: FileLocation, directory = false, available = true, line?: number): ContextAction[] {
  return services.contextMenus.forTarget({ kind: "file", workspace, location, directory, available, line });
}
