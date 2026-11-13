import { create } from "zustand";
import type { WorkbenchView } from "../../shared/models";
import { services } from "./services";
import type { ViewStatus } from "@dimsum/sdk";

export type { ViewStatus } from "@dimsum/sdk";

/** Live statuses published by features for views whose sessions outlive their components. */
export const useViewStatuses = create<Record<string, ViewStatus>>(() => ({}));

export function publishViewStatus(viewId: string, status: ViewStatus | undefined): void {
  const changed = JSON.stringify(useViewStatuses.getState()[viewId]) !== JSON.stringify(status);
  useViewStatuses.setState((state) => {
    const next = { ...state };
    if (status) next[viewId] = status; else delete next[viewId];
    return next;
  }, true);
  if (changed) services.events.emit("view.status", { viewId, status });
}

export function viewStatus(view: WorkbenchView, statuses: Record<string, ViewStatus>): ViewStatus | undefined {
  return statuses[view.id] ?? services.views.of(view)?.idleStatus?.(view);
}
