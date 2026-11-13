import type { Workspace } from "../../shared/models";
import { services } from "../core/services";
import { useWorkbenchStore } from "../state/workbench-store";

/**
 * Turns changes to the saved workspaces into events: workspaces and views opening and closing, and the shown view
 * changing. The first state after loading counts as opening everything in it, so a late subscriber still learns
 * what is open by reading the store.
 */
export function publishWorkbenchEvents(): () => void {
  let previous: Workspace[] = [];
  const emit = (workspaces: Workspace[]) => {
    const before = new Map(previous.map((workspace) => [workspace.id, workspace]));
    const after = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    for (const workspace of workspaces) {
      const old = before.get(workspace.id);
      if (!old) services.events.emit("workspace.opened", { workspaceId: workspace.id, root: workspace.path });
      if (old?.views === workspace.views && old.activeViewId === workspace.activeViewId) continue;
      const oldViews = new Set(old?.views.map((view) => view.id));
      for (const view of workspace.views) if (!oldViews.has(view.id)) services.events.emit("view.opened", { workspaceId: workspace.id, viewId: view.id, type: view.type });
      const newViews = new Set(workspace.views.map((view) => view.id));
      for (const view of old?.views ?? []) if (!newViews.has(view.id)) services.events.emit("view.closed", { workspaceId: workspace.id, viewId: view.id, type: view.type });
      const active = workspace.views.find((view) => view.id === workspace.activeViewId);
      if (active && old?.activeViewId !== active.id) services.events.emit("view.activated", { workspaceId: workspace.id, viewId: active.id, type: active.type });
    }
    for (const workspace of previous) {
      if (after.has(workspace.id)) continue;
      for (const view of workspace.views) services.events.emit("view.closed", { workspaceId: workspace.id, viewId: view.id, type: view.type });
      services.events.emit("workspace.closed", { workspaceId: workspace.id, root: workspace.path });
    }
    previous = workspaces;
  };
  return useWorkbenchStore.subscribe((state, last) => {
    if (!state.isHydrated || (state.workspaces === last.workspaces && last.isHydrated)) return;
    emit(state.workspaces);
  });
}
