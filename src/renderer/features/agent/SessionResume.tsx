import type { AgentProviderInfo } from "../../../shared/models";
import { services } from "../../core/services";
import { Button } from "../../ui/controls";
import { emptyComposerRuntime, useComposerState } from "./composer-state";

/** Stands in for the terminal of a saved conversation until the person brings it back. */
export function SessionResume({ workspaceId, viewId, location, provider }: {
  workspaceId: string;
  viewId: string;
  location: string;
  /** Undefined while the installed CLIs are still being checked. */
  provider?: AgentProviderInfo;
}) {
  const { launching, resumeError } = useComposerState((s) => s.views[viewId] ?? emptyComposerRuntime);
  const target = { workspaceId, viewId };
  return <section className="session-launcher" aria-label="Resume agent session">
    <div className="launcher-heading">
      <h2>Resume this session</h2>
      <p>The CLI closed with the app. Resume to pick the conversation up where it left off.</p>
    </div>
    <dl className="launcher-fields">
      <dt>Harness</dt>
      <dd>{provider?.label ?? "Checking…"}</dd>
      <dt>Location</dt>
      <dd><code className="launcher-location">{location}</code></dd>
    </dl>
    {provider && !provider.available && <p className="launcher-note">{provider.reason}</p>}
    {resumeError && <p role="alert" className="agent-error">{resumeError}</p>}
    <div className="launcher-actions">
      <Button isDisabled={launching} onPress={() => void services.commands.execute("agent.session.forget", target)}>Start new session</Button>
      <Button className="primary-button" isDisabled={launching || !provider?.available} onPress={() => void services.commands.execute("agent.session.resume", target)}>{launching ? "Resuming…" : "Resume session"}</Button>
    </div>
  </section>;
}
