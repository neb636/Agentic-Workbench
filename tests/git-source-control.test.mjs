/* global setTimeout */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import gitModule from "../dist-electron/main/providers/git-source-control-provider.js";
import serviceModule from "../dist-electron/main/source-control/source-control-provider.js";

const { capDiff, GitSourceControlProvider, isValidBranchName, parseBaseBranches, parseGrep, parsePorcelainV2 } = gitModule;
const { SourceControlService } = serviceModule;

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function repository() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "workbench-git-")));
  const root = join(parent, "repo");
  execFileSync("git", ["init", "--quiet", "-b", "main", root]);
  git(root, "config", "user.email", "qa@example.com");
  git(root, "config", "user.name", "QA");
  await writeFile(join(root, "tracked.txt"), "one\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "initial");
  return { parent, root };
}

test("parses porcelain v2 branch, ordinary, renamed, conflicted, and untracked records", () => {
  const output = [
    "# branch.oid abc", "# branch.head feature", "# branch.upstream origin/feature", "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 a b src/app file.ts",
    "1 A. N... 000000 100644 100644 a b added.ts",
    "2 R. N... 100644 100644 100644 a b R100 new.ts", "old.ts",
    "u UU N... 100644 100644 100644 100644 a b c both.ts",
    "? notes.md", "",
  ].join("\0");
  assert.deepEqual(parsePorcelainV2(output), {
    branch: "feature", upstream: "origin/feature", ahead: 2, behind: 1, truncated: false, changes: [
      { path: "src/app file.ts", kind: "modified", staged: false },
      { path: "added.ts", kind: "added", staged: true },
      { path: "new.ts", kind: "renamed", staged: true, originalPath: "old.ts" },
      { path: "both.ts", kind: "conflicted", staged: false },
      { path: "notes.md", kind: "untracked", staged: false },
    ],
  });
  assert.equal(parsePorcelainV2("# branch.head (detached)\0").branch, undefined);
});

test("validates branch names", () => {
  for (const name of ["wb/feature", "fix-1.2", "a_b"]) assert.equal(isValidBranchName(name), true, name);
  for (const name of ["-x", "a..b", "a b", "x.lock", "a/", "a//b", "a@{1}", "HEAD", "--force"]) assert.equal(isValidBranchName(name), false, name);
});

test("detects repositories, reports status, and commits all changes", async () => {
  const { parent, root } = await repository();
  const service = new SourceControlService([new GitSourceControlProvider()]);
  assert.equal(await service.status(parent), null);
  await writeFile(join(root, "tracked.txt"), "two\n");
  await writeFile(join(root, "new.txt"), "new\n");
  const status = await service.status(root);
  assert.equal(status.providerId, "git");
  assert.equal(status.branch, "main");
  assert.deepEqual(status.changes.map((change) => `${change.kind}:${change.path}`), ["modified:tracked.txt", "untracked:new.txt"]);
  const { commitId } = await service.commit(root, "Update files");
  assert.equal(git(root, "rev-parse", "HEAD").trim(), commitId);
  assert.deepEqual((await service.status(root)).changes, []);
});

test("creates worktrees beside the workspace and rejects invalid branches", async () => {
  const { parent, root } = await repository();
  const service = new SourceControlService([new GitSourceControlProvider()]);
  const created = await service.createWorktree(root, "wb/first-task");
  assert.deepEqual(created, { path: join(parent, "repo-worktrees", "wb-first-task"), branch: "wb/first-task" });
  assert.equal(git(created.path, "branch", "--show-current").trim(), "wb/first-task");
  await assert.rejects(service.createWorktree(root, "bad name"), /not a valid branch/);
  await assert.rejects(service.createWorktree(root, "wb/first-task"), /already exists/);
});

test("parses base branches, dropping a remote's HEAD pointer", () => {
  const output = ["refs/remotes/origin/HEAD\0" + "200\0", "refs/remotes/origin/feature/x\0" + "200\0", "refs/heads/feature/HEAD\0" + "150\0", "refs/heads/main\0" + "100\0*", ""].join("\n");
  assert.deepEqual(parseBaseBranches(output), [
    { ref: "refs/remotes/origin/feature/x", name: "origin/feature/x", kind: "remote", updatedAt: 200, current: false },
    { ref: "refs/heads/feature/HEAD", name: "feature/HEAD", kind: "local", updatedAt: 150, current: false },
    { ref: "refs/heads/main", name: "main", kind: "local", updatedAt: 100, current: true },
  ]);
});

async function clone() {
  const { parent, root: upstream } = await repository();
  git(upstream, "branch", "feature/remote#1");
  const root = join(parent, "clone");
  execFileSync("git", ["clone", "--quiet", upstream, root]);
  git(root, "config", "user.email", "qa@example.com");
  git(root, "config", "user.name", "QA");
  return { parent, upstream, root, service: new SourceControlService([new GitSourceControlProvider()]) };
}

test("the default base is origin's default branch, over a local branch or the current one", async () => {
  const { root, service } = await clone();
  git(root, "switch", "--quiet", "-c", "local-work");
  const { branches, defaultRef } = await service.baseBranches(root);
  assert.equal(defaultRef, "refs/remotes/origin/main");
  assert.deepEqual(branches.map((branch) => branch.name).sort(), ["local-work", "main", "origin/feature/remote#1", "origin/main"]);
  assert.equal(branches.find((branch) => branch.name === "local-work").current, true);
});

test("without origin the default base falls back to the local default, then the current branch", async () => {
  const { root } = await repository();
  const service = new SourceControlService([new GitSourceControlProvider()]);
  assert.equal((await service.baseBranches(root)).defaultRef, "refs/heads/main");
  git(root, "branch", "-m", "main", "trunk");
  assert.equal((await service.baseBranches(root)).defaultRef, "refs/heads/trunk");
});

test("a worktree from a remote base starts at its latest commit and does not track it", async () => {
  const { parent, upstream, root, service } = await clone();
  await writeFile(join(upstream, "tracked.txt"), "newer\n");
  git(upstream, "commit", "--quiet", "-am", "newer");
  const created = await service.createWorktree(root, "wb/from-origin", "refs/remotes/origin/main");
  assert.equal(created.path, join(parent, "clone-worktrees", "wb-from-origin"));
  assert.equal(git(created.path, "rev-parse", "HEAD"), git(upstream, "rev-parse", "HEAD"));
  assert.equal((await service.status(created.path)).upstream, undefined);
});

test("refreshing base branches picks up what was pushed to origin", async () => {
  const { upstream, root, service } = await clone();
  git(upstream, "branch", "pushed-later");
  assert.equal((await service.baseBranches(root)).branches.some((branch) => branch.name === "origin/pushed-later"), false);
  assert.equal((await service.baseBranches(root, true)).branches.some((branch) => branch.name === "origin/pushed-later"), true);
});

test("a worktree can start from a branch whose name git allows but new branches here do not", async () => {
  const { root, service } = await clone();
  const created = await service.createWorktree(root, "wb/from-hash", "refs/remotes/origin/feature/remote#1");
  assert.equal(git(created.path, "rev-parse", "HEAD"), git(root, "rev-parse", "origin/feature/remote#1"));
});

test("a worktree base can be local, and an unreachable origin does not block creating one", async () => {
  const { root, service } = await clone();
  git(root, "remote", "set-url", "origin", join(root, "gone"));
  await writeFile(join(root, "tracked.txt"), "local\n");
  git(root, "switch", "--quiet", "-c", "local-base");
  git(root, "commit", "--quiet", "-am", "local");
  git(root, "switch", "--quiet", "main");
  const local = await service.createWorktree(root, "wb/from-local", "refs/heads/local-base");
  assert.equal(git(local.path, "rev-parse", "HEAD"), git(root, "rev-parse", "local-base"));
  const offline = await service.createWorktree(root, "wb/offline", "refs/remotes/origin/main");
  assert.equal(git(offline.path, "rev-parse", "HEAD"), git(root, "rev-parse", "origin/main"));
  assert.equal((await service.baseBranches(root, true)).defaultRef, "refs/remotes/origin/main");
});

test("rejects a worktree base that is not an existing branch", async () => {
  const { root, service } = await clone();
  await assert.rejects(service.createWorktree(root, "wb/a", "--orphan"), /Choose a branch/);
  await assert.rejects(service.createWorktree(root, "wb/b", "HEAD~1"), /Choose a branch/);
  await assert.rejects(service.createWorktree(root, "wb/c", "refs/heads/gone"), /"gone" no longer exists/);
});

test("checks out a selected branch and refuses to carry uncommitted changes across", async () => {
  const { root } = await repository();
  const service = new SourceControlService([new GitSourceControlProvider()]);
  git(root, "branch", "feature/chosen");
  assert.deepEqual(await service.branches(root), ["feature/chosen", "main"]);
  await service.checkout(root, "feature/chosen");
  assert.equal((await service.status(root)).branch, "feature/chosen");
  await writeFile(join(root, "tracked.txt"), "keep my edits");
  await assert.rejects(service.checkout(root, "main"), /Commit your changes/);
  assert.equal((await service.status(root)).branch, "feature/chosen");
  await assert.rejects(service.checkout(root, "--force"), /Invalid branch/);
});

test("remote branches open as local tracking branches", async () => {
  const { root } = await repository();
  git(root, "remote", "add", "origin", root);
  git(root, "update-ref", "refs/remotes/origin/feature/remote", "HEAD");
  const service = new SourceControlService([new GitSourceControlProvider()]);
  assert.ok((await service.branches(root)).includes("origin/feature/remote"));
  await service.checkout(root, "origin/feature/remote");
  assert.equal((await service.status(root)).branch, "feature/remote");
  assert.equal((await service.status(root)).upstream, "origin/feature/remote");
});

test("a file at the last commit or where the branch left the default branch; ignored folders", async () => {
  const { root } = await repository();
  await writeFile(join(root, ".gitignore"), "dist/\n");
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "out.js"), "x\n");
  git(root, "add", ".gitignore");
  git(root, "commit", "--quiet", "-m", "ignore");
  git(root, "switch", "--quiet", "-c", "feature");
  await writeFile(join(root, "tracked.txt"), "two\n");
  git(root, "commit", "--quiet", "-am", "on feature");
  await writeFile(join(root, "tracked.txt"), "changed\n");
  const provider = new GitSourceControlProvider();
  assert.equal(await provider.fileAt(root, "tracked.txt", "head"), "two\n");
  assert.equal(await provider.fileAt(root, "tracked.txt", "default"), "one\n");
  assert.equal(await provider.fileAt(root, "new.txt", "head"), null);
  await assert.rejects(provider.fileAt(root, "../x", "head"), /relative/);
  assert.deepEqual(await provider.ignored(root), ["dist"]);
});

test("fileAt and search use paths relative to a workspace below the repository top", async () => {
  const { root } = await repository();
  await mkdir(join(root, "pkg"));
  await writeFile(join(root, "pkg", "kart.ts"), "export const steer = 1;\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "pkg");
  const provider = new GitSourceControlProvider();
  const workspace = join(root, "pkg");
  assert.equal(await provider.fileAt(workspace, "kart.ts", "head"), "export const steer = 1;\n");
  assert.deepEqual((await provider.search(workspace, "steer", {})).matches.map((match) => match.path), ["kart.ts"]);
});

test("searches inside tracked and untracked files, skipping ignored ones", async () => {
  const { root } = await repository();
  await writeFile(join(root, ".gitignore"), "dist/\n");
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "out.js"), "steer\n");
  await writeFile(join(root, "kart.ts"), "export const steer = 0.4;\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "kart");
  await writeFile(join(root, "untracked.ts"), "const STEER = 1;\n");
  const service = new SourceControlService([new GitSourceControlProvider()]);
  const found = await service.search(root, "steer", {});
  assert.deepEqual(found.matches.map((match) => `${match.path}:${match.line}`).sort(), ["kart.ts:1", "untracked.ts:1"]);
  assert.equal(found.limited, false);
  assert.deepEqual((await service.search(root, "steer", { caseSensitive: true })).matches.map((match) => match.path), ["kart.ts"]);
  assert.deepEqual((await service.search(root, "-e", {})).matches, []);
  assert.deepEqual((await service.search(root, "nothing-matches-this", {})).matches, []);
  assert.equal(parseGrep("a.ts\u00001\u0000x\nb.ts\u00002\u0000y\n", 1).length, 1);
});

const objectCount = (root) => git(root, "count-objects", "-v");
const pending = (root) => new GitSourceControlProvider().pendingChanges(root);

test("pendingChanges describes everything a commit would include and leaves the repository alone", async () => {
  const { root } = await repository();
  await writeFile(join(root, "gone.txt"), "bye\n");
  await writeFile(join(root, "moved.txt"), "line\n".repeat(30));
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "more");
  await writeFile(join(root, "tracked.txt"), "two\n");
  await writeFile(join(root, "new file.txt"), "brand new\n");
  await rm(join(root, "gone.txt"));
  await rename(join(root, "moved.txt"), join(root, "renamed.txt"));
  await symlink("/etc/hosts", join(root, "link"));
  const statusBefore = git(root, "status", "--porcelain=v2");
  const objectsBefore = objectCount(root);
  const { summary, diff, truncated } = await pending(root);
  assert.equal(truncated, false);
  assert.match(summary, /tracked\.txt/);
  assert.match(summary, /new file\.txt/);
  assert.match(summary, /gone\.txt/);
  assert.match(summary, /moved\.txt => renamed\.txt|\{moved => renamed\}\.txt/);
  assert.match(diff, /^\+two$/m);
  assert.match(diff, /^\+brand new$/m);
  assert.match(diff, /^-bye$/m);
  assert.match(diff, /^rename from moved\.txt$/m);
  assert.match(diff, /^\+\/etc\/hosts$/m, "a symlink is its target's path, not the file it points to");
  assert.doesNotMatch(diff, /localhost/);
  assert.equal(git(root, "status", "--porcelain=v2"), statusBefore);
  assert.equal(objectCount(root), objectsBefore);
});

test("pendingChanges works before the first commit and with nothing to describe", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "workbench-git-")));
  execFileSync("git", ["init", "--quiet", "-b", "main", parent]);
  await writeFile(join(parent, "first.txt"), "hello\n");
  const unborn = await pending(parent);
  assert.match(unborn.summary, /first\.txt/);
  assert.match(unborn.diff, /^\+hello$/m);
  const { root } = await repository();
  assert.deepEqual(await pending(root), { summary: "", diff: "", truncated: false });
});

test("pendingChanges covers the whole repository from a subfolder", async () => {
  const { root } = await repository();
  await mkdir(join(root, "sub"));
  await writeFile(join(root, "sub/inner.txt"), "inner\n");
  await writeFile(join(root, "tracked.txt"), "outer change\n");
  const { diff } = await pending(join(root, "sub"));
  assert.match(diff, /^\+inner$/m);
  assert.match(diff, /^\+outer change$/m);
});

test("pendingChanges names secret files without sending their contents", async () => {
  const { root } = await repository();
  await mkdir(join(root, "config"));
  await writeFile(join(root, ".env"), "API_KEY=hunter2\n");
  await writeFile(join(root, "config/.env.local"), "OTHER=hunter3\n");
  await writeFile(join(root, "config/server.pem"), "PRIVATE hunter4\n");
  await writeFile(join(root, "id.key"), "PRIVATE hunter5\n");
  await writeFile(join(root, "tracked.txt"), "visible\n");
  const { summary, diff } = await pending(root);
  for (const name of [".env", ".env.local", "server.pem", "id.key"]) assert.ok(summary.includes(name), name);
  assert.doesNotMatch(diff, /hunter/);
  assert.match(diff, /^\+visible$/m);
});

test("pendingChanges caps a large change so the other files still fit", async () => {
  const { root } = await repository();
  await writeFile(join(root, "a-huge.txt"), "padding line of text\n".repeat(50_000));
  await writeFile(join(root, "tracked.txt"), "small change\n");
  const { diff, truncated } = await pending(root);
  assert.equal(truncated, true);
  assert.ok(diff.length < 50_000);
  assert.match(diff, /^\+small change$/m);
  assert.match(diff, /rest of this file's changes omitted/);
});

test("capDiff limits each file and the total", () => {
  const section = (name, size) => `diff --git a/${name} b/${name}\n${"+".repeat(size)}\n`;
  assert.deepEqual(capDiff(section("a", 5), 100, 1000), { diff: section("a", 5), truncated: false });
  const stopped = capDiff(section("a", 80) + section("b", 80) + section("c", 80), 200, 200);
  assert.equal(stopped.truncated, true);
  assert.ok(stopped.diff.includes("b/a") && stopped.diff.includes("b/b") && !stopped.diff.includes("b/c"));
});

test("pendingChanges sees a same-size edit made right after the last commit", async () => {
  const { root } = await repository();
  await writeFile(join(root, "tracked.txt"), "two\n");
  // Git only re-reads a file whose time isn't older than the index's, so the scratch copy must keep the index's time.
  await new Promise((done) => setTimeout(done, 1500));
  assert.match((await pending(root)).diff, /^\+two$/m);
});
