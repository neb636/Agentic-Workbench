import { useEffect, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { services } from "../core/services";
import { useWorkbenchStore } from "../state/workbench-store";
import { focusGame } from "../features/game/game-store";
import { openExplorer, toggleExplorer } from "../features/explorer/explorer-store";
import { QuickOpen } from "../features/files/QuickOpen";
import { FolderIcon, SidebarRightIcon } from "../ui/icons";
import { Button, IconButton } from "../ui/controls";
import { LeftSidebar } from "./LeftSidebar";
import { CenterArea } from "./CenterArea";
import { RightSidebar } from "./RightSidebar";
import { StatusBar } from "./StatusBar";

/** With no game tab left in the piece of work on screen, its server waits this long (it may come back), then stops. */
const NO_GAME_GRACE_MS = 60_000;
const EXPLORER_SIZE = 22;

/** Keeps a collapsible panel in step with its persisted collapsed flag. */
function useCollapsible(collapsed: boolean) {
  const ref = useRef<ImperativePanelHandle>(null);
  useEffect(() => {
    const panel = ref.current;
    if (!panel || panel.isCollapsed() === collapsed) return;
    if (collapsed) panel.collapse(); else panel.expand();
  }, [collapsed]);
  return ref;
}

export function WorkbenchShell() {
  const workspaces = useWorkbenchStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkbenchStore((state) => state.activeWorkspaceId);
  const isHydrated = useWorkbenchStore((state) => state.isHydrated);
  const hydrate = useWorkbenchStore((state) => state.hydrate);
  const layout = useWorkbenchStore((state) => state.layout);
  const updateLayout = useWorkbenchStore((state) => state.updateLayout);
  const leftRef = useCollapsible(layout.leftCollapsed);
  const explorerCollapsed = Boolean(layout.explorer?.collapsed);
  const rightRef = useCollapsible(explorerCollapsed);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const hasGame = Boolean(activeWorkspace?.views.some((view) => view.type === "game"));

  useEffect(() => { void hydrate(); }, [hydrate]);

  // No game tab here: stop the game servers after a grace period (an 8 GB Mac; a new Game tab restarts it in seconds).
  useEffect(() => {
    if (hasGame) return;
    const timer = setTimeout(() => void window.workbench.studio.trimServers(0).catch(() => undefined), NO_GAME_GRACE_MS);
    return () => clearTimeout(timer);
  }, [hasGame]);

  // Menu shortcuts (main catches them for the whole window, game frame included).
  const menuRef = useRef<(command: string) => void>(() => {});
  menuRef.current = (command) => {
    if (!activeWorkspace) return;
    if (command === "game") focusGame(activeWorkspace.id);
    else if (command === "explorer") toggleExplorer();
    else if (command === "quick-open") void services.commands.execute("file.quickOpen");
    else if (command === "find-in-files") openExplorer("files", { search: "contents" });
  };
  useEffect(() => window.workbench.studio.onMenu((command) => menuRef.current(command)), []);

  if (!isHydrated) return <div className="launch-screen"><div className="brand-mark large"><span>KG</span></div><p>Opening Gamepack Studio…</p></div>;

  // The work on the left, one tab on screen in the middle (an agent most of the time), the explorer on the right.
  return <div className={`app-shell ${layout.leftCollapsed ? "is-left-collapsed" : ""}`}>
    <PanelGroup direction="horizontal" className="shell-panels" onLayout={(sizes) => {
      const [left, , right] = sizes;
      const patch: Partial<typeof layout> = {};
      if (left > 0 && Math.abs(left - (layout.leftSize ?? 0)) > 0.2) patch.leftSize = left;
      if (right > 0 && Math.abs(right - (layout.explorer?.size ?? 0)) > 0.2) patch.explorer = { ...useWorkbenchStore.getState().layout.explorer, size: right };
      if (Object.keys(patch).length) updateLayout(patch);
    }}>
      <Panel id="left" order={1} ref={leftRef} className="shell-panel" collapsible collapsedSize={0} minSize={14} maxSize={32}
        defaultSize={layout.leftCollapsed ? 0 : layout.leftSize ?? 18}
        onCollapse={() => updateLayout({ leftCollapsed: true })} onExpand={() => updateLayout({ leftCollapsed: false })}>
        <LeftSidebar onCollapse={() => updateLayout({ leftCollapsed: true })} />
      </Panel>
      <PanelResizeHandle className="shell-resize" aria-label="Resize work sidebar" />
      <Panel id="middle" order={2} className="shell-panel" minSize={30}>
        {!activeWorkspace ? <main className="center-column">
          <div className="welcome-view">
            <div className="welcome-icon"><FolderIcon size={25} /></div>
            <h1>Open Kaylee's Gamepack</h1>
            <p>Pick your Kaylee-Gamepack checkout once. Studio lists its worktrees and PRs by itself.</p>
            <Button className="primary-button" onPress={() => void services.commands.execute("repo.open")}><FolderIcon size={16} /> Open the Gamepack repo</Button>
          </div>
        </main> : <CenterArea workspace={activeWorkspace}
          onShowLeft={layout.leftCollapsed ? () => updateLayout({ leftCollapsed: false }) : undefined}
          trailing={explorerCollapsed ? <IconButton label="Show the explorer (⌘⌥B)" onPress={() => toggleExplorer()}><SidebarRightIcon size={16} /></IconButton> : undefined} />}
      </Panel>
      <PanelResizeHandle className="shell-resize" aria-label="Resize explorer" />
      <Panel id="right" order={3} ref={rightRef} className="shell-panel" collapsible collapsedSize={0} minSize={14} maxSize={40}
        defaultSize={explorerCollapsed ? 0 : layout.explorer?.size ?? EXPLORER_SIZE}
        onCollapse={() => { if (!useWorkbenchStore.getState().layout.explorer?.collapsed) toggleExplorer(true); }}
        onExpand={() => { if (useWorkbenchStore.getState().layout.explorer?.collapsed) toggleExplorer(false); }}>
        {activeWorkspace && <RightSidebar workspace={activeWorkspace} />}
      </Panel>
    </PanelGroup>
    <QuickOpen />
    <StatusBar />
  </div>;
}
