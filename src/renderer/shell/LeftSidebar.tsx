import { useContextMenu } from "../ui/ContextMenu";
import { viewActions, workspaceActions } from "../features/views/view-actions";
import { useState } from "react";
import { Button as AriaButton, Tree, TreeItem, TreeItemContent, type Key } from "react-aria-components";
import type { Workspace } from "../../shared/models";
import { services } from "../core/services";
import { useContributions } from "../core/registry";
import { useViewStatuses, viewStatus } from "../core/view-status";
import { useWorkbenchStore } from "../state/workbench-store";
import { IconButton } from "../ui/controls";
import { ChevronRightIcon, FileIcon, FolderIcon, PlusIcon, SidebarLeftIcon } from "../ui/icons";
import { isFilesWorkspace } from "../../shared/files-workspace";

function sidebarViews(workspace: Workspace) {
  return workspace.views.filter((view) => services.views.of(view)?.listInSidebar);
}

export function LeftSidebar({ onCollapse }: { onCollapse: () => void }) {
  useContributions();
  const menu = useContextMenu("Workspace and view actions");
  const stored = useWorkbenchStore((state) => state.workspaces);
  // Files opened on their own sit below every folder workspace.
  const folderWorkspaces = stored.filter((item) => !isFilesWorkspace(item));
  const workspaces = [...folderWorkspaces, ...stored.filter(isFilesWorkspace)];
  const folders = folderWorkspaces.length;
  const activeWorkspaceId = useWorkbenchStore((state) => state.activeWorkspaceId ?? state.workspaces[0]?.id);
  const statuses = useViewStatuses();
  const [collapsed, setCollapsed] = useState<Set<Key>>(new Set());
  const expanded = new Set<Key>(workspaces.map((workspace) => workspace.id).filter((id) => !collapsed.has(id)));
  const select = (key: Key) => {
    const workspace = workspaces.find((item) => item.id === key);
    if (workspace) { void services.commands.execute("workspace.select", workspace.id); return; }
    const owner = workspaces.find((item) => item.views.some((view) => view.id === key));
    if (owner) void services.commands.execute("view.activate", { workspaceId: owner.id, viewId: String(key) });
  };

  return <aside className="sidebar-card left-sidebar" aria-label="Workspaces sidebar" onKeyDown={menu.bind((target) => {
    const key = target.closest("[role=row]")?.getAttribute("data-key");
    const workspace = workspaces.find((w) => w.id === key);
    if (workspace) return workspaceActions(workspace);
    const owner = workspaces.find((w) => w.views.some((v) => v.id === key));
    const view = owner?.views.find((v) => v.id === key);
    return owner && view ? viewActions(owner, view) : [];
  }).onKeyDown}>
    {menu.overlay}
    <div className="sidebar-titlebar">
      <IconButton label="Hide sidebar" onPress={onCollapse}><SidebarLeftIcon size={16} /></IconButton>
    </div>
    <div className="sidebar-section-header">
      <span>Workspaces <span className="count-muted">{folders}</span></span>
      <IconButton label="Add workspace" onPress={() => void services.commands.execute("workspace.add")}><PlusIcon size={15} /></IconButton>
    </div>
    <Tree aria-label="Workspaces" className="workspace-tree" expandedKeys={expanded}
      onExpandedChange={(keys) => setCollapsed(new Set(workspaces.map((workspace) => workspace.id).filter((id) => !keys.has(id))))}
      onAction={select}>
      {workspaces.map((workspace) => {
        const sessions = sidebarViews(workspace);
        const isActive = workspace.id === activeWorkspaceId;
        return <TreeItem key={workspace.id} id={workspace.id} textValue={workspace.name} hasChildItems={sessions.length > 0}
          className={`workspace-row ${isActive ? "is-active" : ""}`} {...menu.bind(() => workspaceActions(workspace))}>
          <TreeItemContent>
            {({ isExpanded, hasChildItems }) => <div className="workspace-row-content">
              {hasChildItems
                ? <AriaButton slot="chevron" className={`tree-chevron ${isExpanded ? "is-expanded" : ""}`} aria-label={isExpanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}><ChevronRightIcon size={11} /></AriaButton>
                : <span className="tree-chevron-spacer" />}
              <span className="workspace-icon">{workspace.icon ? <img src={workspace.icon} alt="" draggable={false} /> : isFilesWorkspace(workspace) ? <FileIcon size={15} /> : <FolderIcon size={15} />}</span>
              <span className="workspace-copy">
                <strong>{workspace.name}</strong>
                {isFilesWorkspace(workspace)
                  ? <small>Opened on their own</small>
                  : <small>{sessions.length} {sessions.length === 1 ? "session" : "sessions"}{services.widgets.forSlot("sidebar.workspace.meta", workspace.id).map((widget) => {
                    const Widget = widget.component;
                    return <Widget key={widget.id} workspaceId={workspace.id} />;
                  })}</small>}
              </span>
              <span className="count-badge">{workspace.views.length}</span>
              {menu.overflow(workspaceActions(workspace), workspace.name)}
            </div>}
          </TreeItemContent>
          {sessions.map((view) => {
            const status = viewStatus(view, statuses);
            const isCurrent = isActive && workspace.activeViewId === view.id;
            return <TreeItem key={view.id} id={view.id} textValue={view.title} className={`session-row ${isCurrent ? "is-current" : ""}`} {...menu.bind(() => viewActions(workspace, view))}>
              <TreeItemContent>
                <div className="session-row-content">
                  <span className={`status-dot tone-${status?.tone ?? "idle"} ${status?.unseen ? "is-unseen" : ""}`} aria-hidden="true" />
                  <span className="session-copy">
                    <span className="session-title">{view.title}</span>
                    <small>{[status?.label, status?.detail].filter(Boolean).join(" · ")}</small>
                  </span>
                  {menu.overflow(viewActions(workspace, view), view.title)}
                </div>
              </TreeItemContent>
            </TreeItem>;
          })}
        </TreeItem>;
      })}
    </Tree>
    {folders === 0 && <p className="sidebar-empty">Local folders you add will appear here.</p>}
    <nav className="sidebar-footer" aria-label="App">
      {services.widgets.forSlot("sidebar.footer", activeWorkspaceId).map((widget) => {
        const Widget = widget.component;
        return <Widget key={widget.id} workspaceId={activeWorkspaceId} />;
      })}
    </nav>
  </aside>;
}
