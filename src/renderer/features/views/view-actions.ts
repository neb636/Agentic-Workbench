import type { WorkbenchView, Workspace } from "../../../shared/models";
import { services } from "../../core/services";
import type { ContextAction } from "../../ui/ContextMenu";
export function viewActions(workspace: Workspace, view: WorkbenchView): ContextAction[] {
  const close = async (mode: "one" | "others" | "right" | "all") => {
    const index = workspace.views.findIndex((v) => v.id === view.id);
    const targets = workspace.views.filter((v, i) => mode === "all" || (mode === "one" ? v.id === view.id : mode === "others" ? v.id !== view.id : i > index));
    for (const target of targets) if (!await services.commands.execute<boolean>("view.close", { workspaceId: workspace.id, viewId: target.id })) break;
  };
  return [
    { id: "close", label: "Close", section: "close", run: () => close("one") },
    { id: "close-others", label: "Close Others", section: "close", disabled: workspace.views.length < 2, run: () => close("others") },
    { id: "close-right", label: "Close to the Right", section: "close", disabled: workspace.views.at(-1)?.id === view.id, run: () => close("right") },
    { id: "close-all", label: "Close All", section: "close", run: () => close("all") },
    ...(services.views.of(view)?.tabMenu?.(view) ?? []).map((a) => ({ ...a, section: "view" })),
    ...services.contextMenus.forTarget({ kind: "view", workspace, view }),
  ];
}
export function workspaceActions(workspace: Workspace): ContextAction[] {
  return services.contextMenus.forTarget({ kind: "workspace", workspace });
}
