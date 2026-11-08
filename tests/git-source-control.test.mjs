import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import gitModule from "../dist-electron/main/providers/git-source-control-provider.js";
import serviceModule from "../dist-electron/main/source-control/source-control-provider.js";

const { GitSourceControlProvider, isValidBranchName, parseGrep, parsePorcelainV2 } = gitModule;
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
