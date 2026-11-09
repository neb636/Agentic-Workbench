import { useEffect, useState } from "react";
import { Input, Label, Radio, RadioGroup, TextField, ToggleButton, ToggleButtonGroup } from "react-aria-components";
import type { AgentProviderInfo, AgentViewState, Workspace } from "../../../shared/models";
import { services } from "../../core/services";
import { AgentIcon, BranchIcon, CheckIcon, FolderIcon } from "../../ui/icons";
import { Button } from "../../ui/controls";
import { CreateFromPicker } from "./CreateFromPicker";
import { useBaseBranches } from "./use-base-branches";

function suggestedBranch(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  // Every new session gets a worktree by default, so two started in the same minute must not collide.
  return `wb/session-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function SessionLauncher({ workspace, state, providers, selected, busy, needsModel, error, onChange, onStart }: {
  workspace: Workspace;
  state: AgentViewState;
  providers: AgentProviderInfo[];
  selected?: string;
  busy: boolean;
  /** No model is chosen yet, so a new conversation can't start. Resuming keeps the conversation's own model. */
  needsModel: boolean;
  error: string;
  onChange: (patch: Partial<AgentViewState>) => void;
  onStart: (resume: boolean) => void;
}) {
  const [canWorktree, setCanWorktree] = useState(false);
  useEffect(() => {
    let active = true;
    void window.workbench.sourceControl.detect(workspace.path).then((value) => { if (active) setCanWorktree(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [workspace.path]);
  // A worktree is the default wherever one is possible; an explicit choice is kept.
  const needsDefault = canWorktree && !state.runIn && !state.cwd;
  useEffect(() => {
    if (needsDefault) onChange({ runIn: { kind: "worktree", branch: suggestedBranch() } });
  }, [needsDefault, onChange]);
  const runIn = state.runIn ?? { kind: "checkout" };
  const bases = useBaseBranches(workspace.path, canWorktree && !state.cwd);
  const branchTaken = runIn.kind === "worktree" && Boolean(bases.data?.branches.some((b) => b.kind === "local" && b.name === runIn.branch));
  const available = Boolean(providers.find((p) => p.id === selected)?.available);
  const agents = providers.filter((p) => services.sessions.get(p.id)?.kind === "agent");
  const location = state.cwd ?? (runIn.kind === "worktree" ? `${workspace.path}-worktrees/${runIn.branch.replace(/[^A-Za-z0-9._-]+/g, "-")}` : workspace.path);

  return <section className="session-launcher" aria-label="New agent session">
    <div className="launcher-heading">
      <h2>Start a new session</h2>
      <p>Choose a harness and a model, then send your first prompt. The CLI starts when you send.</p>
    </div>
    <RadioGroup aria-label="Coding harness" value={selected ?? ""} onChange={(providerId) => onChange({ providerId })} className="harness-options" orientation="horizontal">
      {agents.map((p) => {
        const provider = services.sessions.get(p.id);
        return <Radio key={p.id} value={p.id} isDisabled={!p.available || busy} className="harness-option">
          {({ isSelected }) => <>
            <span className="harness-icon"><AgentIcon size={18} /></span>
            <span className="harness-copy">
              <strong>{p.label}</strong>
              <small>{provider?.description && `${provider.description} · `}<span className={p.available ? "is-ready" : "is-missing"}>{p.available ? "Ready" : "Not installed"}</span></small>
            </span>
            <span className={`harness-check ${isSelected ? "is-selected" : ""}`} aria-hidden="true">{isSelected && <CheckIcon size={12} />}</span>
          </>}
        </Radio>;
      })}
    </RadioGroup>
    {providers.length === 0 && !error && <p className="launcher-note">Checking installed harnesses…</p>}
    {agents.some((p) => !p.available) && <p className="launcher-note">{agents.find((p) => !p.available)?.reason}</p>}
    <dl className="launcher-fields">
      <dt>Run in</dt>
      <dd>
        <ToggleButtonGroup aria-label="Run in" className="segmented" selectionMode="single" disallowEmptySelection isDisabled={Boolean(state.cwd)}
          selectedKeys={[runIn.kind]} onSelectionChange={(keys) => {
            const kind = [...keys][0];
            onChange({ runIn: kind === "worktree" ? { kind: "worktree", branch: suggestedBranch() } : { kind: "checkout" } });
          }}>
          <ToggleButton id="checkout" className="segment"><FolderIcon size={13} />Local workspace checkout</ToggleButton>
          <ToggleButton id="worktree" className="segment" isDisabled={!canWorktree}><BranchIcon size={13} />New worktree</ToggleButton>
        </ToggleButtonGroup>
      </dd>
      {runIn.kind === "worktree" && !state.cwd && <>
        <dt>Create from</dt>
        <dd><CreateFromPicker {...bases} onOpen={bases.refresh} value={runIn.base} isDisabled={busy} onChange={(base) => onChange({ runIn: { ...runIn, base } })} /></dd>
        <dt>Branch</dt>
        <dd>
          <TextField aria-label="Branch" className="launcher-text" isInvalid={branchTaken} value={runIn.branch} onChange={(branch) => onChange({ runIn: { ...runIn, branch } })}>
            <Label className="visually-hidden">Branch</Label><Input />
          </TextField>
          {branchTaken && <p role="alert" className="launcher-field-error">A branch with this name already exists.</p>}
        </dd>
      </>}
      <dt>Location</dt>
      <dd><code className="launcher-location">{location}</code></dd>
    </dl>
    {error && <p role="alert" className="agent-error">{error}</p>}
    <div className="launcher-actions">
      <Button isDisabled={busy || !available} onPress={() => onStart(true)}>Resume previous…</Button>
      <Button isDisabled={busy || !available || needsModel} onPress={() => onStart(false)}>{busy ? "Starting…" : "Start session"}</Button>
    </div>
  </section>;
}
