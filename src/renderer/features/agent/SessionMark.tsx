import type { WorkbenchView } from "../../../shared/models";
import { useViewStatuses, viewStatus } from "../../core/view-status";
import { AgentViewIcon } from "./AgentViewIcon";

/** A session's harness mark with its status dot on the corner, for lists that pick a session. */
export function SessionMark({ view }: { view: WorkbenchView }) {
  const live = useViewStatuses((statuses) => statuses[view.id]);
  const status = live ?? viewStatus(view, {});
  return <span className="send-target-mark">
    <AgentViewIcon size={15} view={view} />
    <span className={`status-dot tone-${status?.tone ?? "idle"} ${status?.unseen ? "is-unseen" : ""}`} aria-hidden="true" />
  </span>;
}
