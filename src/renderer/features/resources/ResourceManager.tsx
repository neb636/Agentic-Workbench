import { useState } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Popover, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import type { ResourceUsage, SessionResource, WorkbenchView as View, Workspace } from "../../../shared/models";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { confirmDestructive } from "../../ui/confirm";
import { Button, IconButton } from "../../ui/controls";
import { AgentIcon, ChevronDownIcon, ChevronRightIcon, MemoryIcon, RefreshIcon, TerminalIcon, TrashIcon } from "../../ui/icons";
import { formatBytes, formatCpu, refreshResources, useResourcePolling, useResources } from "./resource-store";

type SortKey = "cpu" | "memoryBytes";

interface SessionRow { session: SessionResource; view?: View }
interface Group { id: string; name: string; workspace?: Workspace; rows: SessionRow[] }

/** Sessions by the workspace whose view shows them; those no open view shows come last. */
function groupSessions(sessions: SessionResource[], workspaces: Workspace[]): Group[] {
  const groups = new Map<string, Group>();
  const orphans: Group = { id: "orphans", name: "No open view", rows: [] };
  for (const session of sessions) {
    const workspace = workspaces.find((item) => item.views.some((view) => view.id === session.viewId));
    const view = workspace?.views.find((item) => item.id === session.viewId);
    if (!workspace || !view) { orphans.rows.push({ session }); continue; }
    const group = groups.get(workspace.id) ?? { id: workspace.id, name: workspace.name, workspace, rows: [] };
    group.rows.push({ session, view });
    groups.set(workspace.id, group);
  }
  return [...groups.values(), ...(orphans.rows.length ? [orphans] : [])];
}

const usageOf = (rows: SessionRow[]): ResourceUsage => rows.reduce((total, { session }) =>
  ({ cpu: total.cpu + session.cpu, memoryBytes: total.memoryBytes + session.memoryBytes }), { cpu: 0, memoryBytes: 0 });

/** Histories summed sample by sample, aligned at the newest. */
function sumHistories(histories: number[][]): number[] {
  const length = Math.max(0, ...histories.map((history) => history.length));
  return Array.from({ length }, (_, index) => histories.reduce((total, history) => total + (history[history.length - length + index] ?? 0), 0));
}

function Sparkline({ samples }: { samples: number[] }) {
  if (samples.length < 2) return <svg className="resource-sparkline" width={48} height={14} aria-hidden="true" />;
  const min = Math.min(...samples);
  const range = Math.max(...samples) - min || 1;
  const points = samples.map((value, index) => `${(index / (samples.length - 1)) * 48},${13 - ((value - min) / range) * 12}`).join(" ");
  return <svg className="resource-sparkline" width={48} height={14} viewBox="0 0 48 14" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" /></svg>;
}

function sessionName(row: SessionRow): string {
  return row.view?.title ?? row.session.label;
}

function SessionIcon({ session }: { session: SessionResource }) {
  return session.kind === "agent" ? <AgentIcon size={12} /> : <TerminalIcon size={12} />;
}

/** Ends a session, asking first. A session with a view closes through its view, so both go together. */
async function endSession(row: SessionRow, workspace?: Workspace): Promise<void> {
  const confirmed = await confirmDestructive({
    title: "End session",
    message: "End this session and every process it started?",
    warning: <><strong>Warning:</strong> Anything running in it is <strong>stopped</strong>{row.view ? <>, and its tab closes</> : null}.</>,
    subject: { icon: <SessionIcon session={row.session} />, name: sessionName(row), detail: row.session.label, meta: row.session.cwd },
    confirmLabel: "End Session",
  });
  if (!confirmed) return;
  if (row.view && workspace) await services.commands.execute("view.close", { workspaceId: workspace.id, viewId: row.view.id, confirmed: true });
  else await window.workbench.resources.end(row.session.sessionId);
  await refreshResources();
}

async function endOrphans(rows: SessionRow[]): Promise<void> {
  const confirmed = await confirmDestructive({
    title: "End sessions",
    message: `End ${rows.length === 1 ? "the session" : `all ${rows.length} sessions`} no open view shows?`,
    warning: <><strong>Warning:</strong> Anything running in {rows.length === 1 ? "it" : "them"} is <strong>stopped</strong>.</>,
    subject: { icon: <TerminalIcon size={20} />, name: rows.length === 1 ? sessionName(rows[0]) : `${rows.length} sessions`, detail: "No open view" },
    confirmLabel: rows.length === 1 ? "End Session" : "End Sessions",
  });
  if (!confirmed) return;
  await Promise.allSettled(rows.map((row) => window.workbench.resources.end(row.session.sessionId)));
  await refreshResources();
}

function UsageCells({ usage }: { usage: ResourceUsage }) {
  return <><span className="resource-cpu">{formatCpu(usage.cpu)}</span><span className="resource-mem">{formatBytes(usage.memoryBytes)}</span></>;
}

function ResourcesTab({ groups }: { groups: Group[] }) {
  const app = useResources((state) => state.snapshot?.app);
  const [sort, setSort] = useState<SortKey>("memoryBytes");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const sorted = [...groups].map((group) => ({ ...group, usage: usageOf(group.rows), rows: [...group.rows].sort((a, b) => b.session[sort] - a.session[sort]) }))
    .sort((a, b) => b.usage[sort] - a.usage[sort]);
  const header = (key: SortKey, label: string) => <AriaButton className={`resource-sort ${sort === key ? "is-active" : ""}`} onPress={() => setSort(key)}
    aria-label={`Sort by ${label}`}>{label}</AriaButton>;
  return <div className="resource-table" role="table" aria-label="Resource usage">
    <div className="resource-row resource-head" role="row"><span role="columnheader">Name</span><span />{header("cpu", "CPU")}{header("memoryBytes", "Mem")}</div>
    {sorted.map((group) => {
      const open = !collapsed.has(group.id);
      return <div key={group.id} role="rowgroup">
        <div className="resource-row resource-group" role="row">
          <AriaButton className="resource-name" onPress={() => toggle(group.id)} aria-expanded={open}>
            {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}<span>{group.name}</span>
          </AriaButton>
          <Sparkline samples={sumHistories(group.rows.map((row) => row.session.history))} />
          <UsageCells usage={group.usage} />
        </div>
        {open && group.rows.map((row) => <div key={row.session.sessionId} className="resource-row resource-child" role="row">
          <span className="resource-name"><span className={`status-dot ${row.session.exited ? "tone-idle" : "tone-ready"}`} />
            <span title={`${row.session.label} · pid ${row.session.pid}`}>{sessionName(row)}</span></span>
          <Sparkline samples={row.session.history} />
          <UsageCells usage={row.session} />
        </div>)}
      </div>;
    })}
    {app && <div role="rowgroup">
      <div className="resource-row resource-group" role="row">
        <AriaButton className="resource-name" onPress={() => toggle("app")} aria-expanded={!collapsed.has("app")}>
          {collapsed.has("app") ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}<span>Agent Workbench</span>
        </AriaButton>
        <Sparkline samples={app.history} />
        <UsageCells usage={app} />
      </div>
      {!collapsed.has("app") && ([["Main", app.main], ["Renderer", app.renderer], ["Other", app.other]] as const).map(([label, usage]) =>
        <div key={label} className="resource-row resource-child" role="row"><span className="resource-name">{label}</span><span /><UsageCells usage={usage} /></div>)}
    </div>}
  </div>;
}

function SessionsTab({ groups }: { groups: Group[] }) {
  if (!groups.length) return <p className="resource-empty">No sessions are running.</p>;
  return <div className="resource-sessions">
    {groups.map((group) => <section key={group.id} aria-label={group.name}>
      <div className="resource-sessions-head"><span>{group.name}</span>
        {group.id === "orphans" && <Button className="resource-end-all" onPress={() => void endOrphans(group.rows)}>End all</Button>}</div>
      {group.rows.map((row) => <div key={row.session.sessionId} className="resource-session">
        <SessionIcon session={row.session} />
        <div className="resource-session-text">
          <span>{sessionName(row)}</span>
          <small>{row.session.label} · pid {row.session.pid}{row.session.exited ? " · exited" : ""} · {row.session.cwd}</small>
        </div>
        <IconButton label={`End ${sessionName(row)}`} className="resource-end" onPress={() => void endSession(row, group.workspace)}><TrashIcon size={13} /></IconButton>
      </div>)}
    </section>)}
  </div>;
}

/** The status bar's memory figure; pressed, it opens what each workspace's sessions and the app itself are using. */
export function ResourceManager() {
  const [open, setOpen] = useState(false);
  useResourcePolling(open);
  const summary = useResources((state) => state.summary);
  const snapshot = useResources((state) => state.snapshot);
  const error = useResources((state) => state.error);
  const workspaces = useWorkbenchStore((state) => state.workspaces);
  const groups = snapshot ? groupSessions(snapshot.sessions, workspaces) : [];
  return <DialogTrigger isOpen={open} onOpenChange={setOpen}>
    <AriaButton className="status-item status-button" aria-label="Resource manager">
      <MemoryIcon size={12} />{summary ? formatBytes(summary.memoryBytes) : "—"}
      <span className="status-muted">·</span><TerminalIcon size={12} />{summary?.sessions ?? 0}
    </AriaButton>
    <Popover className="wb-popover resource-popover" placement="top end">
      <Dialog aria-label="Resource manager" className="resource-dialog">
        <div className="resource-header">
          <span className="resource-title"><MemoryIcon size={14} />Resource Manager</span>
          <IconButton label="Refresh" onPress={() => void refreshResources()}><RefreshIcon size={13} /></IconButton>
        </div>
        <Tabs className="resource-tabs-root">
          <TabList aria-label="Resource manager sections" className="segmented resource-tabs">
            <Tab id="resources" className="segment">Resources</Tab>
            <Tab id="sessions" className="segment">Sessions</Tab>
          </TabList>
          {snapshot && <div className="resource-totals">{formatCpu(snapshot.total.cpu)} <span className="status-muted">·</span> {formatBytes(snapshot.total.memoryBytes)} <span className="status-muted">memory</span></div>}
          {error && <p className="resource-error">{error}</p>}
          <TabPanel id="resources" className="resource-panel">{snapshot ? <ResourcesTab groups={groups} /> : <p className="resource-empty">Measuring…</p>}</TabPanel>
          <TabPanel id="sessions" className="resource-panel">{snapshot ? <SessionsTab groups={groups} /> : <p className="resource-empty">Measuring…</p>}</TabPanel>
        </Tabs>
      </Dialog>
    </Popover>
  </DialogTrigger>;
}
