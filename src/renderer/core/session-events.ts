import type { AgentSessionEvent, PtyDataEvent, PtyExitEvent } from "../../shared/models";

type Listener<T> = (event: T) => void;

/**
 * One listener per event channel for the whole window, handing each event to its own session's subscribers. A listener
 * per session (and per attach) meant every chunk of every session's output crossed into every subscriber.
 */
function demux<T extends { sessionId: string }>(install: (listener: Listener<T>) => () => void) {
  const bySession = new Map<string, Set<Listener<T>>>();
  let uninstall: (() => void) | undefined;
  return (sessionId: string, listener: Listener<T>): (() => void) => {
    uninstall ??= install((event) => bySession.get(event.sessionId)?.forEach((notify) => notify(event)));
    let listeners = bySession.get(sessionId);
    if (!listeners) { listeners = new Set(); bySession.set(sessionId, listeners); }
    listeners.add(listener);
    return () => {
      const current = bySession.get(sessionId);
      if (!current?.delete(listener) || current.size) return;
      bySession.delete(sessionId);
      if (!bySession.size) { uninstall?.(); uninstall = undefined; }
    };
  };
}

export const onAgentSessionEvent = demux<AgentSessionEvent>((listener) => window.workbench.agent.onEvent(listener));
export const onPtyData = demux<PtyDataEvent>((listener) => window.workbench.pty.onData(listener));
export const onPtyExit = demux<PtyExitEvent>((listener) => window.workbench.pty.onExit(listener));
