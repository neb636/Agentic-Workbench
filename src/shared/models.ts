import type { FileOperation, FileOperationResult, FileOperationProgress } from "./file-operations";
import type { PromptOptionDefinition, PromptSelections } from "./prompt-options";
import type { AiUsageApi } from "./ai-usage";

export type ViewType = string;

export interface WorkbenchView {
  id: string;
  type: ViewType;
  workspaceId: string;
  title: string;
  state?: unknown;
}

export interface Workspace {
  id: string;
  name: string;
  /** The folder; empty for the Files workspace, which has none. */
  path: string;
  /**
   * "files": the built-in Files workspace, holding single files opened from outside every workspace (Finder, ⌘O).
   * It has no folder, so only file views live in it. Missing means an ordinary folder workspace.
   */
  kind?: "folder" | "files";
  /** A PNG data URL shown instead of the folder icon. */
  icon?: string;
  /** Global or shared instructions the person turned off in this workspace. */
  disabledInstructionIds?: string[];
  views: WorkbenchView[];
  activeViewId?: string;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  instructions: string;
  scope: "global" | "workspace";
  workspaceId?: string;
}

export interface PromptContribution {
  id: string;
  source: string;
  kind: "persona" | "instruction" | "context" | "attachment";
  content: string;
  enabled: boolean;
  /** Defaults to "prepend": before the user's prompt. */
  placement?: "prepend" | "append";
}

/** A user-managed Instructions option. */
export interface StoredPromptOption {
  scope: "global" | "workspace";
  workspaceId?: string;
  option: PromptOptionDefinition;
}

export interface LayoutState {
  leftSize?: number;
  rightSize?: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  rightPanel?: string;
}

export interface PersistedState {
  workspaces: Workspace[];
  activeWorkspaceId?: string;
  personas: Persona[];
  instructionOptions: StoredPromptOption[];
  /** Default instructions already added once, so a deleted default stays deleted. */
  seededInstructionIds?: string[];
  layout: LayoutState;
  /** The CLI that runs built-in AI actions. Unset: the first one installed. */
  defaultAgentProviderId?: string;
  /** Each self-contained feature's own settings, by feature id. The feature validates its entry. */
  featureSettings?: Record<string, unknown>;
}

export interface PtyCreateOptions {
  cwd: string;
  cols: number;
  rows: number;
  /** The view the terminal belongs to, so the resource manager can show where it is. */
  viewId?: string;
}

/** `sequence` orders output against an attach snapshot: a window skips what the snapshot already shows. */
export interface PtyDataEvent {
  sessionId: string;
  sequence: number;
  data: string;
}

export interface PtyExitEvent {
  sessionId: string;
  sequence: number;
  exitCode: number;
}

export interface PtySnapshot {
  sessionId: string;
  sequence: number;
  screen: string;
  cols: number;
  rows: number;
  /** Set once the shell has exited. */
  exitCode?: number;
}

export interface AgentSessionStatus {
  lifecycle: "starting" | "alive" | "exited" | "failed";
  activity: "ready" | "working" | "waiting-for-input" | "unknown";
  canSubmit: boolean;
  inputState: "empty" | "draft" | "unavailable";
  reason: string;
  rule: string;
  observedAt: number;
  completed: number;
  /** Turns started since the CLI settled, from the composer or typed in the terminal, interrupted or not. */
  started: number;
  /** The CLI is holding a submitted prompt in its own queue until it can take it. */
  queuedPrompt?: boolean;
  /** Prompts whose Enter could not be confirmed in time, seen taken by the CLI afterwards (its input editor emptied). */
  confirmedDeliveries: number;
  exitCode?: number;
}

/** A model the CLI can be launched with, and the reasoning efforts it accepts. */
export interface AgentModelChoice {
  id: string;
  label: string;
  efforts: string[];
}

/** Model and effort for a new conversation. `effort` is absent for a model with no effort levels. */
export interface AgentModelSettings {
  model: string;
  effort?: string;
}

export interface AgentProviderInfo {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
  resume: boolean;
  capabilities?: { planning: boolean };
  /** Models offered for new conversations; absent when the adapter takes no model setting. */
  models?: AgentModelChoice[];
}

export interface AgentPromptRequest {
  prompt: string;
  intent: "default" | "plan";
}

export interface AgentDeliveryResult {
  outcome: "submitted" | "not-sent" | "uncertain";
  stage: "none" | "mode" | "paste" | "enter" | "unknown";
  message: string;
}

/** A file added to a prompt: stored by the app, and read by the CLI from `path`. */
export interface PromptAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  image: boolean;
}

/** Which earlier conversation a CLI reopens: one by id, the newest in its folder, or whichever the person picks in the CLI. */
export type AgentResume = { kind: "id"; id: string } | { kind: "latest" } | { kind: "pick" };

export interface AgentViewState {
  providerId?: string;
  draft?: string;
  split?: number;
  attachments?: PromptAttachment[];
  intent?: AgentPromptRequest["intent"];
  composerRevision?: number;
  promptSelections?: PromptSelections;
  /** A worktree without a `base` starts from the repository's default branch, resolved when it is created. */
  runIn?: { kind: "checkout" } | { kind: "worktree"; branch: string; base?: Pick<BaseBranch, "ref" | "name"> };
  /** Where the CLI runs once launched; the workspace path unless a worktree was created. */
  cwd?: string;
  /** The title is replaced by the first sent prompt. */
  autoTitle?: boolean;
  composerCollapsed?: boolean;
  /** The conversation to reopen after the app restarts, once something has happened in it (`id` when the CLI lets us name it). Null: none, even if older state suggests one. */
  conversation?: { providerId: string; id?: string } | null;
  /** The composer's model and effort per provider, for new conversations; absent means the CLI's defaults. */
  modelSettings?: Record<string, AgentModelSettings>;
}

export interface FileViewState {
  root: string;
  path: string;
  /** A preview tab (one click in the tree): the next one click replaces it; a double click or an edit keeps it. */
  preview?: boolean;
  /** Showing the changes against `diffBase` instead of plain editing. */
  diff?: boolean;
  diffBase?: DiffBase;
  /** Open at this line (from a path in an agent's output); a new nonce jumps again. */
  line?: number;
  lineNonce?: number;
}

/** A file as one past commit changed it, read-only. */
export interface CommitFileViewState {
  root: string;
  commitId: string;
  shortId: string;
  subject: string;
  path: string;
  originalPath?: string;
  /** Set when a view of the staged contents is opened again, so it reads the index afresh. */
  reloaded?: number;
}

/** What a diff compares with: the last commit, or where this branch left the default branch (what a PR would show). */
export type DiffBase = "head" | "default";

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  /** sha1 of the bytes on disk, for saving only over the version that was opened. */
  hash: string;
}

export type FileWriteResult =
  | { ok: true; hash: string }
  /** The file changed on disk since it was opened: nothing was written; here is what's there now. */
  | { ok: false; disk: FileContent | null };

export interface TerminalViewState { cwd?: string }

export interface SearchOptions {
  directory?: string;
  caseSensitive?: boolean;
  regex?: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  /** Stopped at the match or time limit. */
  limited: boolean;
}

/** An application-menu shortcut that works wherever focus is (a terminal included). */
export type MenuCommand = "quick-open" | "find-in-files";

export interface FilesChangedEvent {
  root: string;
  paths: string[];
}

export interface SourceControlChange {
  path: string;
  originalPath?: string;
  kind: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";
  staged: boolean;
  /** Has working changes not yet staged. A file can be both. */
  unstaged: boolean;
}

/** Whole-repository operations. A provider lists the ones it supports and the panel offers only those. `push` publishes a branch with no upstream. */
export type SourceControlAction =
  | "sync" | "pull" | "pullRebase" | "push" | "fetch" | "fetchPrune"
  | "stageAll" | "unstageAll" | "discardAll" | "undoLastCommit"
  | "stash" | "stashIncludeUntracked" | "continueOperation" | "abortOperation";
/** Optional areas of the panel, present when the provider implements them. */
export type SourceControlFeature = "staging" | "amend" | "branches" | "stashes" | "history" | "revert";
/** A multi-step operation left waiting on the person, usually for conflicts. */
export type SourceControlOperation = "merge" | "rebase" | "cherry-pick" | "revert";
export type SourceControlBranchAction = "create" | "delete" | "merge" | "rebase";
export type SourceControlStashAction = "apply" | "pop" | "drop";

export interface SourceControlCommitOptions {
  /** Record only what is staged; otherwise every working change. */
  stagedOnly?: boolean;
  /** Replace the last commit instead of adding one. */
  amend?: boolean;
}

export interface SourceControlCommit {
  id: string;
  shortId: string;
  subject: string;
  body: string;
  author: string;
  /** Unix seconds. */
  date: number;
  parents: string[];
  /** Branch and tag names pointing here, for display. */
  refs: string[];
}

export interface SourceControlHistory {
  commits: SourceControlCommit[];
  hasMore: boolean;
}

export type SourceControlCommitFile = Pick<SourceControlChange, "path" | "originalPath" | "kind">;

/** One file before and after a commit; null where it didn't exist. */
export interface SourceControlCommitFileContents {
  before: string | null;
  after: string | null;
  binary: boolean;
  truncated: boolean;
}

export interface SourceControlStash {
  id: string;
  message: string;
  /** Unix seconds. */
  date: number;
}

export interface SourceControlStatus {
  providerId: string;
  providerLabel: string;
  root: string;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: SourceControlChange[];
  truncated: boolean;
  /** The current commit; absent before the first one. */
  head?: string;
  /** Somewhere to push and pull from exists. */
  hasRemote: boolean;
  operation?: SourceControlOperation;
  actions: SourceControlAction[];
  features: SourceControlFeature[];
}

/** A branch a new worktree can start from. `ref` is opaque to the renderer; `name` is for display. */
export interface BaseBranch {
  ref: string;
  name: string;
  kind: "remote" | "local";
  /** Unix seconds of the branch's latest commit. */
  updatedAt: number;
  /** Checked out in the workspace itself. */
  current: boolean;
}

export interface BaseBranches {
  /** Most recently updated first. */
  branches: BaseBranch[];
  /** Absent when the repository has no usable default (for example, no commits yet). */
  defaultRef?: string;
}

export interface WorktreeResult {
  path: string;
  branch: string;
}

/** `cpu` is percent of one core; memory is resident bytes. */
export interface ResourceUsage {
  cpu: number;
  memoryBytes: number;
}

export interface SessionResource extends ResourceUsage {
  sessionId: string;
  kind: "terminal" | "agent";
  /** The view that owns it; absent, or not among the open views, for a session nothing shows. */
  viewId?: string;
  /** What runs in it, such as the agent provider's label. */
  label: string;
  pid: number;
  cwd: string;
  exited: boolean;
  /** Recent memory samples, oldest first. */
  history: number[];
}

export interface ResourceSnapshot {
  app: ResourceUsage & { main: ResourceUsage; renderer: ResourceUsage; other: ResourceUsage; history: number[] };
  sessions: SessionResource[];
  total: ResourceUsage;
  collectedAt: number;
}

/** What the status bar shows without opening the resource manager. */
export interface ResourceSummary {
  memoryBytes: number;
  sessions: number;
}

export interface AgentSessionCreateOptions {
  providerId: string;
  workspacePath: string;
  viewId: string;
  cols: number;
  rows: number;
  resume?: AgentResume;
  /** Model and effort for a new conversation; a resumed one keeps what it was saved with. */
  settings?: AgentModelSettings;
}

export type AgentSessionEvent = { sessionId: string; sequence: number } & (
  | { type: "status"; status: AgentSessionStatus }
  | { type: "data"; data: string }
);

export interface AgentSessionSnapshot {
  sessionId: string;
  sequence: number;
  screen: string;
  cols: number;
  rows: number;
  status: AgentSessionStatus;
  /** Set when the CLI runs a conversation with a known id. */
  conversationId?: string;
}

export interface WorkbenchApi {
  platform: NodeJS.Platform;
  aiUsage: AiUsageApi;
  persistence: {
    load: () => Promise<PersistedState>;
    save: (state: PersistedState) => Promise<void>;
    /** Blocks until written, for a window that is closing: the app may exit before an asynchronous save finishes. */
    saveNow: (state: PersistedState) => void;
  };
  workspace: {
    /** `startIn`: the folder the dialog opens on. Only the folder the person picks becomes a workspace root. */
    chooseDirectory: (startIn?: string) => Promise<string | null>;
    /** Asks for a picture and returns it as a small PNG data URL; null if none was chosen or it couldn't be read. */
    chooseIcon: () => Promise<string | null>;
  };
  app: {
    textMenu: () => void;
    storageMaintenance: (prune: boolean) => Promise<number>;
    revokeExecutionTrust: () => Promise<void>;
    /** Returns unsubscribe. */
    onMenuCommand: (listener: (command: MenuCommand) => void) => () => void;
    /** Files the system asked the app to open (Finder, the dock, File ▸ Open File…), as absolute paths. Returns unsubscribe. */
    onOpenFiles: (listener: (paths: string[]) => void) => () => void;
  };
  attachments: {
    /** Stores a file for this view's prompts in a folder the app owns. */
    save: (viewId: string, name: string, bytes: Uint8Array) => Promise<PromptAttachment>;
    /** A small picture of a stored image as a data URL; null when there is nothing to show. */
    thumbnail: (viewId: string, id: string) => Promise<string | null>;
    /** A stored image at full size as a data URL; null when there is nothing to show. */
    image: (viewId: string, id: string) => Promise<string | null>;
  };
  files: {
    onProgress: (listener: (progress: FileOperationProgress) => void) => () => void;
    operate: (operation: FileOperation) => Promise<FileOperationResult>;
    locate: (root: string, path: string) => Promise<string>;
    openExternal: (root: string, path: string) => Promise<void>;
    list: (root: string, path: string) => Promise<FileEntry[]>;
    read: (root: string, path: string) => Promise<FileContent>;
    find: (root: string, query: string) => Promise<string[]>;
    /** Saves text over the version with `expectedHash` (null: a file that must not exist yet). */
    write: (root: string, path: string, content: string, expectedHash: string | null) => Promise<FileWriteResult>;
    /** Searches inside files (through source control), at most 500 matches or 2 s; a new search cancels the last. */
    search: (root: string, query: string, options: SearchOptions) => Promise<SearchResult>;
    /** A picture as a data URL (up to 8 MB). */
    image: (root: string, path: string) => Promise<string>;
    /** Which of these relative paths are files in the root (for clickable paths in terminals). */
    exists: (root: string, paths: string[]) => Promise<string[]>;
    create: (root: string, path: string, kind: "file" | "directory") => Promise<void>;
    rename: (root: string, from: string, to: string) => Promise<void>;
    trash: (root: string, path: string) => Promise<void>;
    reveal: (root: string, path: string) => void;
    watch: (root: string) => void;
    unwatch: (root: string) => void;
    onChanged: (listener: (event: FilesChangedEvent) => void) => () => void;
  };
  sourceControl: {
    detect: (root: string) => Promise<boolean>;
    status: (root: string) => Promise<SourceControlStatus | null>;
    commit: (root: string, message: string, options?: SourceControlCommitOptions) => Promise<{ commitId: string }>;
    runAction: (root: string, action: SourceControlAction) => Promise<void>;
    stage: (root: string, paths: string[]) => Promise<void>;
    unstage: (root: string, paths: string[]) => Promise<void>;
    /** Throws away working changes to these files. Untracked files are deleted. */
    discard: (root: string, paths: string[]) => Promise<void>;
    /** `target` is a new name for `create`, otherwise a `BaseBranch.ref`. */
    branchAction: (root: string, action: SourceControlBranchAction, target: string) => Promise<void>;
    /** Newest first; includes what the upstream has that this branch doesn't. */
    history: (root: string, skip: number, limit: number) => Promise<SourceControlHistory>;
    commitFiles: (root: string, id: string) => Promise<SourceControlCommitFile[]>;
    commitFile: (root: string, id: string, path: string, originalPath?: string) => Promise<SourceControlCommitFileContents>;
    revert: (root: string, id: string) => Promise<void>;
    stashes: (root: string) => Promise<SourceControlStash[]>;
    stashAction: (root: string, action: SourceControlStashAction, id: string) => Promise<void>;
    /** Starts from `base` (a `BaseBranch.ref`), or the current commit without one. */
    createWorktree: (root: string, branch: string, base?: string) => Promise<WorktreeResult>;
    branches: (root: string) => Promise<string[]>;
    /** With `refresh`, first updates from the remote (best effort). */
    baseBranches: (root: string, refresh?: boolean) => Promise<BaseBranches>;
    checkout: (root: string, branch: string) => Promise<void>;
    /** A file's text at the last commit or where this branch left the default branch (null when it didn't exist there). */
    fileAt: (root: string, path: string, base: DiffBase) => Promise<string | null>;
    /** Ignored paths, folded to their top folder, to dim in the file tree. */
    ignored: (root: string) => Promise<string[]>;
    /** Describes the pending changes with a CLI (`providerId`, else the first one installed). Spends the user's tokens. */
    previewCommitMessage: (root: string, stagedOnly?: boolean) => Promise<string>;
    generateCommitMessage: (root: string, providerId?: string, stagedOnly?: boolean) => Promise<string>;
  };
  pty: {
    create: (options: PtyCreateOptions) => Promise<string>;
    attach: (sessionId: string) => Promise<PtySnapshot>;
    input: (sessionId: string, data: string) => void;
    resize: (sessionId: string, cols: number, rows: number) => void;
    terminate: (sessionId: string) => void;
    onData: (listener: (event: PtyDataEvent) => void) => () => void;
    onExit: (listener: (event: PtyExitEvent) => void) => () => void;
  };
  resources: {
    /** Samples every session's process tree and the app's own processes. Costs a process listing: poll only while shown. */
    snapshot: () => Promise<ResourceSnapshot>;
    summary: () => Promise<ResourceSummary>;
    /** Ends a session this window owns, with every process it started. */
    end: (sessionId: string) => Promise<void>;
  };
  agent: {
    providers: () => Promise<AgentProviderInfo[]>;
    onProvidersChanged: (listener: (providers: AgentProviderInfo[]) => void) => () => void;
    create: (options: AgentSessionCreateOptions) => Promise<string>;
    attach: (sessionId: string) => Promise<AgentSessionSnapshot>;
    input: (sessionId: string, data: string) => void;
    resize: (sessionId: string, cols: number, rows: number) => void;
    sendPrompt: (sessionId: string, request: AgentPromptRequest) => Promise<AgentDeliveryResult>;
    interrupt: (sessionId: string) => void;
    terminate: (sessionId: string) => void;
    onEvent: (listener: (event: AgentSessionEvent) => void) => () => void;
  };
}
