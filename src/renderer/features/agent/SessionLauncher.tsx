import type { AgentProviderInfo, AgentViewState } from "../../../shared/models";
import { services } from "../../core/services";
import { AgentIcon } from "../../ui/icons";
import { Button } from "../../ui/controls";

/**
 * Shown only for a tab whose CLI isn't running (Studio was restarted, or it exited): pick Claude Code or Codex and
 * start again, or resume. New tabs start their CLI straight away and never show this.
 */
export function SessionLauncher({ state, providers, selected, busy, error, onChange, onStart }: {
  state: AgentViewState;
  providers: AgentProviderInfo[];
  selected?: string;
  busy: boolean;
  error: string;
  onChange: (patch: Partial<AgentViewState>) => void;
  onStart: (resume: boolean) => void;
}) {
  const agents = providers.filter((p) => services.sessions.get(p.id)?.kind === "agent");
  const available = Boolean(providers.find((p) => p.id === selected)?.available);
  const started = Boolean(state.cwd);
  return <section className="session-launcher is-compact" aria-label="Agent session">
    <div className="launcher-heading">
      <h2><AgentIcon size={18} /> {busy ? "Starting…" : started ? "This session isn't running" : "Start an agent"}</h2>
      <p>{started ? "Its CLI stopped (Studio restarted or it exited). Start a new one here, or resume where it was." : "Type below to start, or start the CLI now."}</p>
    </div>
    <div className="launcher-row">
      <select aria-label="Coding CLI" value={selected ?? ""} disabled={busy} onChange={(event) => onChange({ providerId: event.target.value })}>
        {agents.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? "" : " (not installed)"}</option>)}
      </select>
      <Button isDisabled={busy || !available} onPress={() => onStart(false)}>{busy ? "Starting…" : "Start"}</Button>
      <Button isDisabled={busy || !available} onPress={() => onStart(true)}>Resume previous…</Button>
    </div>
    {providers.length === 0 && !error && <p className="launcher-note">Checking installed CLIs…</p>}
    {agents.some((p) => !p.available) && <p className="launcher-note">{agents.find((p) => !p.available)?.reason}</p>}
    {error && <p role="alert" className="agent-error">{error}</p>}
  </section>;
}
