import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import filesModule from "../dist-electron/main/workspace-files.js";

const { WorkspaceFiles, WorkspaceRoots, matchScore, worktreeContainer } = filesModule;

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
