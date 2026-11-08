import path from "node:path";
import type { DiffBase, SearchOptions, SearchResult, SourceControlStatus, WorktreeResult } from "../../shared/models";
import { worktreeContainer } from "../workspace-files";

export type ProviderStatus = Omit<SourceControlStatus, "providerId" | "providerLabel" | "root">;

/** A version-control system behind a narrow, fixed set of operations. */
export interface SourceControlProvider {
  id: string;
  label: string;
  detect: (root: string) => Promise<boolean>;
  status: (root: string) => Promise<ProviderStatus>;
  /** Records every working change in one commit. */
  commit: (root: string, message: string) => Promise<{ commitId: string }>;
  createWorktree: (root: string, branch: string, target: string) => Promise<WorktreeResult>;
  branches: (root: string) => Promise<string[]>;
  /** Switches the checkout to a branch; refuses while there are uncommitted changes. */
  checkout: (root: string, branch: string) => Promise<void>;
  /** A file's text at the last commit or where this branch left the default branch; null when it didn't exist there. */
  fileAt?: (root: string, path: string, base: DiffBase) => Promise<string | null>;
  /** Paths the system ignores (folded to their top folder), to dim in the file tree. */
  ignored?: (root: string) => Promise<string[]>;
  /** Text search inside the files the system knows about (tracked and untracked, not ignored). */
  search?: (root: string, query: string, options: SearchOptions) => Promise<SearchResult>;
}

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
    return { ...(await provider.status(root)), providerId: provider.id, providerLabel: provider.label, root };
  }

  async commit(root: string, message: string): Promise<{ commitId: string }> {
    return (await this.require(root)).commit(root, message);
  }

  async branches(root: string): Promise<string[]> { return (await this.require(root)).branches(root); }
  async checkout(root: string, branch: string): Promise<void> { return (await this.require(root)).checkout(root, branch); }

  async fileAt(root: string, file: string, base: DiffBase): Promise<string | null> {
    const provider = await this.require(root);
    if (!provider.fileAt) throw new Error(`${provider.label} can't show older versions.`);
    return provider.fileAt(root, file, base);
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

  async createWorktree(root: string, branch: string): Promise<WorktreeResult> {
    const provider = await this.require(root);
    const target = path.join(worktreeContainer(root), branch.replace(/[^A-Za-z0-9._-]+/g, "-"));
    return provider.createWorktree(root, branch, target);
  }

  private async require(root: string): Promise<SourceControlProvider> {
    const provider = await this.providerFor(root);
    if (!provider) throw new Error("This folder is not under source control.");
    return provider;
  }
}
