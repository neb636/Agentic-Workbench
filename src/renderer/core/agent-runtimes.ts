import { create } from "zustand";
import type { AgentModelSettings, AgentSessionStatus } from "../../shared/models";
import type { AgentProvider, AgentSessionController, SessionCreateContext } from "./session-provider-registry";

export interface AgentRuntime {
  controller: AgentSessionController;
  providerId: string;
  status?: AgentSessionStatus;
  seenCompletion?: number;
  /** The model and effort it was launched with (null: the CLI's defaults); undefined for a resumed conversation. */
  settings?: AgentModelSettings | null;
  /** A prompt has gone to this conversation, so changing the model now means a new one. */
  prompted?: boolean;
}
export const useAgentRuntimes = create<{ sessions: Record<string, AgentRuntime> }>(() => ({ sessions: {} }));
const pending = new Map<string, Promise<AgentSessionController>>();
const generations = new Map<string, number>();
const offStatus = new Map<string, () => void>();
const READY_TIMEOUT = 45_000;
/** While the CLI waits on the person (a question, a draft in its input) a held prompt waits longer. */
const PERSON_TIMEOUT = 5 * 60_000;

export function startAgentRuntime(viewId: string, provider: AgentProvider, context: SessionCreateContext): Promise<AgentSessionController> {
  const existing = useAgentRuntimes.getState().sessions[viewId];
  if (existing) return Promise.resolve(existing.controller);
  const inFlight = pending.get(viewId);
  if (inFlight) return inFlight;
  const generation = generations.get(viewId) ?? 0;
  const promise = provider.create({ ...context, viewId }).then((controller) => {
    if ((generations.get(viewId) ?? 0) !== generation) { controller.terminate(); controller.dispose(); throw new Error("View was closed."); }
    const settings = context.resume ? undefined : context.settings ?? null;
    useAgentRuntimes.setState((state) => ({ sessions: { ...state.sessions, [viewId]: { controller, providerId: provider.id, settings } } }));
    offStatus.set(viewId, controller.onStatus((status) => useAgentRuntimes.setState((state) => ({ sessions: {
      ...state.sessions, [viewId]: { ...state.sessions[viewId], controller, providerId: provider.id, status },
    } }))));
    return controller;
  }).finally(() => { if (pending.get(viewId) === promise) pending.delete(viewId); });
  pending.set(viewId, promise);
  return promise;
}

export function markAgentPrompted(viewId: string): void {
  const runtime = useAgentRuntimes.getState().sessions[viewId];
  if (!runtime || runtime.prompted) return;
  useAgentRuntimes.setState((state) => ({ sessions: { ...state.sessions, [viewId]: { ...runtime, prompted: true } } }));
}

/** Nothing has happened in this conversation yet, from the composer or typed in the terminal, so restarting it loses nothing. */
export function isUnusedConversation(runtime: AgentRuntime): boolean {
  const status = runtime.status;
  return !runtime.prompted && Boolean(status) && status!.started === 0 && status!.activity !== "working" && status!.inputState !== "draft";
}

/**
 * Waits until the CLI shows an input it can accept a prompt in; trust and sign-in prompts are answered in the terminal.
 * With `idle`, also until it has stopped working: an input can be open during startup work, but a mode switch can't happen then.
 */
export function untilSubmittable(controller: AgentSessionController, idle = false): Promise<void> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    let waitingOnPerson = false;
    const expire = () => { off(); reject(new Error("The CLI is not ready for a prompt yet. Answer it in the terminal, then send again.")); };
    let timer = setTimeout(expire, READY_TIMEOUT);
    const settle = (status: AgentSessionStatus) => {
      const person = status.activity === "waiting-for-input" || status.inputState === "draft";
      if (person !== waitingOnPerson) { waitingOnPerson = person; clearTimeout(timer); timer = setTimeout(expire, person ? PERSON_TIMEOUT : READY_TIMEOUT); }
      if (status.canSubmit && (!idle || status.activity === "ready")) { clearTimeout(timer); queueMicrotask(() => off()); resolve(); }
      else if (status.lifecycle === "exited" || status.lifecycle === "failed") { clearTimeout(timer); queueMicrotask(() => off()); reject(new Error(status.reason)); }
    };
    off = controller.onStatus(settle);
  });
}

export function acknowledgeAgentCompletion(viewId: string): void {
  const runtime = useAgentRuntimes.getState().sessions[viewId];
  if (!runtime || runtime.seenCompletion === runtime.status?.completed) return;
  useAgentRuntimes.setState((state) => ({ sessions: { ...state.sessions, [viewId]: { ...runtime, seenCompletion: runtime.status?.completed } } }));
}

export function closeAgentRuntime(viewId: string): void {
  generations.set(viewId, (generations.get(viewId) ?? 0) + 1);
  const runtime = useAgentRuntimes.getState().sessions[viewId];
  offStatus.get(viewId)?.(); offStatus.delete(viewId);
  runtime?.controller.terminate(); runtime?.controller.dispose();
  useAgentRuntimes.setState((state) => { const sessions = { ...state.sessions }; delete sessions[viewId]; return { sessions }; });
}
