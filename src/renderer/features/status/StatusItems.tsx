import { useViewStatuses, type ViewStatus } from "../../core/view-status";

const urgency: ViewStatus["tone"][] = ["error", "attention", "working", "ready", "idle"];

/** Live sessions grouped by provider, each shown with its most urgent state. */
export function SessionSummary() {
  const statuses = useViewStatuses();
  const groups = new Map<string, ViewStatus[]>();
  for (const status of Object.values(statuses)) groups.set(status.detail ?? "Session", [...(groups.get(status.detail ?? "Session") ?? []), status]);
  if (!groups.size) return <span className="status-item status-muted">No running sessions</span>;
  return <>{[...groups.entries()].map(([provider, items]) => {
    const tone = urgency.find((candidate) => items.some((item) => item.tone === candidate)) ?? "idle";
    const working = items.filter((item) => item.tone === "working").length;
    const waiting = items.filter((item) => item.tone === "attention").length;
    return <span key={provider} className={`status-item tone-${tone}`} title={`${items.length} ${provider} ${items.length === 1 ? "session" : "sessions"}`}>
      <span className="status-dot" />{provider} {items.length}
      {working > 0 && <span className="status-muted">· {working} working</span>}
      {waiting > 0 && <span className="status-muted">· {waiting} need input</span>}
    </span>;
  })}</>;
}
