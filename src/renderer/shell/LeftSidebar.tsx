import { useState } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Tree, TreeItem, TreeItemContent, type Key } from "react-aria-components";
import type { Workspace } from "../../shared/models";
import { services } from "../core/services";
import { useViewStatuses, viewStatus } from "../core/view-status";
import { useWorkbenchStore } from "../state/workbench-store";
import { IconButton } from "../ui/controls";
import { ChevronRightIcon, FolderIcon, MoreIcon, PlusIcon, SidebarLeftIcon } from "../ui/icons";

function sidebarViews(workspace: Workspace) {
  return workspace.views.filter((view) => services.views.get(view.type)?.listInSidebar);
}

function WorkspaceMenu({ workspace }: { workspace: Workspace }) {
  return <MenuTrigger>
    <AriaButton className="row-action" aria-label={`${workspace.name} actions`}><MoreIcon size={14} /></AriaButton>
    <Popover className="wb-popover" placement="bottom end">
      <Menu aria-label={`${workspace.name} actions`} onAction={(key) => {
        if (key === "remove") void services.commands.execute("workspace.remove", workspace.id);
        else void services.commands.execute("view.create", { workspaceId: workspace.id, viewType: String(key) });
      }}>
        {services.views.list().filter((definition) => definition.creatable !== false).map((definition) => <MenuItem key={definition.id} id={definition.id}>New {definition.label.toLowerCase()}</MenuItem>)}
        <MenuItem id="remove" className="is-destructive">Remove workspace</MenuItem>
      </Menu>
    </Popover>
  </MenuTrigger>;
}

export function LeftSidebar({ onCollapse }: { onCollapse: () => void }) {
  const workspaces = useWorkbenchStore((state) => state.workspaces);
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

  return <aside className="sidebar-card left-sidebar" aria-label="Workspaces sidebar">
    <div className="sidebar-titlebar">
      <IconButton label="Hide sidebar" onPress={onCollapse}><SidebarLeftIcon size={16} /></IconButton>
    </div>
    <div className="sidebar-section-header">
      <span>Workspaces <span className="count-muted">{workspaces.length}</span></span>
      <IconButton label="Add workspace" onPress={() => void services.commands.execute("workspace.add")}><PlusIcon size={15} /></IconButton>
    </div>
    <Tree aria-label="Workspaces" className="workspace-tree" expandedKeys={expanded}
      onExpandedChange={(keys) => setCollapsed(new Set(workspaces.map((workspace) => workspace.id).filter((id) => !keys.has(id))))}
      onAction={select}>
      {workspaces.map((workspace) => {
        const sessions = sidebarViews(workspace);
        const isActive = workspace.id === activeWorkspaceId;
        return <TreeItem key={workspace.id} id={workspace.id} textValue={workspace.name} hasChildItems={sessions.length > 0}
          className={`workspace-row ${isActive ? "is-active" : ""}`}>
          <TreeItemContent>
            {({ isExpanded, hasChildItems }) => <div className="workspace-row-content">
              {hasChildItems
                ? <AriaButton slot="chevron" className={`tree-chevron ${isExpanded ? "is-expanded" : ""}`} aria-label={isExpanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}><ChevronRightIcon size={11} /></AriaButton>
                : <span className="tree-chevron-spacer" />}
              <span className="workspace-icon"><FolderIcon size={15} /></span>
              <span className="workspace-copy">
                <strong>{workspace.name}</strong>
                <small>{sessions.length} {sessions.length === 1 ? "session" : "sessions"}{services.widgets.forSlot("sidebar.workspace.meta").map((widget) => {
                  const Widget = widget.component;
                  return <Widget key={widget.id} workspaceId={workspace.id} />;
                })}</small>
              </span>
              <span className="count-badge">{workspace.views.length}</span>
              <WorkspaceMenu workspace={workspace} />
            </div>}
          </TreeItemContent>
          {sessions.map((view) => {
            const status = viewStatus(view, statuses);
            const isCurrent = isActive && workspace.activeViewId === view.id;
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
    </Tree>
    {workspaces.length === 0 && <p className="sidebar-empty">Local folders you add will appear here.</p>}
    <nav className="sidebar-footer" aria-label="App">
      {services.widgets.forSlot("sidebar.footer").map((widget) => {
        const Widget = widget.component;
        return <Widget key={widget.id} />;
      })}
    </nav>
  </aside>;
}
