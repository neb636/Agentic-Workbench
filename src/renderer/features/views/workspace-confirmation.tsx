import type { Workspace } from "../../../shared/models";
import { services } from "../../core/services";
import type { DestructiveConfirmation } from "../../ui/confirm";
import { FolderIcon } from "../../ui/icons";

/** "2 agent sessions · 1 terminal", in view registration order. */
function viewSummary(workspace: Workspace): string {
  const parts = services.views.list().flatMap((definition) => {
    const count = workspace.views.filter((view) => view.type === definition.id).length;
    const label = definition.label.toLowerCase();
    return count ? [`${count} ${count === 1 ? label : `${label}s`}`] : [];
  });
  return parts.length ? parts.join(" · ") : "Nothing open";
}

export function workspaceRemoveConfirmation(workspace: Workspace): DestructiveConfirmation {
  const open = workspace.views.length;
  return {
    title: "Remove workspace",
    message: "Are you sure you want to remove the following workspace?",
    warning: <><strong>Warning:</strong> This action <strong>cannot be undone</strong>. {open
      ? <>Removing the workspace closes its {open === 1 ? "open view" : `${open} open views`}, <strong>stopping any running sessions and terminals</strong>, and forgets its layout.</>
      : <>The workspace and its layout are <strong>removed from the workbench</strong>.</>} The folder on disk is not deleted.</>,
    subject: {
      icon: workspace.icon ? <img src={workspace.icon} alt="" draggable={false} /> : <FolderIcon size={20} />,
      name: workspace.name,
      detail: viewSummary(workspace),
      meta: workspace.path,
    },
    confirmLabel: "Yes, Remove Workspace",
  };
}
