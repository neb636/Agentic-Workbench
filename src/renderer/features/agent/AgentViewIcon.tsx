import { savedConversation } from "../../../shared/agent-conversations";
import type { AgentViewState, WorkbenchView } from "../../../shared/models";
import { useAgentRuntimes } from "../../core/agent-runtimes";
import { services } from "../../core/services";
import { AgentIcon } from "../../ui/icons";
import { useDefaultHarness } from "./agent-models";

/** A session's harness mark. Without a view, or before the harness is known, this is the generic agent icon. */
export function AgentViewIcon({ size, view }: { size?: number; view?: WorkbenchView }) {
  const fallback = useDefaultHarness((state) => state.id);
  const running = useAgentRuntimes((state) => (view ? state.sessions[view.id]?.providerId : undefined));
  const viewState = view?.state as AgentViewState | undefined;
  const harness = running ?? savedConversation(viewState)?.providerId ?? viewState?.providerId ?? fallback;
  const Mark = (view && harness && services.sessions.get(harness)?.icon) || AgentIcon;
  return <Mark size={size} />;
}
