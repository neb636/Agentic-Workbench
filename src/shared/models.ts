import type { PromptOptionDefinition, PromptSelections } from "./prompt-options";

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
  path: string;
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
  layout: LayoutState;
}

export interface PtyCreateOptions {
  cwd: string;
  cols: number;
  rows: number;
}

export interface PtyDataEvent {
  sessionId: string;
  data: string;
}

export interface PtyExitEvent {
  sessionId: string;
  exitCode: number;
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
  exitCode?: number;
}

/** A model the CLI can be launched with, and the reasoning efforts it accepts. */
export interface AgentModelChoice {
  id: string;
  label: string;
  efforts: string[];
}

/** Model and effort for a new conversation; omitted, the CLI uses its own defaults. */
export interface AgentModelSettings {
  model: string;
  effort: string;
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

export interface PromptQuotation {
  id: string;
  content: string;
}

/** A file added to a prompt: stored by the app, and read by the CLI from `path`. */
export interface PromptAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  image: boolean;
}

export interface AgentViewState {
  providerId?: string;
  draft?: string;
  split?: number;
  quotations?: PromptQuotation[];
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

export interface SearchOptions {
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

export interface AppMetrics {
  memoryBytes: number;
}

export interface AgentSessionCreateOptions {
  providerId: string;
  workspacePath: string;
  viewId: string;
  cols: number;
  rows: number;
  resume?: boolean;
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
}

export interface WorkbenchApi {
  platform: NodeJS.Platform;
  persistence: {
    load: () => Promise<PersistedState>;
    save: (state: PersistedState) => Promise<void>;
  };
  workspace: {
    chooseDirectory: () => Promise<string | null>;
  };
  app: {
    metrics: () => Promise<AppMetrics>;
    /** Returns unsubscribe. */
    onMenuCommand: (listener: (command: MenuCommand) => void) => () => void;
  };
  attachments: {
    /** Stores a file for this view's prompts in a folder the app owns. */
    save: (viewId: string, name: string, bytes: Uint8Array) => Promise<PromptAttachment>;
    /** A small picture of a stored image as a data URL; null when there is nothing to show. */
    thumbnail: (viewId: string, id: string) => Promise<string | null>;
  };
  files: {
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
    commit: (root: string, message: string) => Promise<{ commitId: string }>;
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
  };
  pty: {
    create: (options: PtyCreateOptions) => Promise<string>;
    input: (sessionId: string, data: string) => void;
    resize: (sessionId: string, cols: number, rows: number) => void;
    terminate: (sessionId: string) => void;
    onData: (listener: (event: PtyDataEvent) => void) => () => void;
    onExit: (listener: (event: PtyExitEvent) => void) => () => void;
  };
  agent: {
    providers: () => Promise<AgentProviderInfo[]>;
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
