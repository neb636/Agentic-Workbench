import { useEffect } from "react";
import { create } from "zustand";
import type { ResourceSnapshot, ResourceSummary } from "../../../shared/models";
import { errorMessage } from "../../core/errors";

interface ResourceState {
  snapshot?: ResourceSnapshot;
  summary?: ResourceSummary;
  error?: string;
}

export const useResources = create<ResourceState>(() => ({}));
/** Each sample is a process listing, so the manager refreshes this often only while it is open. */
const SNAPSHOT_EVERY_MS = 2000;
/** The status bar's figure, while the manager is closed. */
const SUMMARY_EVERY_MS = 15_000;
let epoch = 0;

/** A response that comes back after a newer request started is dropped. */
export function refreshResources(): Promise<void> {
  const current = ++epoch;
  return window.workbench.resources.snapshot().then((snapshot) => {
    if (current !== epoch) return;
    useResources.setState({ snapshot, error: undefined,
      summary: { memoryBytes: snapshot.total.memoryBytes, sessions: snapshot.sessions.filter((session) => !session.exited).length } });
  }).catch((error: unknown) => { if (current === epoch) useResources.setState({ error: errorMessage(error) }); });
}

function refreshSummary(): void {
  const current = epoch;
  void window.workbench.resources.summary().then((summary) => { if (current === epoch) useResources.setState({ summary }); }).catch(() => undefined);
}

/** Runs `tick` now and on an interval, but never while the window is hidden; it catches up when the window shows. */
function useVisibleInterval(enabled: boolean, everyMs: number, tick: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => { if (timer || document.hidden) return; tick(); timer = setInterval(tick, everyMs); };
    const stop = () => { clearInterval(timer); timer = undefined; };
    const visibility = () => { if (document.hidden) stop(); else start(); };
    start();
    document.addEventListener("visibilitychange", visibility);
    return () => { stop(); document.removeEventListener("visibilitychange", visibility); };
  }, [enabled, everyMs, tick]);
}

const tickSnapshot = () => void refreshResources();

export function useResourcePolling(open: boolean): void {
  useVisibleInterval(open, SNAPSHOT_EVERY_MS, tickSnapshot);
  useVisibleInterval(!open, SUMMARY_EVERY_MS, refreshSummary);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatCpu(cpu: number): string {
  return `${cpu.toFixed(1)}%`;
}
