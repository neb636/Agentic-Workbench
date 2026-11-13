import { useContextMenu } from "../../ui/ContextMenu";
import { viewActions } from "./view-actions";
import { Button as AriaButton, GridList, GridListItem } from "react-aria-components";
import type { WorkbenchView } from "../../../shared/models";
import type { PanelProps } from "../../core/panel-registry";
import { services } from "../../core/services";
import { useViewStatuses, viewStatus } from "../../core/view-status";
import { CloseIcon } from "../../ui/icons";

/** Groups views by type, in registration order: sessions, terminals, then files. */
export function ActiveViewsPanel({ workspace }: PanelProps) {
  const menu = useContextMenu("View actions");
  const statuses = useViewStatuses();
  const groups = services.views.list(workspace.id)
    .map((definition) => ({ definition, views: workspace.views.filter((view) => view.type === definition.id) }))
    .filter((group) => group.views.length);

  return <div className="side-panel views-panel" onKeyDown={menu.bind((target) => {
    const view = workspace.views.find((v) => v.id === target.closest("[role=row]")?.getAttribute("data-key"));
    return view ? viewActions(workspace, view) : [];
  }).onKeyDown}>
    {menu.overlay}
    <div className="side-panel-header"><h2>Active views</h2><span className="count-badge">{workspace.views.length}</span></div>
    {groups.length === 0 && <p className="panel-empty">Nothing is open in this workspace.</p>}
    {groups.map(({ definition, views }) => {
      const Icon = definition.icon;
      return <section key={definition.id} className="panel-section">
        <div className="panel-section-header"><span>{definition.label}</span><span className="count-badge">{views.length}</span></div>
        <GridList<WorkbenchView> aria-label={definition.label} className="panel-list" items={views}
          dependencies={[statuses, workspace.activeViewId]} onAction={(key) => void services.commands.execute("view.activate", { workspaceId: workspace.id, viewId: String(key) })}>
          {(view) => {
            const status = viewStatus(view, statuses);
            return <GridListItem id={view.id} textValue={view.title} className={`panel-list-item ${view.id === workspace.activeViewId ? "is-current" : ""}`} {...menu.bind(() => viewActions(workspace, view))}>
              <Icon size={14} view={view} />
              <span className="file-tree-name">{view.title}</span>
              {status && <small className={`tone-${status.tone}`}><span className="status-dot" />{status.label}</small>}
              {menu.overflow(viewActions(workspace, view), view.title)}
              <AriaButton className="row-action" aria-label={`Close ${view.title}`}
                onPress={() => void services.commands.execute("view.close", { workspaceId: workspace.id, viewId: view.id })}><CloseIcon size={11} /></AriaButton>
            </GridListItem>;
          }}
        </GridList>
      </section>;
    })}
  </div>;
}
