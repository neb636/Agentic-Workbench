import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { WorkspaceFiles, WorkspaceRoots, contentHash, parseGrep } = require("../dist-electron/main/workspace-files.js");
const { GitSourceControlProvider } = require("../dist-electron/main/providers/git-source-control-provider.js");
const { migratePersistedState, persistedStateSchema } = require("../dist-electron/shared/schemas.js");

async function fixture({ git = false } = {}) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "studio-tabs-")));
  const root = join(parent, "repo");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "kart.ts"), "export const steer = 0.4;\nexport const slide = 2;\n");
  await writeFile(join(parent, "secret.txt"), "secret\n");
  await symlink(join(parent, "secret.txt"), join(root, "escape.txt"));
  if (git) {
    const run = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    run("init", "-q", "-b", "main"); run("config", "user.email", "t@t"); run("config", "user.name", "t");
    await writeFile(join(root, ".gitignore"), "dist/\n");
    await mkdir(join(root, "dist")); await writeFile(join(root, "dist", "out.js"), "steer\n");
    run("add", "-A"); run("commit", "-q", "-m", "first");
  }
  const roots = new WorkspaceRoots();
  roots.replace([root]);
  const trashed = [];
  return { parent, root, trashed, files: new WorkspaceFiles(roots, async (target) => { trashed.push(target); }) };
}

test("the game panel becomes a Game tab after the agent; Files and Commit changes move to the explorer", () => {
  const state = persistedStateSchema.parse(migratePersistedState({
    workspaces: [
      { id: "w1", name: "main", path: "/repo", activeViewId: "files1", game: { open: true, big: true, link: "#/world/nan" },
        views: [{ id: "a1", type: "agent", workspaceId: "w1", title: "Claude" }, { id: "t1", type: "terminal", workspaceId: "w1", title: "Ship" }, { id: "files1", type: "files", workspaceId: "w1", title: "Files" }] },
      { id: "w2", name: "x", path: "/repo-x", game: { open: false }, views: [{ id: "s1", type: "source-control", workspaceId: "w2", title: "Changes" }] },
    ],
    layout: { leftCollapsed: false, rightCollapsed: false, gameSize: 40, gameBigSize: 70 },
  }));
  const [main, other] = state.workspaces;
  assert.deepEqual(main.views.map((view) => view.type), ["agent", "game", "terminal"]);
  assert.equal(main.activeViewId, "a1");
  assert.deepEqual(main.game, { link: "#/world/nan" });
  assert.deepEqual(other.views, []);
  assert.deepEqual(other.game, {});
  assert.equal(state.layout.explorer.tab, "files");
  assert.equal(state.layout.explorer.collapsed, false);
  assert.equal("gameSize" in state.layout, false);
  // Running it again changes nothing (no second Game tab).
  assert.deepEqual(persistedStateSchema.parse(migratePersistedState(state)).workspaces[0].views.map((view) => view.type), ["agent", "game", "terminal"]);
});

test("saves only over the version that was opened", async () => {
  const { root, files } = await fixture();
  const opened = await files.read(root, "src/kart.ts");
  const saved = await files.write(root, "src/kart.ts", "export const steer = 0.3;\n", opened.hash);
  assert.equal(saved.ok, true);
  assert.equal(await readFile(join(root, "src", "kart.ts"), "utf8"), "export const steer = 0.3;\n");
  assert.equal(saved.hash, contentHash(Buffer.from("export const steer = 0.3;\n")));
  // An agent edits it meanwhile: a save with the old hash writes nothing and hands back the disk version.
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
  const { root, files } = await fixture();
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
  const { root, files, trashed } = await fixture();
  await files.create(root, "src/levels", "directory");
  await files.create(root, "src/levels/one.ts", "file");
  await assert.rejects(files.create(root, "src/levels/one.ts", "file"), /EEXIST/);
  await files.rename(root, "src/levels/one.ts", "src/levels/two.ts");
  await assert.rejects(files.rename(root, "src/levels/two.ts", "../moved.ts"), /outside the workspace/);
  await assert.rejects(files.rename(root, "src/levels/two.ts", "src/kart.ts"), /already exists/);
  await files.trash(root, "src/levels/two.ts");
  assert.deepEqual(trashed, [join(root, "src", "levels", "two.ts")]);
  await assert.rejects(files.trash(root, ""), /checkout itself/);
  await assert.rejects(files.trash(root, "../secret.txt"), /outside the workspace/);
  assert.deepEqual(await files.exists(root, ["src/kart.ts", "src/nope.ts", "../secret.txt", "src"]), ["src/kart.ts"]);
});

test("searches inside files with git grep, skipping ignored build output", async () => {
  const { root, files } = await fixture({ git: true });
  await writeFile(join(root, "src", "untracked.ts"), "const STEER = 1;\n");
  const found = await files.search(root, "steer", {});
  assert.deepEqual(found.matches.map((match) => `${match.path}:${match.line}`).sort(), ["src/kart.ts:1", "src/untracked.ts:1"]);
  assert.equal(found.limited, false);
  assert.deepEqual((await files.search(root, "steer", { caseSensitive: true })).matches.map((match) => match.path), ["src/kart.ts"]);
  assert.deepEqual((await files.search(root, "nothing-matches-this", {})).matches, []);
  assert.equal(parseGrep("a.ts\u00001\u0000x\nb.ts\u00002\u0000y\n", 1).length, 1);
});

test("a file at the last commit or where the branch left main; ignored folders", async () => {
  const { root } = await fixture({ git: true });
  const git = new GitSourceControlProvider();
  await writeFile(join(root, "src", "kart.ts"), "changed\n");
  assert.equal(await git.fileAt(root, "src/kart.ts", "head"), "export const steer = 0.4;\nexport const slide = 2;\n");
  assert.equal(await git.fileAt(root, "src/kart.ts", "main"), "export const steer = 0.4;\nexport const slide = 2;\n");
  assert.equal(await git.fileAt(root, "src/new.ts", "head"), null);
  await assert.rejects(git.fileAt(root, "../x", "head"), /relative/);
  assert.deepEqual(await git.ignored(root), ["dist"]);
});

test("an edit landing while a save is written is never overwritten; competing saves serialize", async () => {
  const { root, files } = await fixture();
  const opened = await files.read(root, "src/kart.ts");
  // Two saves of the same opened version: the first wins, the second finds the file moved on.
  const [first, second] = await Promise.all([files.write(root, "src/kart.ts", "one\n", opened.hash), files.write(root, "src/kart.ts", "two\n", opened.hash)]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(await readFile(join(root, "src", "kart.ts"), "utf8"), "one\n");
  // An outside write after the check but before the replace: the save backs off.
  const fsPromises = (await import("node:fs")).promises;
  const original = fsPromises.writeFile;
  fsPromises.writeFile = async (...args) => { await original(...args); if (String(args[0]).includes(".studio-")) await original(join(root, "src", "kart.ts"), "agent\n"); };
  try {
    const raced = await files.write(root, "src/kart.ts", "mine\n", first.hash);
    assert.equal(raced.ok, false);
    assert.equal(raced.disk.content, "agent\n");
  } finally { fsPromises.writeFile = original; }
  assert.equal(await readFile(join(root, "src", "kart.ts"), "utf8"), "agent\n");
});

test("trash and rename act on a symlink itself, not its target", async () => {
  const { root, files, trashed } = await fixture();
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
