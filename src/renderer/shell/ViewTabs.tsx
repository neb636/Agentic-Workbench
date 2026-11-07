import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Tab, TabList, Tabs } from "react-aria-components";
import type { WorkbenchView, Workspace } from "../../shared/models";
import { services } from "../core/services";
import { useDirtyViews } from "../core/dirty-views";
import { useViewStatuses, viewStatus } from "../core/view-status";
import { useWorkbenchStore } from "../state/workbench-store";
import { IconButton } from "../ui/controls";
import { ChevronDownIcon, CloseIcon, PlusIcon, SidebarLeftIcon } from "../ui/icons";

const TAB_WIDTH = 146;
const DRAG_TYPE = "application/x-studio-tab";

/** Tabs that fit are shown; the rest move into a "+N more" menu, keeping the active tab visible. */
function splitTabs(views: WorkbenchView[], activeId: string | undefined, capacity: number) {
  if (views.length <= capacity) return { visible: views, hidden: [] };
  let visible = views.slice(0, capacity);
  const active = views.find((view) => view.id === activeId);
  if (active && !visible.includes(active)) visible = [...views.slice(0, capacity - 1), active];
  return { visible, hidden: views.filter((view) => !visible.includes(view)) };
}

/** Every new-tab entry: one per view type, or a type's own entries (the game and each lab). */
function newTabEntries() {
  return services.views.list().filter((definition) => definition.creatable !== false).flatMap((definition) =>
    definition.menuItems?.map((item) => ({ key: `${definition.id}:${item.id}`, label: item.label, description: item.description, icon: item.icon ?? definition.icon, open: item.open }))
    ?? [{ key: definition.id, label: definition.label, description: definition.description, icon: definition.icon,
      open: (workspaceId: string) => void services.commands.execute("view.create", { workspaceId, viewType: definition.id }) }]);
}

export function ViewTabs({ workspace, showLeftToggle, onShowLeft, trailing }: {
  workspace?: Workspace;
  showLeftToggle: boolean;
  onShowLeft: () => void;
  /** Buttons at the right end of the strip. */
  trailing?: React.ReactNode;
}) {
  const statuses = useViewStatuses();
  const dirty = useDirtyViews();
  const selectView = useWorkbenchStore((state) => state.selectView);
  const stripRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(Infinity);
  const [menu, setMenu] = useState<{ view: WorkbenchView; x: number; y: number }>();
  const [dropBefore, setDropBefore] = useState<string>();
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = stripRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setCapacity(Math.max(1, Math.floor(element.clientWidth / TAB_WIDTH))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const views = workspace?.views ?? [];
  const activeId = workspace?.activeViewId && views.some((view) => view.id === workspace.activeViewId) ? workspace.activeViewId : views[0]?.id;
  const { visible, hidden } = splitTabs(views, activeId, capacity);
  const close = (view: WorkbenchView) => void services.commands.execute("view.close", { workspaceId: view.workspaceId, viewId: view.id });
  const closeOthers = async (keep: WorkbenchView) => {
    for (const view of views) if (view.id !== keep.id) await services.commands.execute("view.close", { workspaceId: view.workspaceId, viewId: view.id });
  };
  const entries = newTabEntries();
  const menuItems = menu ? [
    { id: "close", label: "Close", run: () => close(menu.view) },
    { id: "close-others", label: "Close others", run: () => void closeOthers(menu.view) },
    ...(services.views.get(menu.view.type)?.tabMenu?.(menu.view) ?? []),
  ] : [];

  return <div className={`tab-strip ${showLeftToggle ? "has-traffic-lights" : ""}`}>
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
      {workspace && <Tabs className="view-tabs" selectedKey={activeId}
        onSelectionChange={(key) => selectView(workspace.id, String(key))}>
        <TabList aria-label="Open tabs" className="view-tab-list" items={visible} dependencies={[statuses, dirty, dropBefore]}>
          {(view) => {
            const definition = services.views.get(view.type);
            const Icon = definition?.icon;
            const status = viewStatus(view, statuses);
            const unsaved = dirty[view.id];
            return <Tab id={view.id} className={`view-tab ${definition?.isPreview?.(view) ? "is-preview" : ""} ${dropBefore === view.id ? "is-drop-before" : ""}`} aria-label={view.title}>
              {/* Draggable inside the tab: react-aria leaves native drags alone on draggable elements. */}
              <span className="view-tab-grip" draggable title={view.title}
                onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, view.id); event.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  const index = views.findIndex((item) => item.id === view.id);
                  setDropBefore(event.clientX < box.left + box.width / 2 ? view.id : views[index + 1]?.id);
                }}
                onContextMenu={(event) => { event.preventDefault(); setMenu({ view, x: event.clientX, y: event.clientY }); }}
                onAuxClick={(event) => { if (event.button === 1) close(view); }}
                onDoubleClick={() => { if (definition?.isPreview?.(view)) useWorkbenchStore.getState().updateViewState(view.workspaceId, view.id, { preview: false }); }}>
                {Icon && <Icon size={14} />}
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
    <div ref={anchor} className="tab-menu-anchor" style={menu ? { left: menu.x, top: menu.y } : undefined} />
    {menu && <Popover className="wb-popover" triggerRef={anchor} isOpen placement="bottom start" onOpenChange={(open) => { if (!open) setMenu(undefined); }}>
      <Menu aria-label={`${menu.view.title} menu`} autoFocus="first" onAction={(key) => { menuItems.find((item) => item.id === key)?.run(); setMenu(undefined); }}>
        {menuItems.map((item) => <MenuItem key={item.id} id={item.id}>{item.label}</MenuItem>)}
      </Menu>
    </Popover>}
    {workspace && hidden.length > 0 && <MenuTrigger>
      <AriaButton className="tab-overflow" aria-label={`${hidden.length} more tabs`}>+{hidden.length} more<ChevronDownIcon size={12} /></AriaButton>
      <Popover className="wb-popover" placement="bottom end">
        <Menu aria-label="More tabs" items={hidden} onAction={(key) => selectView(workspace.id, String(key))}>
          {(view) => {
            const Icon = services.views.get(view.type)?.icon;
            return <MenuItem id={view.id} textValue={view.title}>{Icon && <Icon size={14} />}<span>{view.title}</span></MenuItem>;
          }}
        </Menu>
      </Popover>
    </MenuTrigger>}
    {workspace && <MenuTrigger>
      <AriaButton className="new-view-button" aria-label="New tab"><PlusIcon size={15} /></AriaButton>
      <Popover className="wb-popover view-menu-popover" placement="bottom end">
        <Menu aria-label="New tab" onAction={(key) => entries.find((entry) => entry.key === key)?.open(workspace.id)}>
          {entries.map((entry) => {
            const Icon = entry.icon;
            return <MenuItem id={entry.key} key={entry.key} textValue={entry.label}><Icon size={16} /><div><span>{entry.label}</span><small>{entry.description}</small></div></MenuItem>;
          })}
        </Menu>
      </Popover>
    </MenuTrigger>}
    {trailing}
  </div>;
}
