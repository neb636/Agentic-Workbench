import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerFirstPartyContributions } from "./app/register-first-party";
import { WorkbenchShell } from "./shell/WorkbenchShell";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/shell.css";
import "./theme/composer.css";
import "./theme/panels.css";
import "./theme/code.css";

registerFirstPartyContributions();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkbenchShell />
  </StrictMode>,
);

// Native text commands retain the browser's selection and undo history.
window.addEventListener("contextmenu", (event) => {
  if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
  if (event.target.closest(".cm-editor, .xterm")) return;
  if (event.target.closest("input, textarea, [contenteditable=true]")) { event.preventDefault(); window.workbench.app.textMenu(); }
});
