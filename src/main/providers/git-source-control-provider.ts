import { execFile, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BaseBranch, BaseBranches, DiffBase, SearchMatch, SearchOptions, SearchResult, SourceControlChange } from "../../shared/models";
import { executablePath } from "../executables";
import type { ProviderStatus, SourceControlProvider } from "../source-control/source-control-provider";

const OUTPUT_LIMIT = 8 * 1024 * 1024;
const CHANGE_LIMIT = 5_000;
const SEARCH_MATCHES = 500;
const SEARCH_MS = 2_000;
// A slow or unreachable remote must not hold up starting a session.
const FETCH_MS = 10_000;
const GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
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

/** Parses `git grep -n -z` output: `path\0line\0text` per line. */
export function parseGrep(output: string, limit = SEARCH_MATCHES): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const record of output.split("\n")) {
    if (!record) continue;
    const [file, line, ...rest] = record.split("\0");
    const number = Number(line);
    if (!file || !Number.isFinite(number)) continue;
    matches.push({ path: file, line: number, text: rest.join("\0").slice(0, 400) });
    if (matches.length >= limit) break;
  }
  return matches;
}

/** Parses `git for-each-ref` output with the format `%(refname)%00%(committerdate:unix)%00%(HEAD)`. */
export function parseBaseBranches(output: string): BaseBranch[] {
  const branches: BaseBranch[] = [];
  for (const line of output.split("\n")) {
    const [ref, updatedAt, head] = line.split("\0");
    if (!ref || /^refs\/remotes\/[^/]+\/HEAD$/.test(ref)) continue;
    const local = ref.startsWith("refs/heads/");
    if (!local && !ref.startsWith("refs/remotes/")) continue;
    branches.push({ ref, name: ref.slice(local ? 11 : 13), kind: local ? "local" : "remote", updatedAt: Number(updatedAt) || 0, current: head === "*" });
  }
  return branches;
}

export function isValidBranchName(branch: string): boolean {
  return BRANCH_PATTERN.test(branch) && branch !== "@" && branch !== "HEAD";
}

export class GitSourceControlProvider implements SourceControlProvider {
  readonly id = "git";
  readonly label = "Git";

  private readonly searches = new Map<string, ChildProcess>();

  constructor(private readonly executable = () => executablePath("git")) {}

  async detect(root: string): Promise<boolean> {
    if (!this.executable()) return false;
    return (await this.git(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")).trim() === "true";
  }

  async status(root: string): Promise<ProviderStatus> {
    return parsePorcelainV2(await this.git(root, ["-c", "core.quotePath=false", "status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]));
  }

  async commit(root: string, message: string): Promise<{ commitId: string }> {
    await this.git(root, ["add", "--all"]);
    await this.git(root, ["commit", "--quiet", "-m", message]);
    return { commitId: (await this.git(root, ["rev-parse", "HEAD"])).trim() };
  }

  async createWorktree(root: string, branch: string, target: string, base?: string): Promise<{ path: string; branch: string }> {
    if (!isValidBranchName(branch)) throw new Error(`"${branch}" is not a valid branch name.`);
    await this.git(root, ["check-ref-format", "--branch", branch]);
    if (base) await this.prepareBase(root, base);
    await mkdir(path.dirname(target), { recursive: true });
    // --no-track: the session's branch is its own work, not a local copy of the branch it started from.
    await this.git(root, ["worktree", "add", "--no-track", "-b", branch, "--", target, ...(base ? [base] : [])]);
    return { path: target, branch };
  }

  /** The ref comes from the renderer, so it must name an existing branch; one on origin is first brought up to date. */
  private async prepareBase(root: string, base: string): Promise<void> {
    if (!/^refs\/(heads|remotes)\/./.test(base)) throw new Error("Choose a branch to create the worktree from.");
    const originBranch = /^refs\/remotes\/origin\/(.+)$/.exec(base)?.[1];
    if (originBranch) await this.git(root, ["fetch", "--quiet", "origin", `+refs/heads/${originBranch}:${base}`], FETCH_MS).catch(() => undefined);
    const exists = await this.git(root, ["show-ref", "--verify", "--quiet", base]).then(() => true, () => false);
    if (!exists) throw new Error(`"${base.replace(/^refs\/(heads|remotes)\//, "")}" no longer exists. Choose another branch to create from.`);
  }

  async baseBranches(root: string, refresh = false): Promise<BaseBranches> {
    if (refresh) await this.git(root, ["fetch", "--quiet", "origin"], FETCH_MS).catch(() => undefined);
    const branches = parseBaseBranches(await this.git(root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)%00%(committerdate:unix)%00%(HEAD)", "refs/heads", "refs/remotes"]));
    const candidates = await this.defaultBranchCandidates(root);
    const preferred = candidates.map((name) => branches.find((branch) => branch.name === name)).find(Boolean);
    return { branches, defaultRef: (preferred ?? branches.find((branch) => branch.current))?.ref };
  }

  async branches(root: string): Promise<string[]> {
    return (await this.git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]))
      .trim().split("\n").filter((branch) => branch && !branch.endsWith("/HEAD"));
  }

  async checkout(root: string, branch: string): Promise<void> {
    if (!isValidBranchName(branch)) throw new Error("Invalid branch name.");
    if ((await this.status(root)).changes.length) throw new Error("Commit your changes or open a new worktree before switching branches.");
    // Remote refs become local tracking branches; local branches switch directly.
    const local = await this.git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true, () => false);
    await this.git(root, local ? ["switch", "--", branch] : ["switch", "--track", "--", branch]);
  }

  /**
   * A file's text at the last commit (`head`) or where this branch left the default branch (`default`: the merge base
   * with origin's HEAD, else main, else master). Null when it didn't exist there. The ref is never taken from the renderer.
   * The path is relative to `root` (the workspace), which may be below the repository's top.
   */
  async fileAt(root: string, file: string, base: DiffBase): Promise<string | null> {
    if (!file || file.startsWith("/") || file.split("/").includes("..")) throw new Error("Paths must be relative to the workspace.");
    let ref = "HEAD";
    if (base === "default") {
      ref = "";
      for (const candidate of await this.defaultBranchCandidates(root)) {
        ref = (await this.git(root, ["merge-base", "HEAD", candidate]).catch(() => "")).trim();
        if (ref) break;
      }
      if (!/^[0-9a-f]{7,64}$/.test(ref)) throw new Error("Could not find where this branch left the default branch.");
    }
    return this.git(root, ["show", `${ref}:./${file}`]).catch(() => null);
  }

  /** What git ignores, folded to the top folder (build output, node_modules), to dim in the file tree. */
  async ignored(root: string): Promise<string[]> {
    const output = await this.git(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
    return output.split("\0").filter(Boolean).map((entry) => entry.replace(/\/$/, "")).slice(0, 5_000);
  }

  /** `git grep` over tracked and untracked files (not ignored). One search per root at a time; capped in matches and time. */
  search(root: string, query: string, options: SearchOptions): Promise<SearchResult> {
    const executable = this.executable();
    if (!executable) return Promise.reject(new Error("Git was not found on this machine."));
    this.searches.get(root)?.kill();
    // The query follows -e so it is never read as an option.
    const args = ["-c", "core.quotePath=false", "grep", "-n", "-I", "--untracked", "--no-color", "-z",
      ...(options.caseSensitive ? [] : ["-i"]), options.regex ? "-E" : "-F", "-e", query, "--", "."];
    return new Promise((resolve, reject) => {
      let output = "";
      let limited = false;
      const child = execFile(executable, args, { cwd: root, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...GIT_ENV } }, (error) => {
        clearTimeout(timer);
        if (this.searches.get(root) === child) this.searches.delete(root);
        const matches = parseGrep(output);
        // Exit 1 = no matches; a kill = the time or match limit (or a newer search).
        if (error && (error as { code?: unknown }).code !== 1 && !child.killed) {
          reject(new Error(String(error.message).split("\n").at(-1) || "Search failed"));
          return;
        }
        resolve({ matches, limited: limited || matches.length >= SEARCH_MATCHES });
      });
      this.searches.set(root, child);
      const timer = setTimeout(() => { limited = true; child.kill(); }, SEARCH_MS);
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if ((output.match(/\n/g)?.length ?? 0) >= SEARCH_MATCHES) { limited = true; child.kill(); }
      });
    });
  }

  /** origin's default branch when the remote says, then the usual names. */
  private async defaultBranchCandidates(root: string): Promise<string[]> {
    const remoteHead = (await this.git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")).trim();
    return [...new Set([remoteHead, "origin/main", "main", "origin/master", "master"].filter(Boolean))];
  }

  private git(cwd: string, args: string[], timeout = 0): Promise<string> {
    const executable = this.executable();
    if (!executable) return Promise.reject(new Error("Git was not found on this machine."));
    return new Promise((resolve, reject) => {
      execFile(executable, args, { cwd, timeout, maxBuffer: OUTPUT_LIMIT, env: { ...process.env, ...GIT_ENV } }, (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message).trim()));
        else resolve(stdout);
      });
    });
  }
}
