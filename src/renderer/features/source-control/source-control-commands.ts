import type { CommitFileViewState } from "../../../shared/models";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";

export interface OpenCommitFileArgs extends CommitFileViewState {
  workspaceId: string;
}

const commitFileState = (state: unknown) => state as CommitFileViewState | undefined;

/** One tab shows a commit's file at a time, like a preview tab: clicking through a commit doesn't pile up tabs. */
export function registerSourceControlCommands(): void {
  services.commands.register<OpenCommitFileArgs>("sourceControl.openCommitFile", ({ workspaceId, ...state }) => {
    const store = useWorkbenchStore.getState();
    const workspace = store.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    const existing = workspace.views.filter((item) => item.type === "commit-file");
    const same = existing.find((item) => commitFileState(item.state)?.commitId === state.commitId && commitFileState(item.state)?.path === state.path && commitFileState(item.state)?.root === state.root);
    if (same) {
      // A commit never changes, but the index does.
      if (state.commitId === "index") store.updateViewState(workspaceId, same.id, { reloaded: Date.now() });
      store.selectView(workspaceId, same.id);
      return;
    }
    const id = store.createView(workspaceId, "commit-file", `${state.path.split("/").at(-1) ?? state.path} @ ${state.shortId}`, state);
    if (existing[0]) {
      store.moveView(workspaceId, id, existing[0].id);
      store.closeView(workspaceId, existing[0].id);
      store.selectView(workspaceId, id);
    }
  });
}
