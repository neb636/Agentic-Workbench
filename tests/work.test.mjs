import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers";
import gitModule from "../dist-electron/main/providers/git-source-control-provider.js";
import workModule from "../dist-electron/main/work.js";
import filesModule from "../dist-electron/main/workspace-files.js";

const { GitSourceControlProvider, parseWorktreeList } = gitModule;
const { WorkService, checksSummary, pullRequestsByBranch, workName, runExecutable, dependenciesMatch, mapLimited } = workModule;
const { WorkspaceRoots, isWatchedChange } = filesModule;
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function repository() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "studio-work-")));
  const root = join(parent, "Kaylee-Gamepack");
  const origin = join(parent, "origin.git");
  execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "--quiet", "-b", "main", root]);
  git(root, "config", "user.email", "qa@example.com");
  git(root, "config", "user.name", "QA");
  await writeFile(join(root, "tracked.txt"), "one\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "initial");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "--quiet", "-u", "origin", "main");
  return { parent, root };
}

/** Real git; fake gh and npm so tests never touch GitHub or install anything. */
function fakeRunner(prs = []) {
  const calls = [];
  const run = (command, args, cwd, timeout) => {
    calls.push([command, ...args]);
    if (command === "gh" && args[0] === "api") return Promise.resolve("neb636\n");
    if (command === "gh") return Promise.resolve(JSON.stringify(prs));
    if (command === "npm") return Promise.resolve("");
    return runExecutable(command, args, cwd, timeout);
  };
  return { run, calls };
}

test("parses git worktree list, skipping bare entries", () => {
  const output = [
    "worktree /repo", "HEAD aaa", "branch refs/heads/main", "",
    "worktree /repo/.claude/worktrees/a", "HEAD bbb", "branch refs/heads/neb636/canada-whales", "locked", "",
    "worktree /gone", "HEAD ccc", "detached", "prunable gitdir file points to non-existent location", "",
    "worktree /bare.git", "bare", "",
  ].join("\n");
  assert.deepEqual(parseWorktreeList(output), [
    { path: "/repo", head: "aaa", branch: "main", detached: false, locked: false, prunable: false },
    { path: "/repo/.claude/worktrees/a", head: "bbb", branch: "neb636/canada-whales", detached: false, locked: true, prunable: false },
    { path: "/gone", head: "ccc", detached: true, locked: false, prunable: true },
  ]);
});

test("summarises checks and keeps the newest PR per branch", () => {
  assert.equal(checksSummary([]), undefined);
  assert.equal(checksSummary([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }]), "passing");
  assert.equal(checksSummary([{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }]), "pending");
  assert.equal(checksSummary([{ status: "IN_PROGRESS" }, { conclusion: "FAILURE" }]), "failing");
  const map = pullRequestsByBranch([
    { number: 9, state: "OPEN", title: "new", url: "u9", headRefName: "b", headRefOid: "x", statusCheckRollup: [{ conclusion: "SUCCESS" }] },
    { number: 3, state: "CLOSED", title: "old", url: "u3", headRefName: "b" },
    { number: 4, state: "MERGED", title: "m", url: "u4", headRefName: "c", statusCheckRollup: [{ conclusion: "FAILURE" }] },
  ]);
  assert.deepEqual(map.get("b"), { number: 9, state: "OPEN", title: "new", url: "u9", isDraft: false, headSha: "x", checks: "passing" });
  assert.equal(map.get("c").checks, undefined, "finished PRs don't show CI");
});

test("reuses main's node_modules only when it was installed from the same lockfile", () => {
  const lock = { packages: { "": { name: "game" }, "node_modules/vite": { version: "8.3.0" }, "node_modules/@rolldown/binding-linux-x64-gnu": { version: "1.0.0", optional: true } } };
  const installed = { packages: { "node_modules/vite": { version: "8.3.0" } } };
  assert.equal(dependenciesMatch(lock, installed), true, "another platform's optional binary may be missing");
  assert.equal(dependenciesMatch(lock, { packages: { "node_modules/vite": { version: "8.2.0" } } }), false, "a different version");
  assert.equal(dependenciesMatch({ packages: { ...lock.packages, "node_modules/three": { version: "0.180.0" } } }, installed), false, "a missing package");
  assert.equal(dependenciesMatch(lock, { packages: { ...installed.packages, "node_modules/left-pad": { version: "1.0.0" } } }), false, "an extra package");
  assert.equal(dependenciesMatch(lock, {}), false);
});

test("runs at most a few at once, in order", async () => {
  let running = 0, most = 0;
  const out = await mapLimited([5, 1, 4, 2, 3], 2, async (value) => {
    running++; most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, value * 3));
    running--;
    return value * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(most, 2);
});

test("file watching ignores build output and other worktrees' git activity", () => {
  for (const quiet of ["node_modules/vite/index.js", "qa-output/webkit-ipad/shot.png", "dist/index.html", "workbench/release/x", ".git/worktrees/canada/index", ".git/objects/ab/cd", ".git/logs/HEAD", ".git/FETCH_HEAD", "src/.DS_Store"]) assert.equal(isWatchedChange(quiet), false, quiet);
  for (const loud of ["", "src/App.tsx", ".git/HEAD", ".git/index", ".git/refs/heads/main", ".git/packed-refs", "distance.ts"]) assert.equal(isWatchedChange(loud), true, loud);
});

test("work names become safe folder and branch names", () => {
  assert.equal(workName("  Canada Whales! "), "canada-whales");
  assert.throws(() => workName("---"));
  assert.throws(() => workName("../.."));
});

test("lists every worktree, creates new ones from main beside the repo, and cleans up only safe ones", async () => {
  const { parent, root } = await repository();
  const roots = new WorkspaceRoots();
  roots.add(root);
  const { run, calls } = fakeRunner();
  const work = new WorkService(new GitSourceControlProvider(), roots, run);

  // A worktree made elsewhere (like Claude Code's .claude/worktrees) shows up too.
  const elsewhere = join(parent, "elsewhere");
  git(root, "worktree", "add", "--quiet", "-b", "neb636/elsewhere", elsewhere);
  let list = await work.list(join(elsewhere));
  assert.equal(list.repoRoot, root);
  assert.deepEqual(list.items.map((item) => [item.name, item.main, item.branch]), [["main", true, "main"], ["elsewhere", false, "neb636/elsewhere"]]);
  assert.ok(roots.isAllowed(elsewhere), "listed worktrees become readable roots");

  // Main moves on after the local branch was made; new work starts from origin/main.
  git(root, "commit", "--quiet", "--allow-empty", "-m", "on main");
  git(root, "push", "--quiet", "origin", "main");
  git(root, "reset", "--quiet", "--hard", "HEAD~1");
  const created = await work.create(root, "Canada Whales");
  await work.installing;
  assert.deepEqual(created, { path: join(`${root}-worktrees`, "canada-whales"), branch: "neb636/canada-whales" });
  assert.equal(git(created.path, "rev-parse", "HEAD").trim(), git(root, "rev-parse", "origin/main").trim());
  assert.ok(calls.some((call) => call.join(" ") === "npm ci --no-audit --no-fund"));
  await assert.rejects(work.create(root, "canada-whales"), /already exists/);

  // Changes and unpushed commits keep a worktree.
  await writeFile(join(created.path, "draft.txt"), "wip\n");
  list = await work.list(root);
  assert.equal(list.items.find((item) => item.path === created.path).changes, 1);
  await assert.rejects(work.remove(root, created.path), /1 changed file/);
  git(created.path, "add", ".");
  git(created.path, "commit", "--quiet", "-m", "wip");
  await assert.rejects(work.remove(root, created.path), /only exist on this Mac/);
  await assert.rejects(work.remove(root, root), /main checkout/);
  await assert.rejects(work.remove(root, join(parent, "nope")), /not a worktree/);

  // Pushed (or squash-merged with the same head) work can go; its branch stays.
  git(created.path, "push", "--quiet", "origin", "neb636/canada-whales");
  await work.remove(root, created.path);
  await assert.rejects(access(created.path));
  assert.match(git(root, "branch", "--list", "neb636/canada-whales"), /canada-whales/);

  const head = git(elsewhere, "rev-parse", "HEAD").trim();
  git(elsewhere, "commit", "--quiet", "--allow-empty", "-m", "merged by squash");
  const merged = new WorkService(new GitSourceControlProvider(), roots, fakeRunner([
    { number: 7, state: "MERGED", title: "t", url: "u", headRefName: "neb636/elsewhere", headRefOid: git(elsewhere, "rev-parse", "HEAD").trim() },
  ]).run);
  assert.notEqual(head, git(elsewhere, "rev-parse", "HEAD").trim());
  list = await merged.list(root);
  assert.equal(list.items.find((item) => item.name === "elsewhere").pr.state, "MERGED");
  await merged.remove(root, elsewhere);
  assert.equal((await merged.list(root)).items.length, 1);
});
