import { useContextMenu } from "../ui/ContextMenu";
import { viewActions } from "../features/views/view-actions";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Tab, TabList, Tabs } from "react-aria-components";
import type { WorkbenchView, Workspace } from "../../shared/models";
import { useDirtyViews } from "../core/dirty-views";
import { services } from "../core/services";
import { useViewStatuses, viewStatus } from "../core/view-status";
import { useWorkbenchStore } from "../state/workbench-store";
import { IconButton } from "../ui/controls";
import { ChevronDownIcon, CloseIcon, PlusIcon, SidebarLeftIcon, SidebarRightIcon } from "../ui/icons";

const TAB_WIDTH = 176;
const DRAG_TYPE = "application/x-workbench-tab";

/** Tabs that fit are shown; the rest move into a "+N more" menu, keeping the active tab visible. */
function splitTabs(views: WorkbenchView[], activeId: string | undefined, capacity: number) {
  if (views.length <= capacity) return { visible: views, hidden: [] };
  let visible = views.slice(0, capacity);
  const active = views.find((view) => view.id === activeId);
  if (active && !visible.includes(active)) visible = [...views.slice(0, capacity - 1), active];
  return { visible, hidden: views.filter((view) => !visible.includes(view)) };
}

export function ViewTabs({ workspace, showLeftToggle, showRightToggle, onShowLeft, onShowRight }: {
  workspace?: Workspace;
  showLeftToggle: boolean;
  showRightToggle: boolean;
  onShowLeft: () => void;
  onShowRight: () => void;
}) {
  const statuses = useViewStatuses();
  const dirty = useDirtyViews();
  const selectView = useWorkbenchStore((state) => state.selectView);
  const stripRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(Infinity);
  const context = useContextMenu("View actions");
  const [dropBefore, setDropBefore] = useState<string>();

  useEffect(() => {
    const element = stripRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setCapacity(Math.max(1, Math.floor(element.clientWidth / TAB_WIDTH))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const views = workspace?.views ?? [];
  const { visible, hidden } = splitTabs(views, workspace?.activeViewId, capacity);
  // A click, unlike arrowing through the tabs, also wakes the view; it counts on the tab that is already selected too.
  const activate = (viewId: string) => { if (workspace) void services.commands.execute("view.activate", { workspaceId: workspace.id, viewId }); };
  const close = (view: WorkbenchView) => void services.commands.execute("view.close", { workspaceId: view.workspaceId, viewId: view.id });

  return <div className={`tab-strip ${showLeftToggle ? "has-traffic-lights" : ""}`} onKeyDown={context.bind((target) => {
    const view = workspace?.views.find((v) => v.id === target.closest("[role=tab]")?.getAttribute("data-key"));
    return workspace && view ? viewActions(workspace, view) : [];
  }).onKeyDown}>
    {showLeftToggle && <IconButton label="Show sidebar" onPress={onShowLeft}><SidebarLeftIcon size={16} /></IconButton>}
    <div className="tab-strip-tabs" ref={stripRef} onDragOver={(event) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      if (event.target === event.currentTarget) setDropBefore(undefined);
    }} onDrop={(event) => {
      const viewId = event.dataTransfer.getData(DRAG_TYPE);
      if (!viewId || !workspace) return;
      event.preventDefault();
      useWorkbenchStore.getState().moveView(workspace.id, viewId, dropBefore);
      setDropBefore(undefined);
    }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropBefore(undefined); }}>
      {workspace && <Tabs className="view-tabs" selectedKey={workspace.activeViewId}
        onSelectionChange={(key) => selectView(workspace.id, String(key))}>
        <TabList aria-label="Open views" className="view-tab-list" items={visible} dependencies={[statuses, dirty, dropBefore]}>
          {(view) => {
            const definition = services.views.get(view.type);
            const Icon = definition?.icon;
            const status = viewStatus(view, statuses);
            const unsaved = dirty[view.id];
            const preview = definition?.isPreview?.(view);
            return <Tab id={view.id} className={`view-tab ${preview ? "is-preview" : ""} ${dropBefore === view.id ? "is-drop-before" : ""}`} aria-label={view.title} {...context.bind(() => viewActions(workspace, view))}>
              {/* Draggable inside the tab: react-aria leaves native drags alone on draggable elements. */}
              <span className="view-tab-grip" draggable title={view.title}
                onClick={() => activate(view.id)}
                onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, view.id); event.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  const index = views.findIndex((item) => item.id === view.id);
                  setDropBefore(event.clientX < box.left + box.width / 2 ? view.id : views[index + 1]?.id);
                }}
                onAuxClick={(event) => { if (event.button === 1) close(view); }}
                onDoubleClick={() => { if (preview) useWorkbenchStore.getState().updateViewState(view.workspaceId, view.id, { preview: false }); }}>
                {Icon && <Icon size={14} view={view} />}
                <span className="view-tab-title">{view.title}</span>
                {status && <span className={`status-dot tone-${status.tone} ${status.unseen ? "is-unseen" : ""}`} aria-label={status.unseen ? "Completed" : status.label} role="img" />}
              </span>
              <AriaButton className={`tab-close ${unsaved ? "is-dirty" : ""}`} aria-label={unsaved ? `Close ${view.title} (unsaved)` : `Close ${view.title}`} onPress={() => close(view)}>
                {unsaved ? <span className="dirty-dot" aria-hidden="true" /> : null}<CloseIcon size={11} />
              </AriaButton>
            </Tab>;
          }}
        </TabList>
      </Tabs>}
    </div>
    {context.overlay}
    {workspace && hidden.length > 0 && <MenuTrigger>
      <AriaButton className="tab-overflow" aria-label={`${hidden.length} more views`}>+{hidden.length} more<ChevronDownIcon size={12} /></AriaButton>
      <Popover className="wb-popover" placement="bottom end">
        <Menu aria-label="More views" items={hidden} onAction={(key) => activate(String(key))}>
          {(view) => {
            const Icon = services.views.get(view.type)?.icon;
            return <MenuItem id={view.id} textValue={view.title}>{Icon && <Icon size={14} view={view} />}<span>{view.title}</span></MenuItem>;
          }}
        </Menu>
      </Popover>
    </MenuTrigger>}
    {workspace && <MenuTrigger>
      <AriaButton className="new-view-button" aria-label="Create view"><PlusIcon size={15} /></AriaButton>
      <Popover className="wb-popover view-menu-popover" placement="bottom end">
        <Menu aria-label="View type" onAction={(key) => void services.commands.execute("view.create", { workspaceId: workspace.id, viewType: String(key) })}>
          {services.views.list().filter((definition) => definition.creatable !== false).map((definition) => {
            const Icon = definition.icon;
            return <MenuItem id={definition.id} key={definition.id} textValue={definition.label}><Icon size={16} /><div><span>{definition.label}</span><small>{definition.description}</small></div></MenuItem>;
          })}
        </Menu>
      </Popover>
    </MenuTrigger>}
    {showRightToggle && <IconButton label="Show side panel" onPress={onShowRight}><SidebarRightIcon size={16} /></IconButton>}
  </div>;
}
