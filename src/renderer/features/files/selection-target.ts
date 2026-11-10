import { services } from "../../core/services";

export const sendShortcut = () => window.workbench.platform === "darwin" ? "⌘L" : "Ctrl+L";

/** Whether any feature takes selected text (agent sessions do); without one the pill and menu item don't show. */
export const takesSelections = () => services.contextMenus.list().some((contribution) => contribution.kind === "selection");
