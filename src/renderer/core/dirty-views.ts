import { create } from "zustand";

/** Tabs with unsaved edits (file tabs): the tab shows a dot, and closing it asks first. Not persisted. */
export const useDirtyViews = create<Record<string, boolean>>(() => ({}));

export function setViewDirty(viewId: string, dirty: boolean): void {
  if (Boolean(useDirtyViews.getState()[viewId]) === dirty) return;
  useDirtyViews.setState({ [viewId]: dirty });
}

export function isViewDirty(viewId: string): boolean {
  return Boolean(useDirtyViews.getState()[viewId]);
}

/**
 * Unsaved text of file tabs that aren't on screen (another tab, another workspace): the editor goes away with its
 * tab, so its edits wait here until the tab comes back. Cleared when the tab is closed or saved. Not persisted.
 */
export interface FileBuffer { text: string; saved: string; hash: string | null }
const buffers = new Map<string, FileBuffer>();
export const fileBuffers = {
  get: (viewId: string) => buffers.get(viewId),
  set: (viewId: string, buffer: FileBuffer) => { buffers.set(viewId, buffer); },
  delete: (viewId: string) => { buffers.delete(viewId); },
};
