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
  /** The game pane for this piece of work: where it is, which lab is on, which device frame. */
  game?: GameState;
}

export type GameLab = "camera" | "feel" | "character";
export type GameFrame = "fit" | "ipad-portrait" | "ipad-wide" | "iphone-wide" | "iphone-tall";

export interface GameState {
  /** The game's hash (`#/world/...`), kept up to date from what the game reports. */
  link?: string;
  frame?: GameFrame;
  /** Where the Character lab was, so its toggle returns there. */
  characterLink?: string;
  /** The section to go back to when the Character lab is switched off. */
  beforeCharacter?: string;
  /** The lab panel's note and AI provider. */
  draft?: string;
  provider?: "claude" | "codex";
}

/** A `game` tab: the one game of its piece of work, with a lab (or none). Every game tab shares one running frame. */
export interface GameViewState {
  lab?: GameLab;
}

export type ExplorerTab = "files" | "changes" | "sections" | "ship";

export interface ExplorerLayout {
  collapsed?: boolean;
  size?: number;
  tab?: ExplorerTab;
}

/** One section link of the game, from `scripts/sections-index.mjs` in that checkout. */
export interface SectionEntry {
  id: string;
  name: string;
  group?: string;
  link: string;
  links: { label: string; link: string }[];
}

export interface SectionsIndex {
  version: 1;
  places: {
    id: string;
    name: string;
    emoji: string;
    activities: { id: string; name: string; icon: string; kind: "hub" | "live" | "works" | "finale"; sections: SectionEntry[] }[];
  }[];
  /** Why there are no sections for this checkout (an older branch, no npm ci). */
  missing?: string;
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
  /** The Ship panel under the agent is folded away. */
  shipCollapsed?: boolean;
  /** The right sidebar: Files, Changes, Sections and Ship. */
  explorer?: ExplorerLayout;
  /** The CLI a new agent tab starts with (the last one used). */
  lastAgentProvider?: string;
}

export interface PersistedState {
  /** The one Gamepack checkout (the main worktree). Every workspace is this repo or one of its worktrees. */
  repoRoot?: string;
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
  exitCode?: number;
}

export interface AgentProviderInfo {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
  resume: boolean;
  capabilities?: { planning: boolean };
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
  /** What the chip says; terminal selections leave it out. */
  label?: string;
}

export interface AgentViewState {
  providerId?: string;
  draft?: string;
  split?: number;
  quotations?: PromptQuotation[];
  intent?: AgentPromptRequest["intent"];
  modelSettings?: Record<string, import("./agent-models").AgentModelSettings>;
  composerRevision?: number;
  promptSelections?: PromptSelections;
  runIn?: { kind: "checkout" } | { kind: "worktree"; branch: string };
  /** Where the CLI runs once launched; the workspace path unless a worktree was created. */
  cwd?: string;
  /** The title is replaced by the first sent prompt. */
  autoTitle?: boolean;
  composerCollapsed?: boolean;
  /** A new tab: its CLI starts as soon as it's shown (the last-used one unless `providerId` says). */
  autoStart?: boolean;
  /** Start by resuming a previous session (the CLI's own picker). */
  resume?: boolean;
}

export interface ImageAttachment {
  id: string;
  /** The name shown to the user, such as the original file name. */
  name: string;
  /** Relative to the view's image folder. */
  file: string;
}

export interface ImageRun {
  id: string;
  createdAt: number;
  prompt: string;
  /** Source images copied into the run folder, in attachment order. */
  sources: { file: string; name: string }[];
  count: number;
  /** Variant index the user picked. */
  chosen?: number;
  /** Set when the orchestration prompt was not handed to the agent. */
  error?: string;
}

export interface ImageGeneratorViewState {
  providerId?: string;
  draft?: string;
  attachments?: ImageAttachment[];
  runs?: ImageRun[];
  count?: number;
  agentOpen?: boolean;
  autoTitle?: boolean;
}

/** Written by the agent into each run folder. */
export interface ImageRunManifest {
  complete: boolean;
  variants: {
    index: number;
    title: string;
    prompt: string;
    sources: string[];
    changes: string;
    status: "pending" | "done" | "failed";
    error?: string;
  }[];
}

export interface ImageRunSnapshot {
  files: { name: string; size: number; modifiedAt: number }[];
  manifest?: ImageRunManifest;
  manifestError?: string;
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

/** What a diff compares with: the last commit, or where this branch left main (what the PR will show). */
export type DiffBase = "head" | "main";

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

export interface PullRequestInfo {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  title: string;
  url: string;
  isDraft: boolean;
  headSha?: string;
  checks?: "passing" | "failing" | "pending";
}

/** One piece of work: the main checkout or a worktree, with its branch and PR. */
export interface WorkItemInfo {
  path: string;
  name: string;
  branch?: string;
  head?: string;
  main: boolean;
  /** Git still lists it, but the folder is gone. */
  missing: boolean;
  locked: boolean;
  changes?: number;
  pr?: PullRequestInfo;
  install?: "installing" | "failed";
  installMessage?: string;
  /** No node_modules: the game can't start until npm ci runs. */
  dependencies?: "missing";
}

export interface WorkList {
  repoRoot: string;
  items: WorkItemInfo[];
  github: "ok" | "unavailable";
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
  /** A main-process launch profile granting the session extra permissions. */
  profile?: string;
  /** Model and effort for a new conversation; a resumed one keeps its own. */
  settings?: import("./agent-models").AgentModelSettings;
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

export type MenuCommand = "game" | "explorer" | "quick-open" | "find-in-files";

export interface WorkbenchApi {
  studio: {
    copyText: (text: string) => Promise<void>;
    repoRoot: () => Promise<string | null>;
    /** Starts (or reuses) this checkout's game server and returns its origin. */
    useCheckout: (root: string) => Promise<string>;
    sections: (root: string, refresh?: boolean) => Promise<SectionsIndex>;
    /** Stops all but the `keep` most recently used game servers. */
    /** Stops all but `keep` game servers; `root` (the one on screen) is kept first. */
    trimServers: (keep: number, root?: string) => Promise<void>;
    tune: (input: { id: string; provider: 'claude' | 'codex'; prompt: string; snapshot: import('./labs').LabSnapshot }) => Promise<import('./labs').LabProposal>;
    cancel: (id: string) => void;
    /**
     * A menu shortcut anywhere in the window (also inside the game frame, which keeps its own key events): ⌘G the game,
     * ⌘⌥B the explorer, ⌘P go to file, ⇧⌘F find in files. Returns unsubscribe.
     */
    onMenu: (listener: (command: MenuCommand) => void) => () => void;
  };
  work: {
    list: (root: string, refresh?: boolean) => Promise<WorkList>;
    create: (root: string, name: string) => Promise<WorktreeResult>;
    remove: (root: string, path: string) => Promise<void>;
    /** npm ci (or a clone of main's node_modules) in a worktree without dependencies. */
    install: (root: string, path: string) => Promise<void>;
  };
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
    badge: (count: number) => void;
  };
  files: {
    list: (root: string, path: string) => Promise<FileEntry[]>;
    read: (root: string, path: string) => Promise<FileContent>;
    find: (root: string, query: string) => Promise<string[]>;
    /** Saves text over the version with `expectedHash` (null: a file that must not exist yet). */
    write: (root: string, path: string, content: string, expectedHash: string | null) => Promise<FileWriteResult>;
    /** Searches inside files (`git grep`), at most 500 matches or 2 s; a new search cancels the last. */
    search: (root: string, query: string, options: { caseSensitive?: boolean; regex?: boolean }) => Promise<SearchResult>;
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
    branches: (root: string) => Promise<string[]>;
    checkout: (root: string, branch: string) => Promise<void>;
    detect: (root: string) => Promise<boolean>;
    status: (root: string) => Promise<SourceControlStatus | null>;
    commit: (root: string, message: string) => Promise<{ commitId: string }>;
    createWorktree: (root: string, branch: string) => Promise<WorktreeResult>;
    /** A file's text at the last commit or at the merge base with origin/main (null when it didn't exist there). */
    fileAt: (root: string, path: string, base: DiffBase) => Promise<string | null>;
    /** Ignored folders and files at the top of what git ignores (build output, node_modules), to dim in the tree. */
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
  images: {
    /** The view's image folder, created on first use. */
    folder: (viewId: string) => Promise<string>;
    importData: (viewId: string, name: string, data: Uint8Array) => Promise<ImageAttachment>;
    prepareRun: (viewId: string, runId: string, attachments: string[]) => Promise<{ dir: string; sources: string[] }>;
    inspectRun: (viewId: string, runId: string) => Promise<ImageRunSnapshot>;
    /** A data URL for an image inside the view's folder. */
    read: (viewId: string, file: string) => Promise<string>;
    reveal: (viewId: string, file: string) => void;
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
