import type { AgentViewState, WorkbenchView } from "../../../shared/models";
import { useAgentRuntimes, type AgentRuntime } from "../../core/agent-runtimes";
import { services } from "../../core/services";
import { publishViewStatus, type ViewStatus } from "../../core/view-status";

function providerLabel(providerId?: string): string | undefined {
  return providerId ? services.sessions.get(providerId)?.label : undefined;
}

export function agentRuntimeStatus(runtime: AgentRuntime): ViewStatus {
  const status = runtime.status;
  const detail = providerLabel(runtime.providerId);
  const description = status ? `${status.reason} (${status.rule})` : "Starting CLI…";
  if (!status || status.lifecycle === "starting") return { label: "Starting", tone: "working", detail, description };
  if (status.lifecycle === "exited") return { label: "Exited", tone: "idle", detail, description };
  if (status.lifecycle === "failed") return { label: "Failed", tone: "error", detail, description };
  switch (status.activity) {
    case "ready": return { label: "Ready", tone: "ready", detail, description, unseen: status.completed > (runtime.seenCompletion ?? 0) };
    case "working": return { label: "Working", tone: "working", detail, description };
    case "waiting-for-input": return { label: "Needs input", tone: "attention", detail, description };
    default: return { label: "Running", tone: "idle", detail, description };
  }
}

/** Agent views without a running CLI: new ones start when shown, older ones stopped when Studio did. */
export function agentIdleStatus(view: WorkbenchView): ViewStatus {
  const state = view.state as AgentViewState | undefined;
  return { label: state?.autoStart ? "Starts when opened" : "Not running", tone: "idle", detail: providerLabel(state?.providerId) };
}

/** Publishes CLI session status for every agent view, including views that are not mounted. */
export function publishAgentStatuses(): () => void {
  let published = new Set<string>();
  const sync = (sessions: Record<string, AgentRuntime>) => {
    const next = new Set(Object.keys(sessions));
    for (const viewId of published) if (!next.has(viewId)) publishViewStatus(viewId, undefined);
    for (const [viewId, runtime] of Object.entries(sessions)) publishViewStatus(viewId, agentRuntimeStatus(runtime));
    published = next;
  };
  sync(useAgentRuntimes.getState().sessions);
  return useAgentRuntimes.subscribe((state, previous) => { if (state.sessions !== previous.sessions) sync(state.sessions); });
}
