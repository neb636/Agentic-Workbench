import { savedConversation } from "../../../shared/agent-conversations";
import type { AgentViewState, WorkbenchView } from "../../../shared/models";
import { useAgentRuntimes } from "../../core/agent-runtimes";
import { useWorkbenchStore } from "../../state/workbench-store";
import type { DestructiveConfirmation } from "../../ui/confirm";
import { AgentViewIcon } from "./AgentViewIcon";
import { agentIdleStatus, agentRuntimeStatus } from "./session-status";

/** Closing a session that never started loses nothing, so only a running CLI or a saved conversation asks first. */
export function agentCloseConfirmation(view: WorkbenchView): DestructiveConfirmation | undefined {
  const runtime = useAgentRuntimes.getState().sessions[view.id];
  const state = view.state as AgentViewState | undefined;
  if (!runtime && !savedConversation(state)) return undefined;
  const status = runtime ? agentRuntimeStatus(runtime) : agentIdleStatus(view);
  const live = runtime && status.label !== "Exited" && status.label !== "Failed";
  const workspace = useWorkbenchStore.getState().workspaces.find((item) => item.id === view.workspaceId);
  return {
    title: "Close agent session",
    message: "Are you sure you want to close the following session?",
    warning: <><strong>Warning:</strong> This action <strong>cannot be undone</strong>. {live
      ? <>Closing the session <strong>stops its CLI</strong>, interrupting anything it is doing, and removes it from the workbench.</>
      : <>The session and its saved conversation are <strong>removed from the workbench</strong>.</>} Files on disk, including any worktree, are kept.</>,
    subject: {
      icon: <AgentViewIcon size={20} view={view} />,
      name: view.title,
      detail: [status.label, status.detail].filter(Boolean).join(" · "),
      meta: state?.cwd ?? workspace?.path,
    },
    confirmLabel: "Yes, Close Session",
  };
}
