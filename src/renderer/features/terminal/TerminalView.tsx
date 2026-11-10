import { useEffect, useState } from "react";
import type { ViewComponentProps } from "../../core/view-registry";
import { services } from "../../core/services";
import { startTerminalRuntime, useTerminalRuntimes } from "../../core/terminal-runtimes";
import type { TerminalViewState } from "../../../shared/models";
import { TerminalIcon } from "../../ui/icons";
import { TerminalSurface } from "./TerminalSurface";

/** The shell outlives this component: switching tabs only detaches it, and closing the view ends it. */
export function TerminalView({ workspace, view }: ViewComponentProps) {
  const cwd = (view.state as TerminalViewState | undefined)?.cwd ?? workspace.path;
  const runtime = useTerminalRuntimes((state) => state.sessions[view.id]);
  const [error, setError] = useState("");
  useEffect(() => {
    const provider = services.sessions.get("terminal.local");
    if (provider?.kind !== "terminal") return;
    let active = true;
    void startTerminalRuntime(view.id, provider, { workspacePath: cwd, cols: 100, rows: 24 })
      .catch((reason: unknown) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [view.id, cwd]);
  const status = error || (!runtime ? "Starting…" : runtime.exitCode !== undefined ? "Exited" : "Running");
  return <section className="terminal-view" aria-label="Terminal session">
    <div className="view-toolbar"><div className="view-toolbar-title"><TerminalIcon size={15} />Local terminal</div><div className="session-status">{status}</div></div>
    {runtime && <TerminalSurface controller={runtime.controller} />}
  </section>;
}
