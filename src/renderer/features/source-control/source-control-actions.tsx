import type { SourceControlAction, SourceControlStatus } from "../../../shared/models";
import { confirmDestructive } from "../../ui/confirm";
import { CommitIcon, FileIcon } from "../../ui/icons";
import { runSourceControlTask } from "./source-control-store";

export const ACTIONS: Record<SourceControlAction, { label: string; running: string }> = {
  sync: { label: "Sync", running: "Syncing…" },
  pull: { label: "Pull", running: "Pulling…" },
  pullRebase: { label: "Pull (Rebase)", running: "Pulling…" },
  push: { label: "Push", running: "Pushing…" },
  fetch: { label: "Fetch", running: "Fetching…" },
  fetchPrune: { label: "Fetch (Prune)", running: "Fetching…" },
  stageAll: { label: "Stage All Changes", running: "Staging…" },
  unstageAll: { label: "Unstage All Changes", running: "Unstaging…" },
  discardAll: { label: "Discard All Changes", running: "Discarding…" },
  undoLastCommit: { label: "Undo Last Commit", running: "Undoing the last commit…" },
  stash: { label: "Stash", running: "Stashing…" },
  stashIncludeUntracked: { label: "Stash (Include Untracked)", running: "Stashing…" },
  continueOperation: { label: "Continue", running: "Continuing…" },
  abortOperation: { label: "Abort", running: "Aborting…" },
};

/** Has a branch and somewhere to send it. */
export function canSendToRemote(status: SourceControlStatus): boolean {
  return Boolean(status.branch && (status.upstream || status.hasRemote));
}

export function isEnabled(status: SourceControlStatus, action: SourceControlAction): boolean {
  const { changes } = status;
  switch (action) {
    case "sync": case "push": return canSendToRemote(status);
    case "pull": case "pullRebase": return Boolean(status.upstream);
    case "fetch": case "fetchPrune": return status.hasRemote;
    case "stageAll": return changes.some((change) => change.unstaged);
    case "unstageAll": return changes.some((change) => change.staged);
    case "discardAll": return changes.some((change) => change.unstaged && change.kind !== "conflicted");
    case "undoLastCommit": return Boolean(status.head) && !status.operation;
    case "stash": return changes.some((change) => change.kind !== "untracked" && change.kind !== "conflicted");
    case "stashIncludeUntracked": return changes.some((change) => change.kind !== "conflicted");
    case "continueOperation": case "abortOperation": return Boolean(status.operation);
  }
}

export function runAction(root: string, action: SourceControlAction): Promise<boolean> {
  return runSourceControlTask(root, ACTIONS[action].running, () => window.workbench.sourceControl.runAction(root, action));
}

/** Runs an action, first asking when it loses work or rewrites something already shared. */
export async function confirmAndRunAction(root: string, status: SourceControlStatus, action: SourceControlAction): Promise<boolean> {
  if (action === "discardAll") {
    const discarded = status.changes.filter((change) => change.unstaged && change.kind !== "conflicted");
    const confirmed = await confirmDestructive({
      title: "Discard all changes?",
      message: "Every file goes back to its last staged or committed version.",
      warning: "Unstaged edits are lost and untracked files are permanently deleted. This can't be undone.",
      subject: { icon: <FileIcon size={16} />, name: `${discarded.length} ${discarded.length === 1 ? "file" : "files"}`, detail: status.branch },
      confirmLabel: "Discard All",
    });
    if (!confirmed) return false;
  }
  if (action === "undoLastCommit" && status.upstream && status.ahead === 0) {
    const confirmed = await confirmDestructive({
      title: "Undo a commit that was already pushed?",
      message: "Its changes come back as staged, and the commit stays on the remote.",
      warning: "This branch will no longer match the remote, and replacing the commit there needs a force push.",
      subject: { icon: <CommitIcon size={16} />, name: status.branch ?? "Current branch", detail: status.upstream },
      confirmLabel: "Undo Commit",
    });
    if (!confirmed) return false;
  }
  return runAction(root, action);
}
