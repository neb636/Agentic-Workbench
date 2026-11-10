import { useEffect, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { services } from "../core/services";
import { openPanel } from "../features/explorer/explorer-store";
import { QuickOpen } from "../features/files/QuickOpen";
import { ConfirmDialogHost } from "../ui/ConfirmDialog";
import { useWorkbenchStore } from "../state/workbench-store";
import { AgentIcon, FolderIcon, PlusIcon, TerminalIcon } from "../ui/icons";
import { Button } from "../ui/controls";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { StatusBar } from "./StatusBar";
import { ViewTabs } from "./ViewTabs";

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
  const rightRef = useCollapsible(layout.rightCollapsed);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const activeView = activeWorkspace?.views.find((view) => view.id === activeWorkspace.activeViewId);
  const definition = activeView ? services.views.get(activeView.type) : undefined;

  useEffect(() => {
    void hydrate().then(() => {
      // The view the app opens on is the one the person left off in, so it wakes as if they had clicked it. The others wait for a click.
      const { workspaces: restored, activeWorkspaceId: activeId } = useWorkbenchStore.getState();
      const workspace = restored.find((item) => item.id === activeId) ?? restored[0];
      if (workspace?.activeViewId) void services.commands.execute("view.activate", { workspaceId: workspace.id, viewId: workspace.activeViewId });
    });
  }, [hydrate]);
  // Application-menu shortcuts (⌘P, ⇧⌘F) work wherever focus is, a terminal included.
  useEffect(() => window.workbench.app.onMenuCommand((command) => {
    if (command === "quick-open") void services.commands.execute("file.quickOpen");
    else if (command === "find-in-files") openPanel("files", { search: "contents" });
  }), []);

  if (!isHydrated) return <div className="launch-screen"><div className="brand-mark large"><span>AW</span></div><p>Opening workbench…</p></div>;

  return <div className={`app-shell ${layout.leftCollapsed ? "is-left-collapsed" : ""}`}>
    <PanelGroup direction="horizontal" className="shell-panels" onLayout={([left, , right]) => {
      const patch: { leftSize?: number; rightSize?: number } = {};
      if (left > 0 && Math.abs(left - (layout.leftSize ?? 0)) > 0.2) patch.leftSize = left;
      if (right > 0 && Math.abs(right - (layout.rightSize ?? 0)) > 0.2) patch.rightSize = right;
      if (patch.leftSize !== undefined || patch.rightSize !== undefined) updateLayout(patch);
    }}>
      <Panel id="left" order={1} ref={leftRef} className="shell-panel" collapsible collapsedSize={0} minSize={14} maxSize={32}
        defaultSize={layout.leftCollapsed ? 0 : layout.leftSize ?? 18}
        onCollapse={() => updateLayout({ leftCollapsed: true })} onExpand={() => updateLayout({ leftCollapsed: false })}>
        <LeftSidebar onCollapse={() => updateLayout({ leftCollapsed: true })} />
      </Panel>
      <PanelResizeHandle className="shell-resize" aria-label="Resize workspaces sidebar" />
      <Panel id="center" order={2} className="shell-panel" minSize={36}>
        <main className="center-column">
          <ViewTabs workspace={activeWorkspace} showLeftToggle={layout.leftCollapsed} showRightToggle={layout.rightCollapsed}
            onShowLeft={() => updateLayout({ leftCollapsed: false })} onShowRight={() => updateLayout({ rightCollapsed: false })} />
          <div className="active-view-region">
            {!activeWorkspace ? (
              <div className="welcome-view">
                <div className="welcome-icon"><FolderIcon size={25} /></div>
                <h1>Bring your work into one place</h1>
                <p>Add a local folder to create a workspace. Everything stays on this machine.</p>
                <Button className="primary-button" onPress={() => void services.commands.execute("workspace.add")}><PlusIcon size={16} /> Add workspace</Button>
              </div>
            ) : activeView && definition ? (
              <definition.component key={activeView.id} view={activeView} workspace={activeWorkspace} />
            ) : activeView ? (
              <div className="missing-view"><h2>View unavailable</h2><p>No view is registered for <code>{activeView.type}</code>.</p></div>
            ) : (
              <div className="empty-workspace">
                <h2>Open a view</h2><p>Nothing is open in {activeWorkspace.name}.</p>
                <div className="empty-actions">
                  <Button onPress={() => void services.commands.execute("view.create", { workspaceId: activeWorkspace.id, viewType: "agent" })}><AgentIcon size={16} />Agent session</Button>
                  <Button onPress={() => void services.commands.execute("view.create", { workspaceId: activeWorkspace.id, viewType: "terminal" })}><TerminalIcon size={16} />Terminal</Button>
                </div>
              </div>
            )}
          </div>
        </main>
      </Panel>
      <PanelResizeHandle className="shell-resize" aria-label="Resize side panel" />
      <Panel id="right" order={3} ref={rightRef} className="shell-panel" collapsible collapsedSize={0} minSize={16} maxSize={36}
        defaultSize={layout.rightCollapsed ? 0 : layout.rightSize ?? 21}
        onCollapse={() => updateLayout({ rightCollapsed: true })} onExpand={() => updateLayout({ rightCollapsed: false })}>
        <RightSidebar workspace={activeWorkspace} onCollapse={() => updateLayout({ rightCollapsed: true })} />
      </Panel>
    </PanelGroup>
    <StatusBar />
    <QuickOpen />
    <ConfirmDialogHost />
  </div>;
}
