import { useContextMenu } from "../../ui/ContextMenu";
import { locationActions } from "../files/file-actions";
import { useChoiceDialog } from "../../ui/ChoiceDialog";
import { useDefaultCli } from "../settings/default-cli";
import { useEffect, useRef, useState, type Key, type ReactNode } from "react";
import {
  Button as AriaButton,
  Dialog,
  Disclosure,
  DisclosurePanel,
  GridList,
  GridListItem,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  Select,
  SelectValue,
  TextArea,
  TextField,
} from "react-aria-components";
import type { SourceControlChange, SourceControlOperation, SourceControlStatus } from "../../../shared/models";
import { errorMessage } from "../../core/errors";
import type { PanelProps } from "../../core/panel-registry";
import { services } from "../../core/services";
import type { WidgetProps } from "../../core/widget-registry";
import { useWorkbenchStore } from "../../state/workbench-store";
import { Button, IconButton } from "../../ui/controls";
import { confirmDestructive } from "../../ui/confirm";
import { ArrowUpIcon, BranchIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, FileIcon, MinusIcon, PlusIcon, RefreshIcon, SparkIcon, UndoIcon } from "../../ui/icons";
import { canSendToRemote, confirmAndRunAction, runAction } from "./source-control-actions";
import { SourceControlMoreMenu, SourceControlToolbar } from "./SourceControlActions";
import { SourceControlHistory, SourceControlStashes } from "./SourceControlHistory";
import { activeRoot, CHANGE_LETTERS, dismissSourceControlError, refreshSourceControl, reloadSourceControl, runSourceControlTask, useSourceControlActivity, useSourceControlStatus } from "./source-control-store";

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Switch the checkout to another branch (only with nothing uncommitted), or open a new worktree as a workspace. */
function BranchSwitcher({ root, current, changes }: { root: string; current?: string; changes: number }) {
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    window.workbench.sourceControl.branches(root).then((items) => { if (active) setBranches(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [root, current]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); await refreshSourceControl(root); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };
  const checkout = () => run(async () => { if (branch) await window.workbench.sourceControl.checkout(root, branch); setBranch(null); });
  const worktree = () => run(async () => {
    const result = await window.workbench.sourceControl.createWorktree(root, newBranch.trim());
    useWorkbenchStore.getState().addWorkspace(result.path);
    setNewBranch("");
  });
  return <Disclosure className="branch-area">
    <Heading className="branch-area-heading">
      <AriaButton slot="trigger" className="branch-area-trigger"><ChevronRightIcon size={11} />Switch branch or open a worktree</AriaButton>
    </Heading>
    <DisclosurePanel className="branch-area-panel">
      <Select className="branch-select" placeholder="Choose a branch…" selectedKey={branch} onSelectionChange={(key) => setBranch(key === null ? null : String(key))}>
        <Label>Branch</Label>
        <AriaButton className="select-trigger"><SelectValue /><ChevronDownIcon size={14} /></AriaButton>
        <Popover className="wb-popover branch-popover">
          <ListBox items={branches.map((name) => ({ id: name }))}>{(item) => <ListBoxItem id={item.id}>{item.id}</ListBoxItem>}</ListBox>
        </Popover>
      </Select>
      <Button isDisabled={!branch || busy || branch === current || changes > 0} onPress={() => void checkout()}>Switch branch</Button>
      {changes > 0 && <p className="panel-note">Commit your changes or open a worktree to switch branches.</p>}
      <TextField value={newBranch} onChange={setNewBranch} className="branch-field">
        <Label>New worktree branch</Label>
        <Input placeholder="feature/name" />
      </TextField>
      <Button isDisabled={!newBranch.trim() || busy} onPress={() => void worktree()}>Open worktree</Button>
      {error && <p role="alert" className="agent-error">{error}</p>}
    </DisclosurePanel>
  </Disclosure>;
}

type CommitMode = "commit" | "push" | "sync" | "amend";

/** Keyed by folder: a draft or a generation in progress belongs to the folder it started in. */
function CommitArea({ root, status }: { root: string; status: SourceControlStatus }) {
  const { current: cli } = useDefaultCli();
  const chosenCli = useWorkbenchStore((state) => state.defaultAgentProviderId);
  const { choose, dialog } = useChoiceDialog();
  const menu = useContextMenu("Commit");
  const busy = useSourceControlActivity((state) => Boolean(state[root]?.running));
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<CommitMode>();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const lastGenerated = useRef("");
  const stagedCount = status.changes.filter((change) => change.staged).length;
  const stagedOnly = stagedCount > 0;
  const count = stagedOnly ? stagedCount : status.changes.length;
  const what = `${count} ${stagedOnly ? "staged " : ""}${count === 1 ? "change" : "changes"}`;
  const branch = status.branch ?? "the current HEAD";
  const pushable = canSendToRemote(status);
  const pushedAlready = Boolean(status.upstream) && status.ahead === 0;
  // Committing now would record the conflict markers.
  const conflicted = status.changes.some((change) => change.kind === "conflicted");
  const ready = Boolean(count && message.trim()) && !busy && !generating && !conflicted;
  const commit = async (mode: CommitMode) => {
    setConfirming(undefined);
    await runSourceControlTask(root, mode === "amend" ? "Amending the last commit…" : "Committing…", async () => {
      await window.workbench.sourceControl.commit(root, message.trim(), { stagedOnly, amend: mode === "amend" });
      setMessage("");
      if (mode === "push" || mode === "sync") await window.workbench.sourceControl.runAction(root, mode);
    });
  };
  const generate = async () => {
    const typedByHand = message.trim() && message !== lastGenerated.current;
    if (typedByHand && await choose("Replace your commit message?", "The generated message will replace what you've typed.", ["Cancel", "Replace"]) !== "Replace") return;
    setGenerating(true); setError("");
    try {
      const generated = await window.workbench.sourceControl.generateCommitMessage(root, chosenCli, stagedOnly);
      lastGenerated.current = generated;
      setMessage(generated);
    } catch (e) { setError(errorMessage(e)); }
    finally { setGenerating(false); }
  };
  const moreActions = [
    ...(status.actions.includes("push") ? [{ id: "push", label: status.upstream ? "Commit & Push" : "Commit & Publish", disabled: !ready || !pushable, run: () => setConfirming("push") }] : []),
    ...(status.actions.includes("sync") && status.upstream ? [{ id: "sync", label: "Commit & Sync", disabled: !ready || !pushable, run: () => setConfirming("sync") }] : []),
    ...(status.features.includes("amend") ? [{ id: "amend", label: "Amend Last Commit", section: "amend", disabled: !status.head || !message.trim() || busy || generating || conflicted, run: () => setConfirming("amend") }] : []),
  ];
  const showSync = !count && !status.operation && pushable && status.actions.includes("sync") && (!status.upstream || status.ahead > 0 || status.behind > 0);
  return <div className="commit-area">
    {dialog}
    {menu.overlay}
    <div className="commit-input">
      <TextField aria-label="Commit message" value={message} onChange={setMessage} isReadOnly={generating}>
        <TextArea placeholder={generating ? "Generating commit message…" : "Commit message"} rows={3} />
      </TextField>
      <IconButton className={`commit-generate ${generating ? "is-generating" : ""}`} label={cli ? `Generate commit message with ${cli.label}` : "Generate commit message"} isDisabled={!count || generating || busy} onPress={() => void generate()}><SparkIcon size={14} /></IconButton>
    </div>
    <div className="commit-row">
      <Button className="commit-button" isDisabled={!ready} onPress={() => setConfirming("commit")}><CheckIcon size={13} />Commit {what}</Button>
      {moreActions.length > 0 && menu.overflow(moreActions, "More commit", "wb-icon-button commit-more")}
    </div>
    {showSync && <Button className="commit-button" isDisabled={busy} onPress={() => void runAction(root, "sync")}>
      {status.upstream ? <><RefreshIcon size={13} />Sync Changes ↓{status.behind} ↑{status.ahead}</> : <><ArrowUpIcon size={13} />Publish Branch</>}
    </Button>}
    <ModalOverlay className="wb-modal-overlay" isDismissable isOpen={Boolean(confirming)} onOpenChange={(open) => { if (!open) setConfirming(undefined); }}>
      <Modal className="wb-modal wb-alert">
        <Dialog role="alertdialog" className="wb-dialog">
          <Heading slot="title">{confirming === "amend" ? "Amend the last commit?" : `Commit ${what}?`}</Heading>
          {confirming === "amend"
            ? <p>The last commit on <strong>{branch}</strong> is replaced with this message{count ? ` and ${what}` : ""}.{pushedAlready ? " It has already been pushed, so publishing the new one will need a force push." : ""}</p>
            : stagedOnly
              ? <p>The staged changes in <code>{folderName(root)}</code> will be committed to <strong>{branch}</strong>. Anything not staged stays as it is.</p>
              : <p>Every change in <code>{folderName(root)}</code>, including untracked files, will be committed to <strong>{branch}</strong>.</p>}
          <div className="dialog-actions"><Button onPress={() => setConfirming(undefined)}>Cancel</Button><Button className="primary-button" isDisabled={busy} onPress={() => { if (confirming) void commit(confirming); }}>{confirming === "amend" ? "Amend" : confirming === "push" ? "Commit & Push" : confirming === "sync" ? "Commit & Sync" : "Commit"}</Button></div>
        </Dialog>
      </Modal>
    </ModalOverlay>
    {error && <p role="alert" className="agent-error">{error}</p>}
  </div>;
}

const OPERATION_LABELS: Record<SourceControlOperation, string> = { merge: "Merge", rebase: "Rebase", "cherry-pick": "Cherry-pick", revert: "Revert" };

function ChangeRowButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return <AriaButton className="row-action" aria-label={label} onPress={onPress}>{children}</AriaButton>;
}

export function SourceControlPanel({ workspace }: PanelProps) {
  const menu = useContextMenu("Changed file actions");
  const root = activeRoot(workspace);
  const entry = useSourceControlStatus(root, true);
  const activity = useSourceControlActivity((state) => state[root]);
  const status = entry?.status;
  const count = status?.changes.length ?? 0;
  const busy = Boolean(activity?.running);
  const staging = Boolean(status?.features.includes("staging"));
  const staged = staging ? status?.changes.filter((change) => change.staged) ?? [] : [];
  const unstaged = staging ? status?.changes.filter((change) => change.unstaged) ?? [] : status?.changes ?? [];
  const stage = (path: string) => void runSourceControlTask(root, "Staging…", () => window.workbench.sourceControl.stage(root, [path]));
  const unstage = (path: string) => void runSourceControlTask(root, "Unstaging…", () => window.workbench.sourceControl.unstage(root, [path]));
  const discard = async (change: SourceControlChange) => {
    const untracked = change.kind === "untracked";
    const confirmed = await confirmDestructive({
      title: untracked ? "Delete this file?" : "Discard these changes?",
      message: untracked ? "This file has never been committed." : "The file goes back to its last staged or committed version.",
      warning: untracked ? "The file is permanently deleted and can't be restored." : "Your unstaged edits to this file are lost and can't be restored.",
      subject: { icon: <FileIcon size={16} />, name: change.path.split("/").at(-1) ?? change.path, meta: change.path },
      confirmLabel: untracked ? "Delete File" : "Discard Changes",
    });
    if (confirmed) await runSourceControlTask(root, "Discarding…", () => window.workbench.sourceControl.discard(root, [change.path]));
  };
  const changeActions = (path: string) => {
    const change = status?.changes.find((c) => c.path === path);
    return change ? [
      { id: "changes", label: "Open Changes", disabled: change.kind === "deleted", run: () => services.commands.execute("file.open", { workspaceId: workspace.id, root, path, diff: true, preview: false }) },
      ...(staging ? [
        ...(change.unstaged ? [{ id: "stage", label: "Stage", section: "staging", disabled: busy, run: () => stage(path) }] : []),
        ...(change.staged ? [{ id: "unstage", label: "Unstage", section: "staging", disabled: busy, run: () => unstage(path) }] : []),
        ...(change.unstaged && change.kind !== "conflicted" ? [{ id: "discard", label: "Discard Changes", section: "staging", destructive: true, disabled: busy, run: () => discard(change) }] : []),
      ] : []),
      ...locationActions(workspace, { root, path }, false, change.kind !== "deleted"),
    ] : [];
  };
  const openChange = (key: Key, group: "staged" | "unstaged") => {
    const change = status?.changes.find((c) => c.path === key);
    if (change?.kind === "deleted") return;
    // What will be committed is the index, which the editor never shows, so staged rows open a read-only HEAD-to-index diff.
    if (group === "staged" && change?.staged && !(change.unstaged && change.kind === "conflicted")) {
      void services.commands.execute("sourceControl.openCommitFile", {
        workspaceId: workspace.id, root, commitId: "index", shortId: "staged", subject: "Staged changes", path: String(key), ...(change.originalPath ? { originalPath: change.originalPath } : {}),
      });
      return;
    }
    void services.commands.execute("file.open", { workspaceId: workspace.id, root, path: String(key), diff: true, preview: true });
  };
  const changeRow = (change: SourceControlChange & { id: string }, group: "staged" | "unstaged") => <GridListItem id={change.id} textValue={change.path} className="panel-list-item" {...menu.bind(() => changeActions(change.path))}>
    <FileIcon size={14} />
    <span className="file-tree-name">{change.path.split("/").at(-1)}</span>
    <small>{change.path.split("/").slice(0, -1).join("/")}</small>
    {staging && !busy && (group === "staged"
      ? <ChangeRowButton label={`Unstage ${change.path}`} onPress={() => unstage(change.path)}><MinusIcon size={13} /></ChangeRowButton>
      : <>
        {change.kind !== "conflicted" && <ChangeRowButton label={`Discard ${change.path}`} onPress={() => void discard(change)}><UndoIcon size={13} /></ChangeRowButton>}
        <ChangeRowButton label={`Stage ${change.path}`} onPress={() => stage(change.path)}><PlusIcon size={13} /></ChangeRowButton>
      </>)}
    <span className={`change-letter kind-${change.kind}`} title={`${change.kind}${change.staged ? ", staged" : ""}`}>{CHANGE_LETTERS[change.kind]}</span>
    {menu.overflow(changeActions(change.path), change.path)}
  </GridListItem>;

  return <div className="side-panel source-control-panel" onKeyDown={menu.bind((target) => changeActions(target.closest("[role=row]")?.getAttribute("data-key") ?? "")).onKeyDown}>
    {menu.overlay}
    <div className="side-panel-header">
      <h2>{folderName(root)}</h2>
      <div className="side-panel-actions">
        {status && <SourceControlToolbar root={root} status={status} />}
        <IconButton label="Refresh changes" onPress={() => reloadSourceControl(root)}><RefreshIcon size={14} /></IconButton>
        {status && <SourceControlMoreMenu root={root} status={status} />}
      </div>
    </div>
    {status === null ? <p className="panel-empty">This folder is not under source control.</p> : !status ? <p className="panel-empty">{entry?.error ?? "Reading changes…"}</p> : <>
      <div className="branch-row">
        <BranchIcon size={14} /><span className="branch-name">{status.branch ?? "Detached HEAD"}</span>
        {(status.ahead > 0 || status.behind > 0) && <small>↑{status.ahead} ↓{status.behind}</small>}
        <small className="branch-provider">{status.providerLabel}</small>
      </div>
      {activity?.running && <p className="panel-note" role="status">{activity.running}</p>}
      {activity?.error && <div role="alert" className="source-control-error">
        <p className="agent-error">{activity.error}</p>
        <IconButton label="Dismiss error" onPress={() => dismissSourceControlError(root)}><CloseIcon size={12} /></IconButton>
      </div>}
      {status.operation && <div className="source-control-operation" role="status">
        <p>{OPERATION_LABELS[status.operation]} in progress. Resolve any conflicts and stage them, then continue.</p>
        <div>
          <Button isDisabled={busy} onPress={() => void runAction(root, "continueOperation")}>Continue</Button>
          <Button isDisabled={busy} onPress={() => void runAction(root, "abortOperation")}>Abort</Button>
        </div>
      </div>}
      <BranchSwitcher root={root} current={status.branch} changes={count} />
      <CommitArea key={root} root={root} status={status} />
      {staged.length > 0 && <>
        <div className="panel-section-header"><Label>Staged Changes</Label><span className="panel-section-actions">
          <IconButton label="Unstage all changes" isDisabled={busy} onPress={() => void runAction(root, "unstageAll")}><MinusIcon size={13} /></IconButton>
          <span className="count-badge">{staged.length}</span>
        </span></div>
        <GridList aria-label="Staged changes" className="panel-list change-list" items={staged.map((change) => ({ ...change, id: change.path }))} onAction={(key) => openChange(key, "staged")}>
          {(change) => changeRow(change, "staged")}
        </GridList>
      </>}
      {(unstaged.length > 0 || staged.length === 0) && <>
        <div className="panel-section-header"><Label>Changes</Label><span className="panel-section-actions">
          {staging && unstaged.length > 0 && <>
            <IconButton label="Discard all changes" isDisabled={busy} onPress={() => void confirmAndRunAction(root, status, "discardAll")}><UndoIcon size={13} /></IconButton>
            <IconButton label="Stage all changes" isDisabled={busy} onPress={() => void runAction(root, "stageAll")}><PlusIcon size={13} /></IconButton>
          </>}
          <span className="count-badge">{unstaged.length}{status.truncated ? "+" : ""}</span>
        </span></div>
        <GridList aria-label="Changes" className="panel-list change-list" items={unstaged.map((change) => ({ ...change, id: change.path }))} onAction={(key) => openChange(key, "unstaged")}
          renderEmptyState={() => <p className="panel-empty">No uncommitted changes.</p>}>
          {(change) => changeRow(change, "unstaged")}
        </GridList>
      </>}
      {status.features.includes("stashes") && <SourceControlStashes key={`stashes-${root}`} root={root} status={status} />}
      {status.features.includes("history") && <SourceControlHistory key={`history-${root}`} root={root} status={status} workspaceId={workspace.id} />}
    </>}
  </div>;
}

/** How many files changed, on the Source control activity button. */
export function SourceControlBadge({ workspace }: PanelProps) {
  const count = useSourceControlStatus(activeRoot(workspace), false)?.status?.changes.length ?? 0;
  return count > 0 ? <span className="activity-badge" aria-label={`${count} changed`}>{count > 99 ? "99+" : count}</span> : null;
}

/** Branch name for a workspace row in the sidebar. */
export function WorkspaceBranch({ workspaceId }: WidgetProps) {
  const path = useWorkbenchStore((state) => state.workspaces.find((item) => item.id === workspaceId)?.path);
  const branch = useSourceControlStatus(path, false)?.status?.branch;
  return branch ? <span className="workspace-branch">{branch}</span> : null;
}

/** Branch of the active view's folder in the status bar. */
export function StatusBranch() {
  const workspace = useWorkbenchStore((state) => state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? state.workspaces[0]);
  const status = useSourceControlStatus(workspace ? activeRoot(workspace) : undefined, true)?.status;
  if (!status) return null;
  return <span className="status-item"><BranchIcon size={12} />{status.branch ?? "detached"}{status.changes.length > 0 && <span className="status-muted">· {status.changes.length} changed</span>}</span>;
}
