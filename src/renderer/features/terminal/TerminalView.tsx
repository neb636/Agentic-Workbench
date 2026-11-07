import { useEffect, useState } from "react";
import { useWorkbenchStore } from "../../state/workbench-store";
import type { ViewComponentProps } from "../../core/view-registry";
import { services } from "../../core/services";
import type { TerminalSessionController } from "../../core/session-provider-registry";
import { TerminalIcon } from "../../ui/icons";
import { TerminalSurface } from "./TerminalSurface";

/** A terminal can be asked to run one command (the Ship buttons): `command` runs once per `commandNonce`. */
export interface TerminalViewState { command?: string; commandNonce?: number; ranNonce?: number; ship?: boolean }

export function TerminalView({ view, workspace }: ViewComponentProps) {
  const state = (view.state ?? {}) as TerminalViewState;
  const [controller, setController] = useState<TerminalSessionController>();
  const [status, setStatus] = useState("Starting…");
  useEffect(() => {
    const provider = services.sessions.get("terminal.local");
    if (provider?.kind !== "terminal") return;
    let active = true;
    let resource: TerminalSessionController | undefined;
    let off: (() => void) | undefined;
    void provider.create({ workspacePath: workspace.path, cols: 100, rows: 24 }).then((created) => {
      if (!active) { created.dispose(); return; }
      resource = created; setController(created); setStatus("Running");
      off = created.onExit?.(() => setStatus("Exited"));
    }).catch((error: unknown) => { if (active) setStatus(String(error)); });
    return () => { active = false; off?.(); resource?.dispose(); };
  }, [workspace.path]);
  useEffect(() => {
    // ranNonce is saved, so a restart never runs the last command again.
    if (!controller || !state.command || !state.commandNonce || state.commandNonce === state.ranNonce) return;
    controller.input?.(`${state.command}\r`);
    useWorkbenchStore.getState().updateViewState(workspace.id, view.id, { ranNonce: state.commandNonce });
  }, [controller, state.command, state.commandNonce, state.ranNonce, workspace.id, view.id]);
  return <section className="terminal-view" aria-label="Terminal session">
    <div className="view-toolbar"><div className="view-toolbar-title"><TerminalIcon size={15} />Local terminal</div><div className="session-status">{status}</div></div>
    {controller && <TerminalSurface controller={controller} root={workspace.path}
      onOpenPath={(path, line) => void services.commands.execute("file.open", { workspaceId: workspace.id, root: workspace.path, path, line, preview: true })} />}
  </section>;
}
