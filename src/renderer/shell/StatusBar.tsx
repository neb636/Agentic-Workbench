import { services } from "../core/services";
import { useContributions } from "../core/registry";
import { useWorkbenchStore } from "../state/workbench-store";

export function StatusBar() {
  useContributions();
  const workspaceId = useWorkbenchStore((state) => state.activeWorkspaceId ?? state.workspaces[0]?.id);
  const render = (slot: string) => services.widgets.forSlot(slot, workspaceId).map((widget) => {
    const Widget = widget.component;
    return <Widget key={widget.id} />;
  });
  return <footer className="status-bar" aria-label="Status">
    <div className="status-bar-group">{render("statusbar.start")}</div>
    <div className="status-bar-group">{render("statusbar.end")}</div>
  </footer>;
}
