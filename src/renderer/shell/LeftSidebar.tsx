import { useEffect, useMemo, useState } from "react";
import { Button as AriaButton, Input, Menu, MenuItem, MenuTrigger, Popover, Tree, TreeItem, TreeItemContent, type Key } from "react-aria-components";
import type { WorkItemInfo, Workspace } from "../../shared/models";
import { services } from "../core/services";
import { useViewStatuses, viewStatus } from "../core/view-status";
import { useWorkbenchStore } from "../state/workbench-store";
import { Button, IconButton } from "../ui/controls";
import { BranchIcon, ChevronRightIcon, FolderIcon, MoreIcon, PlusIcon, RefreshIcon, SidebarLeftIcon } from "../ui/icons";
import { shortBranch, useWorkList, workGroup } from "../features/work/work-store";
import { workAttention } from "../features/agent/attention";
import { newAgent } from "../features/agent/new-agent";
import { useAgentRuntimes } from "../core/agent-runtimes";

const POLL_MS = 45_000;
const FOCUS_REFRESH_MS = 60_000;

function sidebarViews(workspace?: Workspace) {
  return workspace?.views.filter((view) => services.views.get(view.type)?.listInSidebar) ?? [];
}

function samePath(a: string, b: string) {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/** PR number and state, CI, changed files, install progress: the one line under each piece of work. */
function WorkMeta({ item }: { item: WorkItemInfo }) {
  const parts: React.ReactNode[] = [];
  if (item.main && item.branch && item.branch !== "main") parts.push(<span key="branch">on {item.branch}</span>);
  if (item.missing) parts.push(<span key="gone">folder gone</span>);
  if (item.install === "installing") parts.push(<span key="install">installing…</span>);
  if (item.install === "failed") parts.push(<span key="install" className="work-bad" title={item.installMessage}>npm ci failed</span>);
  if (item.dependencies === "missing" || item.install === "failed") parts.push(<NpmCi key="npm-ci" item={item} />);
  if (item.pr) {
    const state = item.pr.state === "OPEN" ? (item.pr.isDraft ? "draft" : "open") : item.pr.state.toLowerCase();
    parts.push(<span key="pr" className={`work-pr is-${state}`} title={item.pr.title}>#{item.pr.number} {state}</span>);
    if (item.pr.checks) parts.push(<span key="ci" className={`work-ci is-${item.pr.checks}`} title={`CI ${item.pr.checks}`}>CI {item.pr.checks === "passing" ? "✓" : item.pr.checks === "failing" ? "✗" : "…"}</span>);
  } else if (!item.main && !item.missing) parts.push(<span key="pr">no PR</span>);
  if (item.changes) parts.push(<span key="changes">{item.changes} changed</span>);
  if (!parts.length) parts.push(<span key="branch">{shortBranch(item.branch) ?? "detached"}</span>);
  return <small className="work-meta">{parts}</small>;
}

/** The game can't start in a worktree without node_modules: one button installs them (a clone of main's when it can). */
function NpmCi({ item }: { item: WorkItemInfo }) {
  const repoRoot = useWorkbenchStore((state) => state.repoRoot);
  const [busy, setBusy] = useState(false);
  return <>
    <button className="work-inline-button work-bad" disabled={busy || !repoRoot} title={`${item.dependencies === "missing" ? "Dependencies are missing: the game can't start. " : ""}Install them here (npm ci, or a copy of main's when the lockfile matches)`}
      onClick={(event) => {
        event.stopPropagation();
        if (!repoRoot) return;
        setBusy(true);
        void window.workbench.work.install(repoRoot, item.path).then(() => useWorkList.getState().refresh()).finally(() => setBusy(false));
      }}>{busy ? "installing…" : "npm ci ▸"}</button>
  </>;
}

/** + Claude / + Codex on a row's hover: a new agent there, ready to type. */
function QuickAgents({ item }: { item: WorkItemInfo }) {
  if (item.missing) return null;
  const start = (providerId: string) => {
    const workspaceId = useWorkbenchStore.getState().addWorkspace(item.path, { name: item.name, views: item.main ? "all" : "agent" });
    const workspace = useWorkbenchStore.getState().workspaces.find((candidate) => candidate.id === workspaceId);
    // A piece of work opened just now already has a new agent that hasn't started: use it rather than make a second.
    const fresh = workspace?.views.find((view) => view.type === "agent" && (view.state as { autoStart?: boolean } | undefined)?.autoStart && !useAgentRuntimes.getState().sessions[view.id]);
    if (fresh) {
      useWorkbenchStore.getState().updateViewState(workspaceId, fresh.id, { providerId });
      useWorkbenchStore.getState().selectView(workspaceId, fresh.id);
    } else newAgent(workspaceId, providerId);
    void services.commands.execute("workspace.select", workspaceId);
  };
  return <span className="work-quick">
    <AriaButton className="work-quick-button" aria-label={`New Claude Code agent in ${item.name}`} onPress={() => start("claude.cli")}>+ Claude</AriaButton>
    <AriaButton className="work-quick-button" aria-label={`New Codex agent in ${item.name}`} onPress={() => start("codex.cli")}>+ Codex</AriaButton>
  </span>;
}

function WorkMenu({ item, workspace, onCleanUp }: { item: WorkItemInfo; workspace?: Workspace; onCleanUp: () => void }) {
  const open = () => useWorkbenchStore.getState().addWorkspace(item.path, { name: item.name, views: item.main ? "all" : "agent" });
  return <MenuTrigger>
    <AriaButton className="row-action" aria-label={`${item.name} actions`}><MoreIcon size={14} /></AriaButton>
    <Popover className="wb-popover" placement="bottom end">
      <Menu aria-label={`${item.name} actions`} onAction={(key) => {
        if (key === "cleanup") onCleanUp();
        else if (key === "repo") void services.commands.execute("repo.open");
        else if (key === "pr" && item.pr) window.open(item.pr.url);
        else void services.commands.execute("view.create", { workspaceId: workspace?.id ?? open(), viewType: String(key) });
      }}>
        {!item.missing && services.views.list().filter((definition) => definition.creatable !== false).map((definition) =>
          <MenuItem key={definition.id} id={definition.id}>New {definition.label.toLowerCase()}</MenuItem>)}
        {item.pr && <MenuItem id="pr">Open PR #{item.pr.number} on GitHub</MenuItem>}
        {!item.main && <MenuItem id="cleanup" className="is-destructive">Clean up…</MenuItem>}
        {item.main && <MenuItem id="repo">Open a different checkout…</MenuItem>}
      </Menu>
    </Popover>
  </MenuTrigger>;
}

function NewWork({ onDone }: { onDone: () => void }) {
  const repoRoot = useWorkbenchStore((state) => state.repoRoot);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return <form className="new-work" onSubmit={async (event) => {
    event.preventDefault();
    if (!repoRoot || !name.trim()) return;
    setBusy(true); setError(undefined);
    try {
      const created = await window.workbench.work.create(repoRoot, name);
      await useWorkList.getState().refresh();
      const workspaceId = useWorkbenchStore.getState().addWorkspace(created.path, { name: created.path.split("/").at(-1), views: "agent" });
      useWorkbenchStore.getState().selectWorkspace(workspaceId);
      onDone();
    } catch (caught) {
      setError(String(caught).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ""));
    } finally { setBusy(false); }
  }}>
    <label htmlFor="new-work-name">New piece of work</label>
    <Input id="new-work-name" autoFocus value={name} placeholder="canada-whales" disabled={busy}
      onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onDone(); }} />
    <small>Branches from the latest main into <code>Kaylee-Gamepack-worktrees/</code>, then runs npm ci.</small>
    {error && <small className="work-bad" role="alert">{error}</small>}
    <div className="new-work-actions">
      <Button onPress={onDone} isDisabled={busy}>Cancel</Button>
      <Button type="submit" className="primary-button" isDisabled={busy || !name.trim()}>{busy ? "Creating…" : "Create"}</Button>
    </div>
  </form>;
}

function WorkTree({ label, items, workspaces, onCleanUp }: { label: string; items: WorkItemInfo[]; workspaces: Workspace[]; onCleanUp: (item: WorkItemInfo) => void }) {
  const activeWorkspaceId = useWorkbenchStore((state) => state.activeWorkspaceId);
  const statuses = useViewStatuses();
  const [collapsed, setCollapsed] = useState<Set<Key>>(new Set());
  const workspaceFor = (item: WorkItemInfo) => workspaces.find((workspace) => samePath(workspace.path, item.path));
  const expanded = new Set<Key>(items.map((item) => item.path).filter((id) => !collapsed.has(id)));
  const select = (key: Key) => {
    const item = items.find((candidate) => candidate.path === key);
    if (item) {
      if (item.missing) return;
      const id = useWorkbenchStore.getState().addWorkspace(item.path, { name: item.name, views: item.main ? "all" : "agent" });
      void services.commands.execute("workspace.select", id);
      return;
    }
    const owner = workspaces.find((workspace) => workspace.views.some((view) => view.id === key));
    if (owner) void services.commands.execute("view.select", { workspaceId: owner.id, viewId: String(key) });
  };
  return <Tree aria-label={label} className="workspace-tree" expandedKeys={expanded}
    onExpandedChange={(keys) => setCollapsed(new Set(items.map((item) => item.path).filter((id) => !keys.has(id))))}
    onAction={select}>
    {items.map((item) => {
      const workspace = workspaceFor(item);
      const sessions = sidebarViews(workspace);
      const isActive = Boolean(workspace && workspace.id === activeWorkspaceId);
      return <TreeItem key={item.path} id={item.path} textValue={item.name} hasChildItems={sessions.length > 0}
        className={`workspace-row work-row ${isActive ? "is-active" : ""} ${item.missing ? "is-missing" : ""}`}>
        <TreeItemContent>
          {({ isExpanded, hasChildItems }) => <div className="workspace-row-content" title={item.path}>
            {hasChildItems
              ? <AriaButton slot="chevron" className={`tree-chevron ${isExpanded ? "is-expanded" : ""}`} aria-label={isExpanded ? `Collapse ${item.name}` : `Expand ${item.name}`}><ChevronRightIcon size={11} /></AriaButton>
              : <span className="tree-chevron-spacer" />}
            <span className="workspace-icon">{item.main ? <FolderIcon size={15} /> : <BranchIcon size={15} />}</span>
            <span className="workspace-copy">
              <strong>{item.name}{(() => {
                const attention = workAttention(workspace, statuses);
                return attention === "needs-answer" ? <span className="work-badge is-ask" title="An agent here is asking something">needs answer</span>
                  : attention === "done" ? <span className="work-badge is-done" title="An agent here finished">done</span>
                  : attention === "working" ? <span className="work-badge is-working" title="An agent here is working">working…</span> : null;
              })()}</strong>
              <WorkMeta item={item} />
            </span>
            <QuickAgents item={item} />
            <WorkMenu item={item} workspace={workspace} onCleanUp={() => onCleanUp(item)} />
          </div>}
        </TreeItemContent>
        {sessions.map((view) => {
          const status = viewStatus(view, statuses);
          const isCurrent = isActive && workspace?.activeViewId === view.id;
          return <TreeItem key={view.id} id={view.id} textValue={view.title} className={`session-row ${isCurrent ? "is-current" : ""}`}>
            <TreeItemContent>
              <div className="session-row-content">
                <span className={`status-dot tone-${status?.tone ?? "idle"} ${status?.unseen ? "is-unseen" : ""}`} aria-hidden="true" />
                <span className="session-copy">
                  <span className="session-title">{view.title}</span>
                  <small>{[status?.label, status?.detail].filter(Boolean).join(" · ")}</small>
                </span>
              </div>
            </TreeItemContent>
          </TreeItem>;
        })}
      </TreeItem>;
    })}
  </Tree>;
}

/**
 * The left column: the one Gamepack repo and every piece of work on it (main + each worktree, wherever it lives),
 * with its PR, CI and agents. Selecting one switches every view to that checkout.
 */
export function LeftSidebar({ onCollapse }: { onCollapse: () => void }) {
  const repoRoot = useWorkbenchStore((state) => state.repoRoot);
  const workspaces = useWorkbenchStore((state) => state.workspaces);
  const { list, error, loading, refresh } = useWorkList();
  const [creating, setCreating] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!repoRoot) return;
    void refresh(true);
    // Each refresh runs git in every worktree: only while Studio is in front, and coming back refreshes at most once a minute.
    let last = Date.now();
    const tick = () => { last = Date.now(); void refresh(); };
    const timer = setInterval(() => { if (document.visibilityState === "visible" && document.hasFocus()) tick(); }, POLL_MS);
    const back = () => { if (Date.now() - last > FOCUS_REFRESH_MS) tick(); };
    addEventListener("focus", back);
    return () => { clearInterval(timer); removeEventListener("focus", back); };
  }, [repoRoot, refresh]);

  const groups = useMemo(() => {
    const items = list?.items ?? [];
    const hasViews = (item: WorkItemInfo) => workspaces.some((workspace) => samePath(workspace.path, item.path) && workspace.views.length);
    const rank = (item: WorkItemInfo) => (hasViews(item) ? 0 : item.pr ? 1 : 2);
    const active = items.filter((item) => workGroup(item) === "active").sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const finished = items.filter((item) => workGroup(item) === "finished").sort((a, b) => a.name.localeCompare(b.name));
    const others = list ? workspaces.filter((workspace) => !items.some((item) => samePath(item.path, workspace.path))) : [];
    return { main: items.filter((item) => item.main), active, finished, others };
  }, [list, workspaces]);

  async function cleanUp(targets: WorkItemInfo[]) {
    if (!repoRoot || !targets.length) return;
    const one = targets.length === 1 ? targets[0] : undefined;
    const question = one
      ? `Clean up “${one.name}”?\n\nThis removes the folder ${one.path} and closes its views. The branch${one.branch ? ` ${one.branch}` : ""} stays. Studio refuses if it has changes or commits that aren't pushed.`
      : `Clean up ${targets.length} finished pieces of work?\n\nThis removes their folders and closes their views. Branches stay. Any with changes or unpushed commits are skipped.`;
    if (!window.confirm(question)) return;
    const skipped: string[] = [];
    for (const item of targets) {
      try {
        await window.workbench.work.remove(repoRoot, item.path);
        const workspace = useWorkbenchStore.getState().workspaces.find((candidate) => samePath(candidate.path, item.path));
        if (workspace) await services.commands.execute("workspace.remove", workspace.id);
      } catch (caught) {
        skipped.push(`${item.name}: ${String(caught).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, "")}`);
      }
    }
    setNotice(skipped.length ? `Kept ${skipped.length}:\n${skipped.join("\n")}` : `Cleaned up ${targets.length === 1 ? targets[0].name : `${targets.length} pieces of work`}.`);
    await refresh();
  }

  if (!repoRoot) {
    return <aside className="sidebar-card left-sidebar" aria-label="Work sidebar">
      <div className="sidebar-titlebar"><IconButton label="Hide sidebar" onPress={onCollapse}><SidebarLeftIcon size={16} /></IconButton></div>
      <p className="sidebar-empty">Open your Kaylee-Gamepack checkout. Studio finds its worktrees by itself.</p>
      <div className="new-work-actions"><Button className="primary-button" onPress={() => void services.commands.execute("repo.open")}><FolderIcon size={15} /> Open the Gamepack repo</Button></div>
    </aside>;
  }

  return <aside className="sidebar-card left-sidebar" aria-label="Work sidebar">
    <div className="sidebar-titlebar">
      <IconButton label="Hide sidebar" onPress={onCollapse}><SidebarLeftIcon size={16} /></IconButton>
    </div>
    <div className="sidebar-section-header">
      <span>Work <span className="count-muted">{groups.active.length}</span></span>
      <span className="header-actions">
        <IconButton label="Refresh worktrees and PRs" isDisabled={loading} onPress={() => void refresh(true)}><RefreshIcon size={14} /></IconButton>
        <IconButton label="New piece of work" onPress={() => setCreating(true)}><PlusIcon size={15} /></IconButton>
      </span>
    </div>
    <div className="work-scroll">
      {creating && <NewWork onDone={() => setCreating(false)} />}
      {error && <>
        <p className="sidebar-empty work-bad" role="alert">{error}</p>
        <div className="new-work-actions"><Button className="small-button" onPress={() => void services.commands.execute("repo.open")}>Open a different checkout…</Button></div>
      </>}
      {list?.github === "unavailable" && <p className="sidebar-empty">PRs unavailable: sign in with <code>gh auth login</code>.</p>}
      {notice && <p className="sidebar-empty work-notice" role="status" onClick={() => setNotice(undefined)}>{notice}</p>}
      <WorkTree label="Main checkout" items={groups.main} workspaces={workspaces} onCleanUp={(item) => void cleanUp([item])} />
      <WorkTree label="Work in progress" items={groups.active} workspaces={workspaces} onCleanUp={(item) => void cleanUp([item])} />
      {groups.finished.length > 0 && <>
        <div className="sidebar-section-header work-subheader">
          <AriaButton className="work-toggle" aria-expanded={showFinished} onPress={() => setShowFinished(!showFinished)}>
            <span className={`tree-chevron ${showFinished ? "is-expanded" : ""}`}><ChevronRightIcon size={11} /></span>
            Finished <span className="count-muted">{groups.finished.length}</span>
          </AriaButton>
          <Button className="small-button" onPress={() => void cleanUp(groups.finished)}>Clean up all</Button>
        </div>
        {showFinished && <WorkTree label="Finished work" items={groups.finished} workspaces={workspaces} onCleanUp={(item) => void cleanUp([item])} />}
      </>}
      {groups.others.length > 0 && <>
        <div className="sidebar-section-header work-subheader"><span>Other folders <span className="count-muted">{groups.others.length}</span></span></div>
        {groups.others.map((workspace) => <div key={workspace.id} className="other-folder" title={workspace.path}>
          <span>{workspace.name}</span>
          <Button className="small-button" onPress={() => void services.commands.execute("workspace.remove", workspace.id)}>Remove</Button>
        </div>)}
      </>}
    </div>
    <nav className="sidebar-footer" aria-label="App">
      {services.widgets.forSlot("sidebar.footer").map((widget) => {
        const Widget = widget.component;
        return <Widget key={widget.id} />;
      })}
    </nav>
  </aside>;
}
