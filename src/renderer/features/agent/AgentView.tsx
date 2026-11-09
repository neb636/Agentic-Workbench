import { useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { AgentProviderInfo, AgentViewState } from "../../../shared/models";
import { services } from "../../core/services";
import { acknowledgeAgentCompletion, startAgentRuntime, useAgentRuntimes } from "../../core/agent-runtimes";
import { errorMessage } from "../../core/errors";
import type { ViewComponentProps } from "../../core/view-registry";
import { useWorkbenchStore } from "../../state/workbench-store";
import { Button } from "../../ui/controls";
import { ChevronUpIcon } from "../../ui/icons";
import { AgentComposer, type ComposerSession } from "./AgentComposer";
import { modelSettings, rememberAgentModels } from "./agent-models";
import { prepareSessionFolder } from "./composer-state";
import { SessionLauncher } from "./SessionLauncher";
import { agentRuntimeStatus } from "./session-status";
import { TerminalSurface, type TerminalSurfaceHandle } from "../terminal/TerminalSurface";

export function AgentView({ view, workspace }: ViewComponentProps) {
  const state = (view.state ?? {}) as AgentViewState;
  const runtime = useAgentRuntimes((s) => s.sessions[view.id]);
  useEffect(() => { acknowledgeAgentCompletion(view.id); }, [view.id, runtime?.status?.completed]);
  const update = useWorkbenchStore((s) => s.updateViewState);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState("");
  const terminalRef = useRef<TerminalSurfaceHandle>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const [composerMinimum, setComposerMinimum] = useState(40);
  const hasQuotations = Boolean(state.quotations?.length);
  const hasAttachments = Boolean(state.attachments?.length);
  const live = Boolean(runtime);
  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const measure = () => setComposerMinimum(Math.min(75, Math.max(20, ((live ? 210 : 176) + (hasQuotations ? 48 : 0) + (hasAttachments ? 92 : 0)) / element.clientHeight * 100)));
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [live, hasQuotations, hasAttachments, state.composerCollapsed]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void window.workbench.agent.providers().then((items) => { rememberAgentModels(items); if (active) setProviders(items); }).catch((e: unknown) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, []);
  const selected = state.providerId ?? providers.find((p) => p.available)?.id ?? providers[0]?.id;
  const patch = (value: Partial<AgentViewState>) => update(workspace.id, view.id, value);
  const start = async (resume = false) => {
    if (busy) return;
    const provider = services.sessions.get(selected ?? "");
    if (provider?.kind !== "agent") return;
    setBusy(true); setError(""); patch({ providerId: provider.id });
    // A new conversation launches with the composer's model and effort; a resumed one keeps its own.
    const settings = resume ? undefined : modelSettings(provider.id, state.modelSettings?.[provider.id]) ?? undefined;
    try { await startAgentRuntime(view.id, provider, { workspacePath: await prepareSessionFolder({ workspaceId: workspace.id, viewId: view.id }), resume, settings }); }
    catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const session: ComposerSession | undefined = runtime && {
    status: runtime.status,
    display: agentRuntimeStatus(runtime),
    planning: Boolean(providers.find((p) => p.id === runtime.providerId)?.capabilities?.planning),
    selection,
    interrupt: () => runtime.controller.interrupt(),
    focusTerminal: () => terminalRef.current?.focus(),
  };
  const top = runtime
    ? <div className="terminal-card"><TerminalSurface controller={runtime.controller} ref={terminalRef} onSelectionChange={setSelection}
      root={state.cwd ?? workspace.path} onOpenPath={(path, line) => void services.commands.execute("file.open", { workspaceId: workspace.id, root: state.cwd ?? workspace.path, path, line, preview: true })} /></div>
    : <SessionLauncher workspace={workspace} state={state} providers={providers} selected={selected} busy={busy} error={error}
        onChange={patch} onStart={(resume) => void start(resume)} />;
  const composer = <AgentComposer key={runtime?.controller.id ?? "setup"} workspaceId={workspace.id} viewId={view.id} agentLabel={services.sessions.get(runtime?.providerId ?? selected ?? "")?.label ?? "the agent"}
    state={{ ...state, providerId: selected }} session={session} canLaunch={Boolean(providers.find((p) => p.id === selected)?.available)}
    onCollapse={() => patch({ composerCollapsed: true })} />;

  if (state.composerCollapsed) return <section className="agent-view is-composer-collapsed" aria-label="Agent session">
    <div className="agent-display">{top}</div>
    <div className="composer-collapsed">
      {session && <span className={`session-pill tone-${session.display.tone}`}><span className="status-dot" />{session.display.label}</span>}
      <Button className="strip-button" onPress={() => patch({ composerCollapsed: false })}><ChevronUpIcon size={13} />Show composer</Button>
    </div>
  </section>;

  const split = Math.min(100 - composerMinimum, Math.max(25, typeof state.split === "number" ? state.split : 62));
  return <section ref={layoutRef} className="agent-view" aria-label="Agent session">
    <PanelGroup direction="vertical" onLayout={([height]) => { if (Math.abs(height - split) > .01) patch({ split: height }); }}>
      <Panel className="agent-display" defaultSize={split} minSize={25}>{top}</Panel>
      <PanelResizeHandle className="dock-resize" aria-label="Composer height"><span /></PanelResizeHandle>
      <Panel className="agent-composer-panel" defaultSize={100 - split} minSize={composerMinimum}>{composer}</Panel>
    </PanelGroup>
  </section>;
}
