import type { AgentViewState } from "../../../shared/models";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";

/** A new agent tab whose CLI starts as soon as it's shown (the last-used CLI unless one is named). */
export function newAgent(workspaceId: string, providerId?: string, resume = false): string {
  const label = providerId ? services.sessions.get(providerId)?.label : undefined;
  return useWorkbenchStore.getState().createView(workspaceId, "agent", resume ? "Resumed session" : label ?? "Untitled",
    { autoTitle: true, autoStart: true, ...(providerId ? { providerId } : {}), ...(resume ? { resume: true } : {}) } satisfies AgentViewState);
}
