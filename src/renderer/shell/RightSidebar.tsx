import type { ExplorerTab, Workspace } from "../../shared/models";
import { useWorkbenchStore } from "../state/workbench-store";
import { IconButton } from "../ui/controls";
import { BranchIcon, FilesIcon, RocketIcon, SectionsIcon, SidebarRightIcon } from "../ui/icons";
import { FilesPanel } from "../features/files/FilesPanel";
import { SourceControlPanel } from "../features/source-control/SourceControlPanel";
import { useSourceControlStatus } from "../features/source-control/source-control-store";
import { SectionTree } from "../features/game/SectionTree";
import { ShipPanel } from "../features/ship/ShipPanel";
import { openExplorer, toggleExplorer } from "../features/explorer/explorer-store";

const TABS: { id: ExplorerTab; label: string; icon: (props: { size?: number }) => React.ReactNode }[] = [
  { id: "files", label: "Files", icon: FilesIcon },
  { id: "changes", label: "Changes", icon: BranchIcon },
  { id: "sections", label: "Sections", icon: SectionsIcon },
  { id: "ship", label: "Ship", icon: RocketIcon },
];

/**
 * The right sidebar for the selected piece of work, like Orca's: Files (the tree and search), Changes (diffs and the
 * commit box), Sections (open any moment in the game) and Ship (verify, screens, voices, the PR). ⌘⌥B hides it.
 */
export function RightSidebar({ workspace }: { workspace: Workspace }) {
  const tab = useWorkbenchStore((state) => state.layout.explorer?.tab ?? "files");
  const changes = useSourceControlStatus(workspace.path, true)?.status?.changes.length ?? 0;
  return <aside className="sidebar-card right-sidebar" aria-label="Explorer">
    <div className="explorer-bar" role="tablist" aria-label="Explorer">
      {TABS.map((item) => {
        const Icon = item.icon;
        const selected = item.id === tab;
        return <button key={item.id} role="tab" aria-selected={selected} aria-label={item.label} className={`explorer-tab ${selected ? "is-selected" : ""}`}
          title={item.label} onClick={() => openExplorer(item.id)}>
          <Icon size={15} /><span>{item.label}</span>
          {item.id === "changes" && changes > 0 && <span className="count-badge">{changes}</span>}
        </button>;
      })}
      <span className="explorer-bar-end"><IconButton label="Hide the explorer (⌘⌥B)" onPress={() => toggleExplorer(true)}><SidebarRightIcon size={15} /></IconButton></span>
    </div>
    <div className="explorer-body" role="tabpanel" aria-label={TABS.find((item) => item.id === tab)?.label}>
      {tab === "files" && <FilesPanel workspace={workspace} />}
      {tab === "changes" && <SourceControlPanel workspace={workspace} />}
      {tab === "sections" && <SectionTree workspace={workspace} />}
      {tab === "ship" && <ShipPanel workspaceId={workspace.id} docked />}
    </div>
  </aside>;
}
