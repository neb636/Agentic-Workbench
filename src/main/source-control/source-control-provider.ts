import path from "node:path";
import type {
  BaseBranches, DiffBase, SearchOptions, SearchResult, SourceControlAction, SourceControlBranchAction, SourceControlCommitFile, SourceControlCommitFileContents,
  SourceControlCommitOptions, SourceControlFeature, SourceControlHistory, SourceControlStash, SourceControlStashAction, SourceControlStatus, WorktreeResult,
} from "../../shared/models";
import { worktreeContainer } from "../workspace-files";

export type ProviderStatus = Omit<SourceControlStatus, "providerId" | "providerLabel" | "root" | "actions" | "features">;

/** What the next commit would contain, sized to describe to a model. */
export interface PendingChanges {
  /** Which files changed and by how much; empty when nothing did. */
  summary: string;
  diff: string;
  truncated: boolean;
}

/** A version-control system behind a narrow, fixed set of operations. */
export interface SourceControlProvider {
  id: string;
  label: string;
  detect: (root: string) => Promise<boolean>;
  status: (root: string) => Promise<ProviderStatus>;
  /** Records every working change in one commit, or only what is staged with `stagedOnly`. */
  commit: (root: string, message: string, options?: Pick<SourceControlCommitOptions, "stagedOnly">) => Promise<{ commitId: string }>;
  /** Replaces the last commit, taking the same changes `commit` would. */
  amend?: (root: string, message: string, options?: Pick<SourceControlCommitOptions, "stagedOnly">) => Promise<{ commitId: string }>;
  /** What `run` accepts. */
  actions?: readonly SourceControlAction[];
  run?: (root: string, action: SourceControlAction) => Promise<void>;
  /** Paths are as `status` reports them. */
  stage?: (root: string, paths: string[]) => Promise<void>;
  unstage?: (root: string, paths: string[]) => Promise<void>;
  discard?: (root: string, paths: string[]) => Promise<void>;
  /** `target` is a new branch name for `create`, otherwise a ref from `baseBranches`. */
  branchAction?: (root: string, action: SourceControlBranchAction, target: string) => Promise<void>;
  history?: (root: string, skip: number, limit: number) => Promise<SourceControlHistory>;
  commitFiles?: (root: string, id: string) => Promise<SourceControlCommitFile[]>;
  commitFile?: (root: string, id: string, path: string, originalPath?: string) => Promise<SourceControlCommitFileContents>;
  /** Adds a commit that undoes `id`. */
  revert?: (root: string, id: string) => Promise<void>;
  stashes?: (root: string) => Promise<SourceControlStash[]>;
  stashAction?: (root: string, action: SourceControlStashAction, id: string) => Promise<void>;
  /** Starts from `base` (a ref from `baseBranches`), or the current commit without one. */
  createWorktree: (root: string, branch: string, target: string, base?: string) => Promise<WorktreeResult>;
  branches: (root: string) => Promise<string[]>;
  /** Every branch a worktree can start from and which is the default; `refresh` first updates from the remote, best effort. */
  baseBranches: (root: string, refresh?: boolean) => Promise<BaseBranches>;
  /** Switches the checkout to a branch; refuses while there are uncommitted changes. */
  checkout: (root: string, branch: string) => Promise<void>;
  /** A file's text at the last commit or where this branch left the default branch; null when it didn't exist there. */
  fileAt?: (root: string, path: string, base: DiffBase) => Promise<string | null>;
  /** Describes everything `commit` would record with the same `stagedOnly`, without changing the repository. */
  pendingChanges?: (root: string, stagedOnly?: boolean) => Promise<PendingChanges>;
  /** Paths the system ignores (folded to their top folder), to dim in the file tree. */
  ignored?: (root: string) => Promise<string[]>;
  /** Text search inside the files the system knows about (tracked and untracked, not ignored). */
  search?: (root: string, query: string, options: SearchOptions) => Promise<SearchResult>;
}

const unsupported = (provider: SourceControlProvider) => new Error(`${provider.label} doesn't support that here.`);

export class SourceControlService {
  private readonly detected = new Map<string, SourceControlProvider | null>();

  constructor(private readonly providers: SourceControlProvider[]) {}

  async providerFor(root: string): Promise<SourceControlProvider | undefined> {
    if (!this.detected.has(root)) {
      let found: SourceControlProvider | null = null;
      for (const provider of this.providers) {
        if (await provider.detect(root).catch(() => false)) { found = provider; break; }
      }
      this.detected.set(root, found);
    }
    return this.detected.get(root) ?? undefined;
  }

  async status(root: string): Promise<SourceControlStatus | null> {
    const provider = await this.providerFor(root);
    if (!provider) return null;
    const features: SourceControlFeature[] = [];
    if (provider.stage) features.push("staging");
    if (provider.amend) features.push("amend");
    if (provider.branchAction) features.push("branches");
    if (provider.stashes) features.push("stashes");
    if (provider.history) features.push("history");
    if (provider.revert) features.push("revert");
    return { ...(await provider.status(root)), providerId: provider.id, providerLabel: provider.label, root, actions: [...(provider.actions ?? [])], features };
  }

  async commit(root: string, message: string, { amend, ...options }: SourceControlCommitOptions = {}): Promise<{ commitId: string }> {
    const provider = await this.require(root);
    if (!amend) return provider.commit(root, message, options);
    if (!provider.amend) throw unsupported(provider);
    return provider.amend(root, message, options);
  }

  async runAction(root: string, action: SourceControlAction): Promise<void> {
    const provider = await this.require(root);
    if (!provider.run || !provider.actions?.includes(action)) throw unsupported(provider);
    return provider.run(root, action);
  }

  async stage(root: string, paths: string[]): Promise<void> {
    const provider = await this.require(root);
    if (!provider.stage) throw unsupported(provider);
    return provider.stage(root, paths);
  }

  async unstage(root: string, paths: string[]): Promise<void> {
    const provider = await this.require(root);
    if (!provider.unstage) throw unsupported(provider);
    return provider.unstage(root, paths);
  }

  async discard(root: string, paths: string[]): Promise<void> {
    const provider = await this.require(root);
    if (!provider.discard) throw unsupported(provider);
    return provider.discard(root, paths);
  }

  async branchAction(root: string, action: SourceControlBranchAction, target: string): Promise<void> {
    const provider = await this.require(root);
    if (!provider.branchAction) throw unsupported(provider);
    return provider.branchAction(root, action, target);
  }

  async history(root: string, skip: number, limit: number): Promise<SourceControlHistory> {
    const provider = await this.require(root);
    if (!provider.history) throw unsupported(provider);
    return provider.history(root, skip, limit);
  }

  async commitFiles(root: string, id: string): Promise<SourceControlCommitFile[]> {
    const provider = await this.require(root);
    if (!provider.commitFiles) throw unsupported(provider);
    return provider.commitFiles(root, id);
  }

  async commitFile(root: string, id: string, file: string, originalPath?: string): Promise<SourceControlCommitFileContents> {
    const provider = await this.require(root);
    if (!provider.commitFile) throw unsupported(provider);
    return provider.commitFile(root, id, file, originalPath);
  }

  async revert(root: string, id: string): Promise<void> {
    const provider = await this.require(root);
    if (!provider.revert) throw unsupported(provider);
    return provider.revert(root, id);
  }

  async stashes(root: string): Promise<SourceControlStash[]> {
    const provider = await this.require(root);
    if (!provider.stashes) throw unsupported(provider);
    return provider.stashes(root);
  }

  async stashAction(root: string, action: SourceControlStashAction, id: string): Promise<void> {
    const provider = await this.require(root);
    if (!provider.stashAction) throw unsupported(provider);
    return provider.stashAction(root, action, id);
  }

  async branches(root: string): Promise<string[]> { return (await this.require(root)).branches(root); }
  async baseBranches(root: string, refresh?: boolean): Promise<BaseBranches> { return (await this.require(root)).baseBranches(root, refresh); }
  async checkout(root: string, branch: string): Promise<void> { return (await this.require(root)).checkout(root, branch); }

  async fileAt(root: string, file: string, base: DiffBase): Promise<string | null> {
    const provider = await this.require(root);
    if (!provider.fileAt) throw new Error(`${provider.label} can't show older versions.`);
    return provider.fileAt(root, file, base);
  }

  async pendingChanges(root: string, stagedOnly = false): Promise<PendingChanges> {
    const provider = await this.require(root);
    if (!provider.pendingChanges) throw new Error(`${provider.label} can't describe pending changes.`);
    return provider.pendingChanges(root, stagedOnly);
  }

  /** Cached for a few seconds: the file tree asks again on every file change. */
  private readonly ignoredCache = new Map<string, { at: number; value: Promise<string[]> }>();
  async ignored(root: string): Promise<string[]> {
    const cached = this.ignoredCache.get(root);
    if (cached && Date.now() - cached.at < 15_000) return cached.value;
    const provider = await this.providerFor(root);
    const value = provider?.ignored ? provider.ignored(root).catch(() => []) : Promise.resolve([]);
    this.ignoredCache.set(root, { at: Date.now(), value });
    return value;
  }

  async search(root: string, query: string, options: SearchOptions): Promise<SearchResult> {
    const provider = await this.providerFor(root);
    if (!provider?.search) throw new Error("Find in Files isn't available for this folder.");
    return provider.search(root, query, options);
  }

  async createWorktree(root: string, branch: string, base?: string): Promise<WorktreeResult> {
    const provider = await this.require(root);
    const target = path.join(worktreeContainer(root), branch.replace(/[^A-Za-z0-9._-]+/g, "-"));
    return provider.createWorktree(root, branch, target, base);
  }

  private async require(root: string): Promise<SourceControlProvider> {
    const provider = await this.providerFor(root);
    if (!provider) throw new Error("This folder is not under source control.");
    return provider;
  }
}
