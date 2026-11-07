import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { SourceControlChange } from "../../shared/models";
import { executablePath } from "../executables";
import type { ProviderStatus, SourceControlProvider } from "../source-control/source-control-provider";

const OUTPUT_LIMIT = 8 * 1024 * 1024;
const CHANGE_LIMIT = 5_000;
// Mirrors git-check-ref-format rules closely enough to reject anything git would; git re-checks below.
const BRANCH_PATTERN = /^(?!-)(?!.*(?:\.\.|\/\/|@\{|\\|\.lock(?:\/|$)|\/\.|\/$|\.$))[A-Za-z0-9._\-/]+$/;

function letterKind(code: string): SourceControlChange["kind"] {
  switch (code) {
    case "A": case "C": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    default: return "modified";
  }
}

/** Parses `git status --porcelain=v2 --branch -z` output. */
export function parsePorcelainV2(output: string): ProviderStatus {
  const status: ProviderStatus = { ahead: 0, behind: 0, changes: [], truncated: false };
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.head ")) {
      const head = record.slice(14);
      if (head !== "(detached)") status.branch = head;
    } else if (record.startsWith("# branch.upstream ")) {
      status.upstream = record.slice(18);
    } else if (record.startsWith("# branch.ab ")) {
      const [ahead, behind] = record.slice(12).split(" ");
      status.ahead = Math.abs(Number(ahead)) || 0;
      status.behind = Math.abs(Number(behind)) || 0;
    } else if (record.startsWith("1 ") || record.startsWith("2 ")) {
      const fields = record.split(" ");
      const [staged, unstaged] = fields[1];
      const ordinary = record.startsWith("1 ");
      const filePath = fields.slice(ordinary ? 8 : 9).join(" ");
      const change: SourceControlChange = { path: filePath, kind: letterKind(unstaged !== "." ? unstaged : staged), staged: staged !== "." };
      if (!ordinary) { change.originalPath = records[index + 1]; index += 1; }
      status.changes.push(change);
    } else if (record.startsWith("u ")) {
      status.changes.push({ path: record.split(" ").slice(10).join(" "), kind: "conflicted", staged: false });
    } else if (record.startsWith("? ")) {
      status.changes.push({ path: record.slice(2), kind: "untracked", staged: false });
    }
    if (status.changes.length >= CHANGE_LIMIT) { status.truncated = true; break; }
  }
  return status;
}

/** One entry of `git worktree list --porcelain`. The first entry is the main checkout. */
export interface WorktreeRecord {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

/** Parses `git worktree list --porcelain` (newline separated; one blank line between entries). */
export function parseWorktreeList(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), detached: false, locked: false, prunable: false };
      records.push(current);
    } else if (!current) continue;
    else if (line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "detached") current.detached = true;
    else if (line === "locked" || line.startsWith("locked ")) current.locked = true;
    else if (line === "prunable" || line.startsWith("prunable ")) current.prunable = true;
    else if (line === "bare") records.pop();
  }
  return records;
}

export function isValidBranchName(branch: string): boolean {
  return BRANCH_PATTERN.test(branch) && branch !== "@" && branch !== "HEAD";
}

export class GitSourceControlProvider implements SourceControlProvider {
  readonly id = "git";
  readonly label = "Git";

  constructor(private readonly executable = () => executablePath("git")) {}

  async detect(root: string): Promise<boolean> {
    if (!this.executable()) return false;
    return (await this.git(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")).trim() === "true";
  }

  async status(root: string): Promise<ProviderStatus> {
    return parsePorcelainV2(await this.git(root, ["-c", "core.quotePath=false", "status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]));
  }

  async branches(root: string): Promise<string[]> {
    return (await this.git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']))
      .trim().split('\n').filter(branch => branch && !branch.endsWith('/HEAD'));
  }

  async checkout(root: string, branch: string): Promise<void> {
    if (!isValidBranchName(branch)) throw new Error('Invalid branch name.');
    if ((await this.status(root)).changes.length) throw new Error('Commit your changes or open a new worktree before switching branches.');
    // Remote refs become local tracking branches; local branches switch directly.
    const local = await this.git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
    await this.git(root, local ? ['switch', '--', branch] : ['switch', '--track', '--', branch]);
  }

  async commit(root: string, message: string): Promise<{ commitId: string }> {
    await this.git(root, ["add", "--all"]);
    await this.git(root, ["commit", "--quiet", "-m", message]);
    return { commitId: (await this.git(root, ["rev-parse", "HEAD"])).trim() };
  }

  async createWorktree(root: string, branch: string, target: string, base?: string): Promise<{ path: string; branch: string }> {
    if (!isValidBranchName(branch)) throw new Error(`"${branch}" is not a valid branch name.`);
    await this.git(root, ["check-ref-format", "--branch", branch]);
    await mkdir(path.dirname(target), { recursive: true });
    let start: string | undefined;
    if (base) {
      // Start from the freshest main we can reach; offline falls back to the local copy.
      await this.git(root, ["fetch", "--quiet", "origin", base]).catch(() => undefined);
      for (const candidate of [`origin/${base}`, base]) {
        if (await this.git(root, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]).then(() => true, () => false)) { start = candidate; break; }
      }
      if (!start) throw new Error(`Could not find ${base} to start from.`);
    }
    // --no-track: a new piece of work is its own branch, not a copy that pulls from main.
    await this.git(root, ["worktree", "add", ...(start ? ["--no-track"] : []), "-b", branch, "--", target, ...(start ? [start] : [])]);
    return { path: target, branch };
  }

  async worktrees(root: string): Promise<WorktreeRecord[]> {
    return parseWorktreeList(await this.git(root, ["worktree", "list", "--porcelain"]));
  }

  /** Files changed in a worktree (tracked and untracked, not ignored). */
  async changeCount(root: string): Promise<number> {
    const output = await this.git(root, ["status", "--porcelain=v1", "--untracked-files=normal", "-z"]);
    return output.split("\0").filter(Boolean).filter((record) => /^[ MADRCU?!]{2} /.test(record)).length;
  }

  /** Commits on `branch` that no remote branch has. */
  async unpushedCount(root: string, branch: string): Promise<number> {
    if (!isValidBranchName(branch)) throw new Error("Invalid branch name.");
    return Number((await this.git(root, ["rev-list", "--count", `refs/heads/${branch}`, "--not", "--remotes"])).trim()) || 0;
  }

  /**
   * A file's text at the last commit (`head`) or where this branch left main (`main`: the merge base with origin/main,
   * else main). Null when it didn't exist there. The ref is never taken from the renderer.
   */
  async fileAt(root: string, file: string, base: "head" | "main"): Promise<string | null> {
    if (!file || file.startsWith("/") || file.split("/").includes("..")) throw new Error("Paths must be relative to the workspace.");
    let ref = "HEAD";
    if (base === "main") {
      ref = "";
      for (const candidate of ["origin/main", "main"]) {
        ref = (await this.git(root, ["merge-base", "HEAD", candidate]).catch(() => "")).trim();
        if (ref) break;
      }
      if (!/^[0-9a-f]{7,64}$/.test(ref)) throw new Error("Could not find where this branch left main.");
    }
    // The path is from the repo's top, as the tree and status show it.
    return this.git(root, ["show", `${ref}:${file}`]).catch(() => null);
  }

  /** What git ignores, folded to the top folder (build output, node_modules, qa-output), to dim in the file tree. */
  async ignored(root: string): Promise<string[]> {
    const output = await this.git(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
    return output.split("\0").filter(Boolean).map((entry) => entry.replace(/\/$/, "")).slice(0, 5_000);
  }

  /** git itself refuses a worktree with changes or untracked files (no --force, ever). The branch is kept. */
  async removeWorktree(root: string, target: string): Promise<void> {
    await this.git(root, ["worktree", "remove", "--", target]);
  }

  private git(cwd: string, args: string[]): Promise<string> {
    const executable = this.executable();
    if (!executable) return Promise.reject(new Error("Git was not found on this machine."));
    return new Promise((resolve, reject) => {
      execFile(executable, args, { cwd, maxBuffer: OUTPUT_LIMIT, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message).trim()));
        else resolve(stdout);
      });
    });
  }
}
