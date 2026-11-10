import { create } from "zustand";
import type { SessionCreateContext, TerminalSessionController, TerminalSessionProvider } from "./session-provider-registry";

/** A terminal view's shell, kept while the view is open (shown or not) and ended when it closes. */
export interface TerminalRuntime {
  controller: TerminalSessionController;
  exitCode?: number;
}

export const useTerminalRuntimes = create<{ sessions: Record<string, TerminalRuntime> }>(() => ({ sessions: {} }));
const pending = new Map<string, Promise<TerminalSessionController>>();
const generations = new Map<string, number>();
const offExit = new Map<string, () => void>();

export function startTerminalRuntime(viewId: string, provider: TerminalSessionProvider, context: SessionCreateContext): Promise<TerminalSessionController> {
  const existing = useTerminalRuntimes.getState().sessions[viewId];
  if (existing) return Promise.resolve(existing.controller);
  const inFlight = pending.get(viewId);
  if (inFlight) return inFlight;
  const generation = generations.get(viewId) ?? 0;
  const promise = provider.create({ ...context, viewId }).then((controller) => {
    if ((generations.get(viewId) ?? 0) !== generation) { controller.terminate(); controller.dispose(); throw new Error("View was closed."); }
    useTerminalRuntimes.setState((state) => ({ sessions: { ...state.sessions, [viewId]: { controller } } }));
    offExit.set(viewId, controller.onExit((exitCode) => useTerminalRuntimes.setState((state) => state.sessions[viewId]
      ? { sessions: { ...state.sessions, [viewId]: { ...state.sessions[viewId], exitCode } } } : state)));
    return controller;
  }).finally(() => { if (pending.get(viewId) === promise) pending.delete(viewId); });
  pending.set(viewId, promise);
  return promise;
}

export function closeTerminalRuntime(viewId: string): void {
  generations.set(viewId, (generations.get(viewId) ?? 0) + 1);
  const runtime = useTerminalRuntimes.getState().sessions[viewId];
  offExit.get(viewId)?.(); offExit.delete(viewId);
  if (!runtime) return;
  runtime.controller.terminate(); runtime.controller.dispose();
  useTerminalRuntimes.setState((state) => { const sessions = { ...state.sessions }; delete sessions[viewId]; return { sessions }; });
}
