import type { WorkbenchEvents } from "@dimsum/sdk";
import type { Workspace } from "../../shared/models";
import { services } from "../core/services";
import { useWorkbenchStore } from "../state/workbench-store";

type Notice = { [K in keyof WorkbenchEvents]: [K, WorkbenchEvents[K]] }[keyof WorkbenchEvents];

/** The events between two snapshots of the saved workspaces, in the order they are announced. */
function changes(previous: Workspace[], workspaces: Workspace[]): Notice[] {
  const notices: Notice[] = [];
  const before = new Map(previous.map((workspace) => [workspace.id, workspace]));
  const after = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  for (const workspace of workspaces) {
    const old = before.get(workspace.id);
    if (!old) notices.push(["workspace.opened", { workspaceId: workspace.id, root: workspace.path }]);
    if (old?.views === workspace.views && old.activeViewId === workspace.activeViewId) continue;
    const oldViews = new Set(old?.views.map((view) => view.id));
    for (const view of workspace.views) if (!oldViews.has(view.id)) notices.push(["view.opened", { workspaceId: workspace.id, viewId: view.id, type: view.type }]);
    const newViews = new Set(workspace.views.map((view) => view.id));
    for (const view of old?.views ?? []) if (!newViews.has(view.id)) notices.push(["view.closed", { workspaceId: workspace.id, viewId: view.id, type: view.type }]);
    const active = workspace.views.find((view) => view.id === workspace.activeViewId);
    if (active && old?.activeViewId !== active.id) notices.push(["view.activated", { workspaceId: workspace.id, viewId: active.id, type: active.type }]);
  }
  for (const workspace of previous) {
    if (after.has(workspace.id)) continue;
    for (const view of workspace.views) notices.push(["view.closed", { workspaceId: workspace.id, viewId: view.id, type: view.type }]);
    notices.push(["workspace.closed", { workspaceId: workspace.id, root: workspace.path }]);
  }
  return notices;
}

/**
 * Turns changes to the saved workspaces into events: workspaces and views opening and closing, and the shown view
 * changing. The first state after loading counts as opening everything in it, so a late subscriber still learns
 * what is open by reading the store.
 *
 * A handler may change the store itself (open or activate a view), which re-enters here. The snapshot moves on before
 * any handler runs and every event goes through one queue, so each change is announced once, in order.
 */
export function publishWorkbenchEvents(): () => void {
  let previous: Workspace[] = [];
  const queue: Notice[] = [];
  let draining = false;
  const publish = (workspaces: Workspace[]) => {
    queue.push(...changes(previous, workspaces));
    previous = workspaces;
    if (draining) return;
    draining = true;
    try {
      // Each notice pairs a name with its own payload (see `Notice`); the bus's signature can't see that through the union.
      for (let notice = queue.shift(); notice; notice = queue.shift()) services.events.emit(notice[0], notice[1] as never);
    } finally {
      draining = false;
    }
  };
  return useWorkbenchStore.subscribe((state, last) => {
    if (!state.isHydrated || (state.workspaces === last.workspaces && last.isHydrated)) return;
    publish(state.workspaces);
  });
}
