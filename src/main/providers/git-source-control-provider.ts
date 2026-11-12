import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  BaseBranch, BaseBranches, DiffBase, SearchMatch, SearchOptions, SearchResult, SourceControlAction, SourceControlBranchAction, SourceControlChange, SourceControlCommit,
  SourceControlCommitFile, SourceControlCommitFileContents, SourceControlHistory, SourceControlOperation, SourceControlStash, SourceControlStashAction,
} from "../../shared/models";
import { executablePath } from "../executables";
import type { PendingChanges, ProviderStatus, SourceControlProvider } from "../source-control/source-control-provider";

const OUTPUT_LIMIT = 8 * 1024 * 1024;
const CHANGE_LIMIT = 5_000;
const SEARCH_MATCHES = 500;
const SEARCH_MS = 2_000;
// A slow or unreachable remote must not hold up starting a session.
const FETCH_MS = 10_000;
// A pull or push the person asked for and is watching; long enough for pre-push hooks, short enough that a stuck remote ends.
const NETWORK_MS = 5 * 60_000;
const COMMIT_FILE_LIMIT = 2 * 1024 * 1024;
const COMMIT_BODY_CHARS = 4_000;
const PATH_BATCH = 500;
const COMMIT_ID = /^[0-9a-f]{7,64}$/;
const LOG_FORMAT = ["%H", "%h", "%P", "%an", "%at", "%D", "%s", "%b"].join("%x1f") + "%x1e";
const GIT_ACTIONS: readonly SourceControlAction[] = ["sync", "pull", "pullRebase", "push", "fetch", "fetchPrune", "stageAll", "unstageAll", "discardAll", "undoLastCommit", "stash", "stashIncludeUntracked", "continueOperation", "abortOperation"];
// Enough to describe a change, without one large file crowding out the rest or spending the user's tokens.
const PENDING_READ_LIMIT = 4 * 1024 * 1024;
const PENDING_SUMMARY_CHARS = 16_000;
const PENDING_FILE_CHARS = 8_000;
const PENDING_TOTAL_CHARS = 48_000;
// Named in the summary, but their contents aren't sent to a model.
const SECRET_PATHSPECS = ["**/.env*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/.npmrc", "**/.netrc", "**/credentials.json", "**/id_rsa", "**/id_ed25519"].map((pattern) => `:(top,exclude,glob)${pattern}`);
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

/** Caps each file's section of a unified diff, then the whole. Lines inside a section always start with a diff marker. */
export function capDiff(diff: string, fileChars: number, totalChars: number): { diff: string; truncated: boolean } {
  let truncated = false;
  let result = "";
  for (const section of diff.split(/^(?=diff --git )/m)) {
    const capped = section.length > fileChars ? `${section.slice(0, fileChars)}\n[rest of this file's changes omitted]\n` : section;
    if (capped !== section) truncated = true;
    if (result.length + capped.length > totalChars) { truncated = true; break; }
    result += capped;
  }
  return { diff: result, truncated };
}

/** Parses `git status --porcelain=v2 --branch -z` output. */
export function parsePorcelainV2(output: string): ProviderStatus {
  const status: ProviderStatus = { ahead: 0, behind: 0, changes: [], truncated: false, hasRemote: false };
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice(13);
      if (oid !== "(initial)") status.head = oid;
    } else if (record.startsWith("# branch.head ")) {
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
      const change: SourceControlChange = { path: filePath, kind: letterKind(unstaged !== "." ? unstaged : staged), staged: staged !== ".", unstaged: unstaged !== "." };
      if (!ordinary) { change.originalPath = records[index + 1]; index += 1; }
      status.changes.push(change);
    } else if (record.startsWith("u ")) {
      status.changes.push({ path: record.split(" ").slice(10).join(" "), kind: "conflicted", staged: false, unstaged: true });
    } else if (record.startsWith("? ")) {
      status.changes.push({ path: record.slice(2), kind: "untracked", staged: false, unstaged: true });
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

/** Parses `git log` output with `LOG_FORMAT`. */
export function parseLog(output: string): SourceControlCommit[] {
  const commits: SourceControlCommit[] = [];
  for (const record of output.split("\x1e")) {
    const [id, shortId, parents, author, date, refs, subject, body] = record.replace(/^\n/, "").split("\x1f");
    if (!id || subject === undefined) continue;
    commits.push({
      id, shortId, author, subject, date: Number(date) || 0, body: (body ?? "").trim().slice(0, COMMIT_BODY_CHARS),
      parents: parents ? parents.split(" ") : [],
      refs: refs ? refs.split(", ").map((ref) => ref.replace(/^HEAD -> |^tag: /, "")).filter((ref) => ref !== "HEAD") : [],
    });
  }
  return commits;
}

/** Parses `git diff-tree --name-status -z` output. Renames and copies carry two paths. */
export function parseNameStatus(output: string): SourceControlCommitFile[] {
  const files: SourceControlCommitFile[] = [];
  const fields = output.split("\0");
  for (let index = 0; index < fields.length - 1;) {
    const code = fields[index][0];
    if (code === "R" || code === "C") {
      files.push({ originalPath: fields[index + 1], path: fields[index + 2], kind: letterKind(code) });
      index += 3;
    } else {
      files.push({ path: fields[index + 1], kind: letterKind(code) });
      index += 2;
    }
  }
  return files;
}

/** Literal and relative to the repository's top, the way status reports paths. */
function pathspecs(paths: string[]): string[] {
  return paths.map((file) => {
    if (file.startsWith("/") || file.split("/").includes("..")) throw new Error("Paths must be relative to the repository.");
    return `:(top,literal)${file}`;
  });
}

function requireCommitId(id: string): void {
  if (!COMMIT_ID.test(id)) throw new Error("That is not a commit id.");
}

export function isValidBranchName(branch: string): boolean {
  return BRANCH_PATTERN.test(branch) && branch !== "@" && branch !== "HEAD";
}

export class GitSourceControlProvider implements SourceControlProvider {
  readonly id = "git";
  readonly label = "Git";
  readonly actions = GIT_ACTIONS;

  private readonly searches = new Map<string, ChildProcess>();

  constructor(private readonly executable = () => executablePath("git"), private readonly trusted: (root: string) => boolean = () => false) {}

  async detect(root: string): Promise<boolean> {
    if (!this.executable()) return false;
    return (await this.git(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")).trim() === "true";
  }

  async status(root: string): Promise<ProviderStatus> {
    const [status, remotes, operation] = await Promise.all([
      this.git(root, ["-c", "core.quotePath=false", "status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]).then(parsePorcelainV2),
      this.git(root, ["remote"]).catch(() => ""),
      this.operation(root).catch(() => undefined),
    ]);
    return { ...status, hasRemote: Boolean(remotes.trim()), ...(operation ? { operation } : {}) };
  }

  async commit(root: string, message: string, options: { stagedOnly?: boolean } = {}): Promise<{ commitId: string }> {
    return this.record(root, ["commit", "--quiet", "-m", message], options.stagedOnly);
  }

  async amend(root: string, message: string, options: { stagedOnly?: boolean } = {}): Promise<{ commitId: string }> {
    return this.record(root, ["commit", "--quiet", "--amend", "-m", message], options.stagedOnly);
  }

  private async record(root: string, commit: string[], stagedOnly = false): Promise<{ commitId: string }> {
    if ((await this.status(root)).changes.some((change) => change.kind === "conflicted")) throw new Error("Resolve the conflicts before committing.");
    if (!stagedOnly) await this.git(root, ["add", "--all"]);
    await this.git(root, commit);
    return { commitId: (await this.git(root, ["rev-parse", "HEAD"])).trim() };
  }

  /** Which operation is waiting on the person, from the marker files git keeps while one runs. */
  private async operation(root: string): Promise<SourceControlOperation | undefined> {
    const markers: [string, SourceControlOperation][] = [["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"]];
    const paths = (await this.git(root, ["rev-parse", ...markers.flatMap(([name]) => ["--git-path", name])])).trim().split("\n");
    const found = await Promise.all(paths.map((marker) => access(path.resolve(root, marker)).then(() => true, () => false)));
    return markers[found.indexOf(true)]?.[1];
  }

  async run(root: string, action: SourceControlAction): Promise<void> {
    switch (action) {
      case "pull": return this.pull(root, false);
      case "pullRebase": return this.pull(root, true);
      case "push": return this.push(root);
      case "sync":
        if ((await this.status(root)).upstream) await this.pull(root, false);
        return this.push(root);
      case "fetch": await this.git(root, ["fetch", "--quiet"], NETWORK_MS); return;
      case "fetchPrune": await this.git(root, ["fetch", "--quiet", "--prune"], NETWORK_MS); return;
      case "stageAll": await this.git(root, ["add", "--all"]); return;
      case "unstageAll": await this.git(root, ["reset", "--quiet"]); return;
      case "discardAll": return this.discard(root, (await this.status(root)).changes.map((change) => change.path));
      case "undoLastCommit": return this.undoLastCommit(root);
      case "stash": await this.git(root, ["stash", "push", "--quiet"]); return;
      case "stashIncludeUntracked": await this.git(root, ["stash", "push", "--quiet", "--include-untracked"]); return;
      case "continueOperation": await this.git(root, [await this.requireOperation(root), "--continue"], 0, { GIT_EDITOR: "true" }); return;
      case "abortOperation": await this.git(root, [await this.requireOperation(root), "--abort"]); return;
    }
  }

  private async requireOperation(root: string): Promise<SourceControlOperation> {
    const operation = await this.operation(root);
    if (!operation) throw new Error("Nothing is in progress.");
    return operation;
  }

  /** The person's own pull settings win; without any, diverged branches merge instead of git refusing. Not quiet, so a conflict is explained. */
  private async pull(root: string, rebase: boolean): Promise<void> {
    const configured = await this.git(root, ["config", "--get-regexp", "^pull\\.(rebase|ff)$"]).catch(() => "");
    const mode = rebase ? ["--rebase"] : configured.trim() ? [] : ["--no-rebase"];
    await this.git(root, ["pull", "--no-edit", ...mode], NETWORK_MS);
  }

  /** A branch with no upstream is published to origin, or the only remote there is. */
  private async push(root: string): Promise<void> {
    const { branch, upstream } = await this.status(root);
    if (!branch) throw new Error("Switch to a branch before pushing.");
    if (upstream) { await this.git(root, ["push", "--quiet"], NETWORK_MS); return; }
    const remotes = (await this.git(root, ["remote"])).trim().split("\n").filter(Boolean);
    const remote = remotes.includes("origin") ? "origin" : remotes[0];
    if (!remote) throw new Error("This repository has no remote to publish to.");
    await this.git(root, ["push", "--quiet", "--set-upstream", remote, `HEAD:refs/heads/${branch}`], NETWORK_MS);
  }

  /** Keeps the commit's changes staged. The first commit has no parent to go back to. */
  private async undoLastCommit(root: string): Promise<void> {
    const parent = await this.parentOf(root, "HEAD");
    await this.git(root, parent ? ["reset", "--quiet", "--soft", parent] : ["update-ref", "-d", "HEAD"]);
  }

  private async parentOf(root: string, commit: string): Promise<string> {
    return (await this.git(root, ["rev-parse", "--verify", "--quiet", `${commit}^1`]).catch(() => "")).trim();
  }

  async stage(root: string, paths: string[]): Promise<void> {
    await this.inBatches(root, ["add", "--all", "--"], pathspecs(paths));
  }

  /** A staged rename has to give back both of its paths. */
  async unstage(root: string, paths: string[]): Promise<void> {
    const { changes } = await this.status(root);
    const originals = changes.filter((change) => change.originalPath && paths.includes(change.path)).map((change) => change.originalPath as string);
    await this.inBatches(root, ["reset", "--quiet", "--"], pathspecs([...paths, ...originals]));
  }

  /** Only touches files status still reports as changed, and leaves conflicts and staged content alone. */
  async discard(root: string, paths: string[]): Promise<void> {
    const wanted = new Set(paths);
    const changes = (await this.status(root)).changes.filter((change) => wanted.has(change.path) && change.unstaged && change.kind !== "conflicted");
    await this.inBatches(root, ["restore", "--worktree", "--"], pathspecs(changes.filter((change) => change.kind !== "untracked").map((change) => change.path)));
    await this.inBatches(root, ["clean", "--force", "--quiet", "--"], pathspecs(changes.filter((change) => change.kind === "untracked").map((change) => change.path)));
  }

  private async inBatches(root: string, command: string[], specs: string[]): Promise<void> {
    for (let start = 0; start < specs.length; start += PATH_BATCH) await this.git(root, [...command, ...specs.slice(start, start + PATH_BATCH)]);
  }

  async branchAction(root: string, action: SourceControlBranchAction, target: string): Promise<void> {
    if (action === "create") {
      if (!isValidBranchName(target)) throw new Error(`"${target}" is not a valid branch name.`);
      await this.git(root, ["check-ref-format", "--branch", target]);
      await this.git(root, ["switch", "--quiet", "-c", target]);
      return;
    }
    if (!/^refs\/(heads|remotes)\/./.test(target)) throw new Error("Choose a branch.");
    await this.git(root, ["show-ref", "--verify", "--quiet", target]).catch(() => { throw new Error("That branch no longer exists."); });
    if (action === "merge") await this.git(root, ["merge", "--no-edit", target]);
    else if (action === "rebase") await this.git(root, ["rebase", target]);
    else {
      if (!target.startsWith("refs/heads/")) throw new Error("Only local branches can be deleted here.");
      await this.git(root, ["branch", "--delete", "--", target.slice(11)]);
    }
  }

  /** The upstream is included so commits waiting to be pulled show; a branch whose upstream is gone falls back to HEAD alone. */
  async history(root: string, skip: number, limit: number): Promise<SourceControlHistory> {
    const log = (revisions: string[]) => this.git(root, ["log", `--format=${LOG_FORMAT}`, `--skip=${skip}`, `--max-count=${limit + 1}`, ...revisions, "--"]);
    const commits = parseLog(await log(["HEAD", "@{upstream}"]).catch(() => log(["HEAD"])));
    return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
  }

  /** Compared with the first parent, so a merge lists what it brought in. */
  async commitFiles(root: string, id: string): Promise<SourceControlCommitFile[]> {
    requireCommitId(id);
    const parent = await this.parentOf(root, id);
    const output = await this.git(root, ["diff-tree", "-r", "-M", "--no-commit-id", "--name-status", "-z", ...(parent ? [parent, id] : ["--root", id])]);
    return parseNameStatus(output).slice(0, CHANGE_LIMIT);
  }

  async commitFile(root: string, id: string, file: string, originalPath?: string): Promise<SourceControlCommitFileContents> {
    // "index" is what is staged, compared with HEAD.
    const staged = id === "index";
    if (!staged) requireCommitId(id);
    pathspecs(originalPath ? [file, originalPath] : [file]);
    const parent = staged ? "HEAD" : await this.parentOf(root, id);
    const read = (ref: string, name: string) => this.gitLimited(root, ["cat-file", "blob", `${ref}:${name}`], {}, COMMIT_FILE_LIMIT).catch(() => null);
    const [before, after] = await Promise.all([parent ? read(parent, originalPath ?? file) : null, read(staged ? "" : id, file)]);
    const sides = [before, after];
    return {
      before: before?.output ?? null, after: after?.output ?? null,
      binary: sides.some((side) => side?.output.includes("\0")),
      truncated: sides.some((side) => side?.limited),
    };
  }

  async revert(root: string, id: string): Promise<void> {
    requireCommitId(id);
    await this.git(root, ["revert", "--no-edit", id]);
  }

  async stashes(root: string): Promise<SourceControlStash[]> {
    const output = await this.git(root, ["stash", "list", "--format=%H%x1f%ct%x1f%gs"]);
    return output.split("\n").filter(Boolean).map((line) => {
      const [id, date, message] = line.split("\x1f");
      return { id, message, date: Number(date) || 0 };
    });
  }

  /** Stashes are addressed by commit because their positions shift when another worktree stashes. */
  async stashAction(root: string, action: SourceControlStashAction, id: string): Promise<void> {
    requireCommitId(id);
    const index = (await this.stashes(root)).findIndex((stash) => stash.id === id);
    if (index < 0) throw new Error("That stash no longer exists.");
    await this.git(root, ["stash", action, "--quiet", `stash@{${index}}`]);
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

  /**
   * Stages everything into a throwaway index and object store, exactly as `commit` would stage it for real (with `stagedOnly`, only what is already staged), so
   * untracked files, renames and a repository with no commits yet all come out right and the repository stays untouched.
   */
  async pendingChanges(root: string, stagedOnly = false): Promise<PendingChanges> {
    const gitPath = async (name: string) => path.resolve(root, (await this.git(root, ["rev-parse", "--git-path", name])).trim());
    const [index, objects] = await Promise.all([gitPath("index"), gitPath("objects")]);
    const scratch = await mkdtemp(path.join(tmpdir(), "workbench-pending-"));
    try {
      const scratchIndex = path.join(scratch, "index");
      const scratchObjects = path.join(scratch, "objects");
      await mkdir(scratchObjects);
      // A repository nothing was ever added to has no index yet. The copy keeps the index's time because git compares
      // against it to know which files to re-read: a newer time hides a same-size edit made just after the last `add`.
      await cp(index, scratchIndex, { preserveTimestamps: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      const env = {
        GIT_INDEX_FILE: scratchIndex,
        GIT_OBJECT_DIRECTORY: scratchObjects,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: `"${objects.replace(/["\\]/g, "\\$&")}"`,
      };
      if (!stagedOnly) await this.git(root, ["add", "--all", "--", ":(top)", ...SECRET_PATHSPECS], 120_000, env);
      const diffArgs = ["-c", "core.quotePath=false", "diff", "--cached", "-M", "--no-ext-diff", "--no-textconv", "--no-color"];
      const fullSummary = (await this.git(root, [...diffArgs, "--stat=120"], 0, env)).trim();
      const read = await this.gitLimited(root, [...diffArgs, "--", ":(top)", ...SECRET_PATHSPECS], env, PENDING_READ_LIMIT);
      const capped = capDiff(read.output, PENDING_FILE_CHARS, PENDING_TOTAL_CHARS);
      const summary = fullSummary.slice(0, PENDING_SUMMARY_CHARS);
      return { summary, diff: capped.diff, truncated: read.limited || capped.truncated || summary !== fullSummary };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
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
      ...(options.caseSensitive ? [] : ["-i"]), options.regex ? "-E" : "-F", "-e", query, "--", options.directory ? `:(literal)${options.directory}` : "."];
    return new Promise((resolve, reject) => {
      let output = "";
      let limited = false;
      const child = execFile(executable, this.inspectionArgs(root, args), { cwd: root, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...GIT_ENV } }, (error) => {
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

  private inspectionArgs(root: string, args: string[]): string[] {
    return this.trusted(root) ? args : ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args];
  }

  private git(cwd: string, args: string[], timeout = 120_000, env: NodeJS.ProcessEnv = {}): Promise<string> {
    const executable = this.executable();
    if (!executable) return Promise.reject(new Error("Git was not found on this machine."));
    return new Promise((resolve, reject) => {
      execFile(executable, this.inspectionArgs(cwd, args), { cwd, timeout, maxBuffer: OUTPUT_LIMIT, env: { ...process.env, ...GIT_ENV, ...env } }, (error, stdout, stderr) => {
        // A conflict is reported on stdout, so a failure with nothing on stderr says why from there.
        if (error) reject(new Error(error.killed && timeout ? "Git took too long and was stopped." : String(stderr || stdout.slice(-2000) || error.message).trim()));
        else resolve(stdout);
      });
    });
  }

  /** For output that can be any size: keeps the first `limit` bytes and stops git, where `git` would fail. */
  private gitLimited(cwd: string, args: string[], env: NodeJS.ProcessEnv, limit: number): Promise<{ output: string; limited: boolean }> {
    const executable = this.executable();
    if (!executable) return Promise.reject(new Error("Git was not found on this machine."));
    return new Promise((resolve, reject) => {
      const child = spawn(executable, this.inspectionArgs(cwd, args), { cwd, env: { ...process.env, ...GIT_ENV, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let limited = false;
      let stderr = "";
      child.on("error", reject);
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
      child.stdout.on("data", (chunk: Buffer) => {
        if (limited) return;
        chunks.push(chunk);
        bytes += chunk.length;
        if (bytes >= limit) { limited = true; child.kill(); }
      });
      child.on("close", (code) => {
        if (code !== 0 && !limited) reject(new Error(stderr.trim() || `git exited with code ${code}`));
        else resolve({ output: Buffer.concat(chunks).subarray(0, limit).toString("utf8"), limited });
      });
    });
  }
}
