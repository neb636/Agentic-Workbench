import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import filesModule from "../dist-electron/main/workspace-files.js";

const { WorkspaceFiles, WorkspaceRoots, contentHash, isWatchedChange, matchScore, worktreeContainer } = filesModule;

async function fixture() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "workbench-files-")));
  const root = join(parent, "repo");
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "node_modules", "dep"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Hello\n");
  await writeFile(join(root, "src", "app.ts"), "export const app = 1;\n");
  await writeFile(join(root, "src", "nested", "mapping-config.ts"), "x\n");
  await writeFile(join(root, "node_modules", "dep", "mapping.js"), "x\n");
  await writeFile(join(root, "binary.bin"), Buffer.from([1, 2, 0, 3]));
  await writeFile(join(parent, "secret.txt"), "secret\n");
  await symlink(join(parent, "secret.txt"), join(root, "escape.txt"));
  const roots = new WorkspaceRoots();
  roots.replace([root]);
  return { parent, root, roots, files: new WorkspaceFiles(roots) };
}

test("lists directories first and hides .git", async () => {
  const { root, files } = await fixture();
  const entries = await files.list(root, "");
  assert.deepEqual(entries.map((entry) => `${entry.kind}:${entry.name}`), [
    "directory:node_modules", "directory:src", "file:binary.bin", "file:README.md",
  ]);
  assert.deepEqual((await files.list(root, "src")).map((entry) => entry.path), ["src/nested", "src/app.ts"]);
});

test("reads text, flags binary, and caps large files", async () => {
  const { root, files } = await fixture();
  assert.deepEqual(await files.read(root, "README.md"), { path: "README.md", content: "# Hello\n", size: 8, truncated: false, binary: false, hash: "6927d6085806d0d0a22404d0c2b23b55fb0663a7" });
  assert.equal((await files.read(root, "binary.bin")).binary, true);
  await writeFile(join(root, "large.txt"), "a".repeat(2 * 1024 * 1024 + 10));
  const large = await files.read(root, "large.txt");
  assert.equal(large.truncated, true);
  assert.equal(large.content.length, 2 * 1024 * 1024);
});

test("rejects paths and symlinks that escape the workspace", async () => {
  const { root, parent, files } = await fixture();
  await assert.rejects(files.read(root, "../secret.txt"), /outside the workspace/);
  await assert.rejects(files.read(root, "escape.txt"), /outside the workspace/);
  await assert.rejects(files.read(root, join(parent, "secret.txt")), /relative/);
  await assert.rejects(files.list(parent, ""), /not part of a workspace/);
});

test("allows worktrees created beside a workspace", async () => {
  const { root, roots } = await fixture();
  assert.equal(roots.isAllowed(join(worktreeContainer(root), "feature")), true);
  assert.equal(roots.isAllowed(worktreeContainer(root)), false);
  assert.equal(roots.isAllowed(`${root}-other`), false);
});

test("finds files by name before path, skipping dependencies", async () => {
  const { root, files } = await fixture();
  assert.deepEqual(await files.find(root, "mapping"), ["src/nested/mapping-config.ts"]);
  assert.deepEqual(await files.find(root, "app"), ["src/app.ts", "src/nested/mapping-config.ts"]);
  assert.deepEqual(await files.find(root, "  "), []);
  assert.ok(matchScore("src/app.ts", "app.ts") > matchScore("src/app.ts", "sapts"));
  assert.equal(matchScore("src/app.ts", "zzz"), 0);
});

async function editable() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "workbench-edit-")));
  const root = join(parent, "repo");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "kart.ts"), "export const steer = 0.4;\nexport const slide = 2;\n");
  await writeFile(join(parent, "secret.txt"), "secret\n");
  await symlink(join(parent, "secret.txt"), join(root, "escape.txt"));
  const roots = new WorkspaceRoots();
  roots.replace([root]);
  const trashed = [];
  return { parent, root, trashed, files: new WorkspaceFiles(roots, async (target) => { trashed.push(target); }) };
}

test("saves only over the version that was opened", async () => {
  const { root, files } = await editable();
  const opened = await files.read(root, "src/kart.ts");
  const saved = await files.write(root, "src/kart.ts", "export const steer = 0.3;\n", opened.hash);
  assert.equal(saved.ok, true);
  assert.equal(await readFile(join(root, "src", "kart.ts"), "utf8"), "export const steer = 0.3;\n");
  assert.equal(saved.hash, contentHash(Buffer.from("export const steer = 0.3;\n")));
  // Something else edits it meanwhile: a save with the old hash writes nothing and hands back the disk version.
  await writeFile(join(root, "src", "kart.ts"), "agent version\n");
  const stale = await files.write(root, "src/kart.ts", "mine\n", saved.hash);
  assert.equal(stale.ok, false);
  assert.equal(stale.disk.content, "agent version\n");
  assert.equal(await readFile(join(root, "src", "kart.ts"), "utf8"), "agent version\n");
  // A new file only with a null hash, and never over an existing one.
  assert.equal((await files.write(root, "src/new.ts", "x\n", null)).ok, true);
  assert.equal((await files.write(root, "src/new.ts", "y\n", null)).ok, false);
});

test("refuses writes outside the root, into .git, binary or too big", async () => {
  const { root, files } = await editable();
  await assert.rejects(files.write(root, "../secret.txt", "x", null), /outside the workspace/);
  await assert.rejects(files.write(root, "escape.txt", "x", null), /outside the workspace/);
  await assert.rejects(files.write(root, "/etc/hosts", "x", null), /relative/);
  await mkdir(join(root, ".git"));
  await assert.rejects(files.write(root, ".git/config", "x", null), /\.git/);
  await assert.rejects(files.write(root, "src/bin.ts", "a\u0000b", null), /text/);
  await assert.rejects(files.write(root, "src/big.ts", "a".repeat(2 * 1024 * 1024 + 1), null), /2 MB/);
  assert.equal(await readFile(join(root, "..", "secret.txt"), "utf8"), "secret\n");
});

test("create, rename and trash stay inside the root", async () => {
  const { root, files, trashed } = await editable();
  await files.create(root, "src/levels", "directory");
  await files.create(root, "src/levels/one.ts", "file");
  await assert.rejects(files.create(root, "src/levels/one.ts", "file"), /EEXIST/);
  await files.rename(root, "src/levels/one.ts", "src/levels/two.ts");
  await assert.rejects(files.rename(root, "src/levels/two.ts", "../moved.ts"), /outside the workspace/);
  await assert.rejects(files.rename(root, "src/levels/two.ts", "src/kart.ts"), /already exists/);
  await files.trash(root, "src/levels/two.ts");
  assert.deepEqual(trashed, [join(root, "src", "levels", "two.ts")]);
  await assert.rejects(files.trash(root, ""), /workspace itself/);
  await assert.rejects(files.trash(root, "../secret.txt"), /outside the workspace/);
  assert.deepEqual(await files.exists(root, ["src/kart.ts", "src/nope.ts", "../secret.txt", "src"]), ["src/kart.ts"]);
});

test("an edit landing while a save is written is never overwritten; competing saves serialize", async () => {
  const { root, files } = await editable();
  const opened = await files.read(root, "src/kart.ts");
  // Two saves of the same opened version: the first wins, the second finds the file moved on.
  const [first, second] = await Promise.all([files.write(root, "src/kart.ts", "one\n", opened.hash), files.write(root, "src/kart.ts", "two\n", opened.hash)]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(await readFile(join(root, "src", "kart.ts"), "utf8"), "one\n");
  // An outside write after the check but before the replace: the save backs off.
  const fsPromises = (await import("node:fs")).promises;
  const original = fsPromises.writeFile;
  fsPromises.writeFile = async (...args) => { await original(...args); if (String(args[0]).includes(".workbench-")) await original(join(root, "src", "kart.ts"), "agent\n"); };
  try {
    const raced = await files.write(root, "src/kart.ts", "mine\n", first.hash);
    assert.equal(raced.ok, false);
    assert.equal(raced.disk.content, "agent\n");
  } finally { fsPromises.writeFile = original; }
  assert.equal(await readFile(join(root, "src", "kart.ts"), "utf8"), "agent\n");
});

test("trash and rename act on a symlink itself, not its target", async () => {
  const { root, files, trashed } = await editable();
  await symlink(join(root, "src"), join(root, "alias"));
  await files.trash(root, "alias");
  assert.deepEqual(trashed, [join(root, "alias")]);
  await files.rename(root, "alias", "alias2");
  assert.equal((await readFile(join(root, "alias2", "kart.ts"), "utf8")).includes("steer"), true);
  assert.equal((await readFile(join(root, "src", "kart.ts"), "utf8")).includes("steer"), true);
  // The escaping link can be removed as a link, never its outside target.
  await files.trash(root, "escape.txt");
  assert.equal(trashed.at(-1), join(root, "escape.txt"));
});

test("pictures come back as data URLs; other files are refused", async () => {
  const { root, files } = await editable();
  await writeFile(join(root, "dot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(await files.image(root, "dot.png"), "data:image/png;base64,iVBORw==");
  await assert.rejects(files.image(root, "src/kart.ts"), /picture/);
  await assert.rejects(files.image(root, "../secret.txt"), /outside the workspace/);
});

test("the watcher ignores build output and git internals that don't change status", () => {
  assert.equal(isWatchedChange("src/app.ts"), true);
  assert.equal(isWatchedChange("node_modules/dep/index.js"), false);
  assert.equal(isWatchedChange("packages/a/dist/out.js"), false);
  assert.equal(isWatchedChange(".DS_Store"), false);
  assert.equal(isWatchedChange(".git/index"), true);
  assert.equal(isWatchedChange(".git/refs/heads/main"), true);
  assert.equal(isWatchedChange(".git/objects/ab/cdef"), false);
  assert.equal(isWatchedChange(""), true);
});

test("paths in terminal output become links relative to the session folder", async () => {
  const { pathsInLine } = (await import("../dist-electron/shared/terminal-paths.js")).default;
  const found = (text) => pathsInLine(text, "/repo").map(({ path, line }) => (line ? `${path}:${line}` : path));
  assert.deepEqual(found("Edited src/app.ts:42 and ./README.md"), ["src/app.ts:42", "README.md"]);
  assert.deepEqual(found("see /repo/src/main.tsx:3:9 or /other/x.ts"), ["src/main.tsx:3"]);
  assert.deepEqual(found("version 1.2.3 and ../outside.ts"), []);
  const [link] = pathsInLine("  at (src/app.ts:7)", "/repo");
  assert.equal("  at (src/app.ts:7)".slice(link.start, link.start + link.length), "src/app.ts:7");
});
