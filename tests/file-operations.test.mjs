import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, writeFile, symlink, lstat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import filesModule from "../dist-electron/main/workspace-files.js";
import operationsModule from "../dist-electron/main/file-operations.js";
const { WorkspaceRoots, WorkspaceFiles } = filesModule;
const { FileOperations } = operationsModule;
async function fixture(options = []) {
  const folder = await mkdtemp(join(tmpdir(), "wb-operations-"));
  const root = join(folder, "a"), other = join(folder, "b");
  await mkdir(join(root, "src"), { recursive: true }); await mkdir(other);
  await writeFile(join(root, "src", "one.txt"), "first\n");
  const roots = new WorkspaceRoots(); roots.replace([root, other]);
  const files = new WorkspaceFiles(roots, async (target) => { const { rm } = await import("node:fs/promises"); await rm(target, { recursive: true }); });
  return { root, other, files, operations: new FileOperations(roots, files, join(folder, "history"), ...options), loc: (path, base = root) => ({ root: base, path }) };
}
test("recursive copy, grouped undo and redo across workspaces", async () => {
  const { root, other, operations, loc } = await fixture();
  const copy = await operations.run({ kind: "transfer", sources: [loc("src"), loc("src/one.txt")], destination: loc("", other), move: false, collision: "error" });
  assert.deepEqual(copy.errors, []); assert.equal(copy.effects.length, 1);
  assert.equal(await readFile(join(other, "src/one.txt"), "utf8"), "first\n");
  await operations.run({ kind: "undo" }); await assert.rejects(lstat(join(other, "src")));
  await writeFile(join(root, "src/one.txt"), "source changed");
  await operations.run({ kind: "redo" });
  assert.equal(await readFile(join(other, "src/one.txt"), "utf8"), "first\n");
  await operations.dispose();
});
test("rename and move history rejects external changes and occupied destinations", async () => {
  const { root, operations, loc } = await fixture();
  await operations.run({ kind: "rename", source: loc("src/one.txt"), target: loc("renamed.txt") });
  await writeFile(join(root, "renamed.txt"), "agent edit");
  await assert.rejects(operations.run({ kind: "undo" }), /changed/);
  assert.equal(await readFile(join(root, "renamed.txt"), "utf8"), "agent edit");
  await writeFile(join(root, "renamed.txt"), "first\n");
  await writeFile(join(root, "src/one.txt"), "other file");
  await assert.rejects(operations.run({ kind: "undo" }), /already exists/);
  await operations.dispose();
});
test("collisions, unique duplication, descendant rejection, and partial outcomes", async () => {
  const { root, operations, loc } = await fixture();
  await operations.run({ kind: "duplicate", sources: [loc("src/one.txt"), loc("missing.txt")] });
  assert.equal(await readFile(join(root, "src/one copy.txt"), "utf8"), "first\n");
  const skipped = await operations.run({ kind: "transfer", sources: [loc("src/one.txt")], destination: loc("src"), move: false, collision: "skip" });
  assert.equal(skipped.effects.length, 0);
  const bad = await operations.run({ kind: "transfer", sources: [loc("src")], destination: loc("src"), move: true, collision: "error" });
  assert.match(bad.errors[0], /itself/);
  await assert.rejects(operations.run({ kind: "rename", source: loc("src"), target: loc("src/nested") }), /itself/);
  await operations.dispose();
});
test("undo creation, redo invalidation, limits, and trash invalidation", async () => {
  const { root, operations, loc } = await fixture([2, 1]);
  await operations.run({ kind: "create", target: loc("empty"), entryKind: "directory" });
  await operations.run({ kind: "undo" }); await operations.run({ kind: "redo" });
  assert.ok((await lstat(join(root, "empty"))).isDirectory());
  await operations.run({ kind: "duplicate", sources: [loc("src/one.txt")] });
  const undone = await operations.run({ kind: "undo" }); assert.equal(undone.redo, undefined, "payloads above retention limit are evicted");
  await operations.run({ kind: "create", target: loc("new"), entryKind: "file" });
  await operations.run({ kind: "trash", sources: [loc("new")] });
  const history = await operations.run({ kind: "status" }); assert.ok(!history.undo?.includes("new"));
  await operations.dispose();
});
test("boundary protection and symlinks are validated without dereferencing copies", async () => {
  const { root, other, operations, loc } = await fixture();
  await mkdir(join(root, ".git")); await writeFile(join(root, ".git/config"), "private");
  await assert.rejects(operations.run({ kind: "rename", source: loc(".git/config"), target: loc("config") }), /\.git/);
  await assert.rejects(operations.run({ kind: "create", target: loc("../escape"), entryKind: "file" }), /outside/);
  await assert.rejects(operations.run({ kind: "trash", sources: [loc("")] }).then((r) => { if (r.errors.length) throw Error(r.errors[0]); }), /roots/);
  await symlink("one.txt", join(root, "src/link"));
  const copied = await operations.run({ kind: "transfer", sources: [loc("src")], destination: loc("", other), move: false, collision: "error" });
  assert.deepEqual(copied.errors, []); assert.ok((await lstat(join(other, "src/link"))).isSymbolicLink());
  await operations.run({ kind: "undo" }); await operations.run({ kind: "redo" });
  assert.ok((await lstat(join(other, "src/link"))).isSymbolicLink());
  await symlink("../../b", join(root, "src/escape"));
  const rejected = await operations.run({ kind: "duplicate", sources: [loc("src")] }); assert.match(rejected.errors[0], /symbolic link/);
  assert.ok(!(await readdir(root)).includes("src copy"));
  await operations.dispose();
});
test("folder search works without a source-control provider and remains scoped", async () => {
  const { root, files } = await fixture();
  await writeFile(join(root, "outside.txt"), "first\n");
  const result = await files.search(root, "first", { directory: "src" });
  assert.deepEqual(result.matches.map((m) => m.path), ["src/one.txt"]);
  await assert.rejects(files.search(root, "x", { directory: "../" }), /outside/);
});

test("terminal directory validation accepts canonical aliases and refuses escaping links", async () => {
  const { root, other } = await fixture();
  const roots = new WorkspaceRoots(); roots.replace([root]);
  assert.equal(await roots.directory(await realpath(join(root, "src"))), await realpath(join(root, "src")));
  await symlink(other, join(root, "outside"));
  await assert.rejects(roots.directory(join(root, "outside")), /outside/);
});
test("bulk history preflights every member and keeps new external contents", async () => {
  const { root, operations, loc } = await fixture();
  await writeFile(join(root, "second.txt"), "second");
  await operations.run({ kind: "duplicate", sources: [loc("src"), loc("second.txt")] });
  await writeFile(join(root, "src copy/new-agent-file"), "new work");
  await assert.rejects(operations.run({ kind: "undo" }), /changed/);
  assert.equal(await readFile(join(root, "second copy.txt"), "utf8"), "second");
  assert.equal(await readFile(join(root, "src copy/new-agent-file"), "utf8"), "new work");
  await operations.dispose();
});
test("history evicts oldest entries and a successful new operation clears redo", async () => {
  const { operations, loc } = await fixture([2]);
  for (const name of ["one", "two", "three"]) await operations.run({ kind: "create", target: loc(name), entryKind: "file" });
  await operations.run({ kind: "undo" });
  const oldest = await operations.run({ kind: "undo" }); assert.equal(oldest.undo, undefined);
  const reset = await operations.run({ kind: "create", target: loc("four"), entryKind: "file" }); assert.equal(reset.redo, undefined);
  await operations.dispose();
});

test("copy read failures do not publish partial destinations or retain staging folders", async () => {
  const { promises: fs } = await import("node:fs");
  const { root, operations, loc } = await fixture();
  const copy = fs.cp;
  fs.cp = async (_source, destination) => { await writeFile(destination, "partial"); throw new Error("EACCES: permission denied reading source"); };
  try {
    const result = await operations.run({ kind: "duplicate", sources: [loc("src/one.txt")] });
    assert.match(result.errors[0], /permission denied/); assert.equal(result.effects.length, 0);
    assert.ok(!(await readdir(join(root, "src"))).some((name) => name.startsWith(".workbench-transfer-") || name === "one copy.txt"));
  } finally { fs.cp = copy; await operations.dispose(); }
});

test("a cross-device move stops if the source changes after publication, retaining newer work", async () => {
  const { promises: fs } = await import("node:fs");
  const { root, other, operations, loc } = await fixture();
  const source = join(await realpath(root), "src/one.txt"), target = join(await realpath(other), "one.txt");
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (from === source) throw Object.assign(new Error("different device"), { code: "EXDEV" });
    const result = await rename(from, to);
    if (to === target) await writeFile(source, "new agent work");
    return result;
  };
  try {
    const result = await operations.run({ kind: "transfer", sources: [loc("src/one.txt")], destination: loc("", other), move: true, collision: "error" });
    assert.match(result.errors[0], /changed/); assert.equal(result.effects.length, 0);
    assert.equal(await readFile(source, "utf8"), "new agent work");
    await assert.rejects(lstat(target));
  } finally { fs.rename = rename; await operations.dispose(); }
});

for (const partial of [false, true]) test(`failed cross-device source removal retains the complete destination (${partial ? "partially deleted source" : "untouched source"})`, async () => {
  const { promises: fs } = await import("node:fs");
  const { root, other, operations, loc } = await fixture();
  await writeFile(join(root, "src/two.txt"), "second payload\n");
  const source = join(await realpath(root), "src"), target = join(await realpath(other), "src");
  const rename = fs.rename, remove = fs.rm;
  fs.rename = async (from, to) => {
    if (from === source) throw Object.assign(new Error("different device"), { code: "EXDEV" });
    return rename(from, to);
  };
  fs.rm = async (file, options) => {
    if (file === source) {
      if (partial) await remove(join(source, "one.txt"));
      throw Object.assign(new Error("permission denied removing source"), { code: "EACCES" });
    }
    return remove(file, options);
  };
  try {
    const result = await operations.run({ kind: "transfer", sources: [loc("src")], destination: loc("", other), move: true, collision: "error" });
    assert.equal(result.errors.length, 1);
    assert.equal(await readFile(join(target, "one.txt"), "utf8"), "first\n");
    assert.equal(await readFile(join(target, "two.txt"), "utf8"), "second payload\n");
    assert.equal(await readFile(join(source, "two.txt"), "utf8"), "second payload\n");
    if (partial) await assert.rejects(lstat(join(source, "one.txt")));
    else assert.equal(await readFile(join(source, "one.txt"), "utf8"), "first\n");
    assert.match(result.errors[0], /copy remains/);
    assert.equal(result.undo, undefined, "an incomplete move must not enter successful move history");
    assert.equal(result.effects.length, 0, "open editors must not be retargeted after an incomplete move");
  } finally { fs.rename = rename; fs.rm = remove; await operations.dispose(); }
});
