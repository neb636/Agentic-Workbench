import { useEffect, useState } from "react";
import type { ViewComponentProps } from "../../core/view-registry";
import { services } from "../../core/services";
import type { TerminalSessionController } from "../../core/session-provider-registry";
import { TerminalIcon } from "../../ui/icons";
import { TerminalSurface } from "./TerminalSurface";

export function TerminalView({ workspace, view }: ViewComponentProps) {
  const cwd = (view.state as import("../../../shared/models").TerminalViewState | undefined)?.cwd ?? workspace.path;
  const [controller, setController] = useState<TerminalSessionController>();
  const [status, setStatus] = useState("Starting…");
  useEffect(() => {
    const provider = services.sessions.get("terminal.local");
    if (provider?.kind !== "terminal") return;
    let active = true;
    let resource: TerminalSessionController | undefined;
    let off: (() => void) | undefined;
    void provider.create({ workspacePath: cwd, cols: 100, rows: 24 }).then((created) => {
      if (!active) { created.dispose(); return; }
      resource = created; setController(created); setStatus("Running");
      off = created.onExit?.(() => setStatus("Exited"));
    }).catch((error: unknown) => { if (active) setStatus(String(error)); });
    return () => { active = false; off?.(); resource?.dispose(); };
  }, [cwd]);
  return <section className="terminal-view" aria-label="Terminal session">
    <div className="view-toolbar"><div className="view-toolbar-title"><TerminalIcon size={15} />Local terminal</div><div className="session-status">{status}</div></div>
    {controller && <TerminalSurface controller={controller} />}
  </section>;
}
