import { useRef } from "react";
import { ToggleButton, ToggleButtonGroup, Tooltip, TooltipTrigger } from "react-aria-components";
import type { Workspace } from "../../shared/models";
import { services } from "../core/services";
import { useContributions } from "../core/registry";
import { useWorkbenchStore } from "../state/workbench-store";
import { isFilesWorkspace } from "../../shared/files-workspace";
import { IconButton } from "../ui/controls";
import { useGuardedTooltip } from "../ui/use-guarded-tooltip";
import { SidebarRightIcon } from "../ui/icons";

export function RightSidebar({ workspace, onCollapse }: { workspace?: Workspace; onCollapse: () => void }) {
  useContributions();
  const panels = services.panels.ordered(workspace?.id);
  const selected = useWorkbenchStore((state) => state.layout.rightPanel);
  const updateLayout = useWorkbenchStore((state) => state.updateLayout);
  const active = panels.find((panel) => panel.id === selected) ?? panels[0];
  const Panel = active?.component;
  // The Files workspace has no folder to browse or track: its panels would have nothing to show.
  const folder = workspace && !isFilesWorkspace(workspace) ? workspace : undefined;

  return <aside className="sidebar-card right-sidebar" aria-label="Side panels">
    <div className="activity-bar">
      <IconButton label="Hide side panel" onPress={onCollapse}><SidebarRightIcon size={16} /></IconButton>
      <ToggleButtonGroup aria-label="Side panel" className="activity-buttons" selectionMode="single" disallowEmptySelection
        selectedKeys={active ? [active.id] : []} onSelectionChange={(keys) => { const key = [...keys][0]; if (key) updateLayout({ rightPanel: String(key) }); }}>
        {panels.map((panel) => {
          const Icon = panel.icon;
          const Badge = panel.badge;
          return <PanelButton key={panel.id} id={panel.id} label={panel.label}><Icon size={16} />{folder && Badge && <Badge workspace={folder} />}</PanelButton>;
        })}
      </ToggleButtonGroup>
    </div>
    <div className="side-panel-region">
      {folder && active && Panel ? <Panel key={`${active.id}-${folder.id}`} workspace={folder} />
        : workspace ? <p className="panel-empty">Files opened on their own have no folder here. Use Open Folder as Workspace on a tab to browse its folder.</p>
        : <p className="panel-empty">Add a workspace to browse its files and changes.</p>}
    </div>
  </aside>;
}

function PanelButton({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <TooltipTrigger delay={400} {...useGuardedTooltip(ref)}>
    <ToggleButton id={id} ref={ref} className="activity-button" aria-label={label}>{children}</ToggleButton>
    <Tooltip className="wb-tooltip" offset={6}>{label}</Tooltip>
  </TooltipTrigger>;
}
