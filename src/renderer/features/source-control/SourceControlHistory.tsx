import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton, Disclosure, DisclosurePanel, GridList, GridListItem, Heading } from "react-aria-components";
import type { SourceControlCommit, SourceControlCommitFile, SourceControlStash, SourceControlStatus } from "../../../shared/models";
import { errorMessage } from "../../core/errors";
import { services } from "../../core/services";
import { confirmDestructive } from "../../ui/confirm";
import { useContextMenu, type ContextAction } from "../../ui/ContextMenu";
import { Button } from "../../ui/controls";
import { ChevronRightIcon, CommitIcon, FileIcon } from "../../ui/icons";
import { CHANGE_LETTERS, relativeTime, runSourceControlTask, useSourceControlActivity } from "./source-control-store";

const PAGE = 50;
/** The most commits the main process returns for one request. */
const MAX_REQUEST = 500;

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <Disclosure className="branch-area" defaultExpanded>
    <Heading className="branch-area-heading">
      <AriaButton slot="trigger" className="branch-area-trigger"><ChevronRightIcon size={11} />{title}{count !== undefined && <span className="count-badge">{count}</span>}</AriaButton>
    </Heading>
    <DisclosurePanel>{children}</DisclosurePanel>
  </Disclosure>;
}

type HistoryRow =
  | { id: string; commit: SourceControlCommit; file?: undefined }
  | { id: string; commit: SourceControlCommit; file: SourceControlCommitFile };

/** Keyed by folder. Reloads when the branch moves, and after anything run from this panel. */
export function SourceControlHistory({ root, status, workspaceId }: { root: string; status: SourceControlStatus; workspaceId: string }) {
  const menu = useContextMenu("Commit actions");
  const revision = useSourceControlActivity((state) => state[root]?.revision ?? 0);
  const busy = useSourceControlActivity((state) => Boolean(state[root]?.running));
  const [commits, setCommits] = useState<SourceControlCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, SourceControlCommitFile[]>>({});
  const loaded = useRef(0);
  const { head, upstream, ahead, behind } = status;

  useEffect(() => {
    if (!head) { setCommits([]); setHasMore(false); loaded.current = 0; return; }
    let active = true;
    // The IPC limit caps one request, so reload what was already shown in pages.
    (async () => {
      const wanted = Math.max(PAGE, loaded.current);
      const all: SourceControlCommit[] = [];
      let more: boolean;
      do {
        const result = await window.workbench.sourceControl.history(root, all.length, Math.min(MAX_REQUEST, wanted - all.length));
        all.push(...result.commits); more = result.hasMore;
        if (!result.commits.length) break;
      } while (all.length < wanted && more);
      return { commits: all, hasMore: more };
    })().then((result) => {
      if (!active) return;
      loaded.current = result.commits.length;
      setCommits(result.commits); setHasMore(result.hasMore); setError("");
    }).catch((caught: unknown) => { if (active) setError(errorMessage(caught)); });
    return () => { active = false; };
  }, [root, head, upstream, ahead, behind, revision]);

  const loadMore = async () => {
    try {
      const result = await window.workbench.sourceControl.history(root, commits.length, PAGE);
      setCommits((current) => {
        const known = new Set(current.map((commit) => commit.id));
        const next = [...current, ...result.commits.filter((commit) => !known.has(commit.id))];
        loaded.current = next.length;
        return next;
      });
      setHasMore(result.hasMore);
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const toggle = async (id: string) => {
    if (expanded[id]) { setExpanded((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))); return; }
    try {
      const files = await window.workbench.sourceControl.commitFiles(root, id);
      setExpanded((current) => ({ ...current, [id]: files }));
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const openFile = (commit: SourceControlCommit, file: SourceControlCommitFile) => void services.commands.execute("sourceControl.openCommitFile", {
    workspaceId, root, commitId: commit.id, shortId: commit.shortId, subject: commit.subject, path: file.path, ...(file.originalPath ? { originalPath: file.originalPath } : {}),
  });
  const rows: HistoryRow[] = commits.flatMap((commit) => [
    { id: `commit:${commit.id}`, commit },
    ...(expanded[commit.id] ?? []).map((file) => ({ id: `file:${commit.id}:${file.path}`, commit, file })),
  ]);
  const commitActions = (commit: SourceControlCommit): ContextAction[] => [
    { id: "copy-id", label: "Copy Commit ID", run: () => navigator.clipboard.writeText(commit.id) },
    { id: "copy-message", label: "Copy Commit Message", run: () => navigator.clipboard.writeText(commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject) },
    ...(status.features.includes("revert") ? [{
      id: "revert", label: "Revert Commit", section: "change", disabled: busy || commit.parents.length !== 1,
      run: () => runSourceControlTask(root, "Reverting…", () => window.workbench.sourceControl.revert(root, commit.id)),
    }] : []),
  ];
  const rowActions = (key: string) => {
    const commit = commits.find((item) => `commit:${item.id}` === key);
    return commit ? commitActions(commit) : [];
  };

  return <Section title="History">
    <div onKeyDown={menu.bind((target) => rowActions(target.closest("[role=row]")?.getAttribute("data-key") ?? "")).onKeyDown}>
      {menu.overlay}
      {error && <p role="alert" className="agent-error">{error}</p>}
      <GridList aria-label="History" className="panel-list" items={rows}
        onAction={(key) => { const row = rows.find((item) => item.id === key); if (!row) return; if (row.file) openFile(row.commit, row.file); else void toggle(row.commit.id); }}
        renderEmptyState={() => <p className="panel-empty">No commits yet.</p>}>
        {(row) => row.file
          ? <GridListItem id={row.id} textValue={row.file.path} className="panel-list-item history-file">
            <FileIcon size={13} />
            <span className="file-tree-name">{row.file.path.split("/").at(-1)}</span>
            <small>{row.file.path.split("/").slice(0, -1).join("/")}</small>
            <span className={`change-letter kind-${row.file.kind}`} title={row.file.kind}>{CHANGE_LETTERS[row.file.kind]}</span>
          </GridListItem>
          : <GridListItem id={row.id} textValue={row.commit.subject} className="panel-list-item history-row" {...menu.bind(() => commitActions(row.commit))}>
            <span className={`history-chevron ${expanded[row.commit.id] ? "is-open" : ""}`}><ChevronRightIcon size={11} /></span>
            <div className="history-text" title={row.commit.body ? `${row.commit.subject}\n\n${row.commit.body}` : row.commit.subject}>
              <span className="history-subject">{row.commit.subject}</span>
              <span className="history-meta">{row.commit.shortId} · {row.commit.author} · {relativeTime(row.commit.date)}</span>
              {row.commit.refs.length > 0 && <span className="history-refs">{row.commit.refs.map((ref) => <span key={ref} className="history-ref">{ref}</span>)}</span>}
            </div>
            {menu.overflow(commitActions(row.commit), row.commit.shortId)}
          </GridListItem>}
      </GridList>
      {hasMore && <Button className="history-more" onPress={() => void loadMore()}>Load more</Button>}
    </div>
  </Section>;
}

/** Hidden when there are none. A stash belongs to the whole repository, so one made in another worktree shows here too. */
export function SourceControlStashes({ root, status }: { root: string; status: SourceControlStatus }) {
  const menu = useContextMenu("Stash actions");
  const revision = useSourceControlActivity((state) => state[root]?.revision ?? 0);
  const busy = useSourceControlActivity((state) => Boolean(state[root]?.running));
  const [stashes, setStashes] = useState<SourceControlStash[]>([]);
  const changes = status.changes.length;

  useEffect(() => {
    let active = true;
    window.workbench.sourceControl.stashes(root).then((items) => { if (active) setStashes(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [root, status.head, changes, revision]);

  const act = (action: "apply" | "pop" | "drop", stash: SourceControlStash, label: string) => runSourceControlTask(root, label, () => window.workbench.sourceControl.stashAction(root, action, stash.id));
  const stashActions = (stash: SourceControlStash): ContextAction[] => [
    { id: "apply", label: "Apply Stash", disabled: busy, run: () => act("apply", stash, "Applying the stash…") },
    { id: "pop", label: "Pop Stash", disabled: busy, run: () => act("pop", stash, "Popping the stash…") },
    { id: "drop", label: "Drop Stash", section: "remove", destructive: true, disabled: busy, run: async () => {
      const confirmed = await confirmDestructive({
        title: "Drop this stash?", message: "It is removed from the repository's stash list.", warning: "The stashed changes are lost.",
        subject: { icon: <CommitIcon size={16} />, name: stash.message }, confirmLabel: "Drop Stash",
      });
      if (confirmed) await act("drop", stash, "Dropping the stash…");
    } },
  ];
  if (!stashes.length) return null;
  return <Section title="Stashes" count={stashes.length}>
    {menu.overlay}
    <GridList aria-label="Stashes" className="panel-list" items={stashes} onAction={() => undefined}>
      {(stash) => <GridListItem id={stash.id} textValue={stash.message} className="panel-list-item" {...menu.bind(() => stashActions(stash))}>
        <CommitIcon size={14} />
        <span className="file-tree-name" title={stash.message}>{stash.message}</span>
        <small>{relativeTime(stash.date)}</small>
        {menu.overflow(stashActions(stash), stash.message)}
      </GridListItem>}
    </GridList>
  </Section>;
}
