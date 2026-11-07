import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { TextEncoder } from "node:util";
import managerModule from "../dist-electron/main/agent-session-manager.js";
import claudeModule from "../dist-electron/main/providers/claude-agent-provider.js";
import codexModule from "../dist-electron/main/providers/codex-agent-provider.js";
import libraryModule from "../dist-electron/main/image-library.js";

const { AgentSessionManager } = managerModule;
const { ClaudeAgentProvider } = claudeModule;
const { CodexAgentProvider } = codexModule;
const { ImageLibrary, imageType } = libraryModule;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const owner = { isDestroyed: () => false, send: () => {} };

async function fixture() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "workbench-images-")));
  const root = join(parent, "image-generator");
  await mkdir(root);
  return { parent, root, library: new ImageLibrary(root) };
}

function manager(provider, profiles) {
  provider.executable = process.execPath;
  const spawned = [];
  const instance = new AgentSessionManager([provider], (_command, args) => {
    spawned.push(args);
    return { onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} };
  }, profiles);
  return { instance, spawned };
}

test("the Claude adapter turns a launch profile into native permission arguments", () => {
  const profile = { id: "p", root: "/", allowCommands: ["codex exec"], allowWritesInCwd: true };
  assert.deepEqual(new ClaudeAgentProvider().profileArgs(profile), ["--permission-mode", "acceptEdits", "--allowedTools", "Bash(codex exec *)"]);
  assert.deepEqual(new ClaudeAgentProvider().profileArgs({ ...profile, allowWritesInCwd: false, allowCommands: [] }), []);
  assert.equal(new CodexAgentProvider().profileArgs, undefined);
});

test("launch profiles apply only to known names, inside their folder, on adapters that support them", async () => {
  const { parent, root, library } = await fixture();
  const folder = await library.folder("view-1");
  const profiles = [{ id: "image-generator", root, allowCommands: ["codex exec"], allowWritesInCwd: true }];
  const claude = manager(new ClaudeAgentProvider(), profiles);
  const base = { providerId: "claude.cli", viewId: "view-1", cols: 80, rows: 24 };
  claude.instance.create({ ...base, workspacePath: folder, profile: "image-generator" }, owner);
  assert.deepEqual(claude.spawned[0], ["--permission-mode", "acceptEdits", "--allowedTools", "Bash(codex exec *)"]);
  assert.throws(() => claude.instance.create({ ...base, viewId: "v2", workspacePath: folder, profile: "anything" }, owner), /Unknown launch profile/);
  assert.throws(() => claude.instance.create({ ...base, viewId: "v3", workspacePath: parent, profile: "image-generator" }, owner), /only applies inside/);
  // A link inside the folder that points out of it does not count as inside.
  await symlink(parent, join(root, "escape"));
  assert.throws(() => claude.instance.create({ ...base, viewId: "v4", workspacePath: join(root, "escape"), profile: "image-generator" }, owner), /only applies inside/);
  const codex = manager(new CodexAgentProvider(), profiles);
  assert.throws(() => codex.instance.create({ ...base, providerId: "codex.cli", workspacePath: folder, profile: "image-generator" }, owner), /does not support launch profiles/);
  claude.instance.terminateAll();
});

test("attachments are identified by content and copied into runs as numbered sources", async () => {
  const { library } = await fixture();
  assert.equal(imageType(PNG), "png");
  assert.equal(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(imageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  await assert.rejects(library.importData("view-1", "notes.png", new TextEncoder().encode("not an image")), /Only PNG/);
  const attachment = await library.importData("view-1", "../../ref.png", PNG);
  assert.equal(attachment.name, "ref.png");
  assert.match(attachment.file, /^attachments\/[\w-]+\.png$/);
  const run = await library.prepareRun("view-1", "run-1", [attachment.file]);
  assert.deepEqual(run.sources, ["source-1.png"]);
  assert.deepEqual(new Uint8Array(await readFile(join(run.dir, "source-1.png"))), PNG);
  assert.match(await library.read("view-1", "run-1/source-1.png"), /^data:image\/png;base64,/);
  await assert.rejects(library.prepareRun("view-1", "run-1", []), /EEXIST/);
});

test("image reads stay inside the view folder", async () => {
  const { parent, library } = await fixture();
  await writeFile(join(parent, "secret.png"), PNG);
  const folder = await library.folder("view-1");
  await assert.rejects(library.read("view-1", "../../secret.png"), /outside the image folder/);
  await assert.rejects(library.read("view-1", join(parent, "secret.png")), /relative/);
  await assert.rejects(library.read("view-2", "../view-1/attachments"), /outside the image folder/);
  await symlink(join(parent, "secret.png"), join(folder, "link.png"));
  await assert.rejects(library.read("view-1", "link.png"), /outside the image folder/);
  await assert.rejects(library.prepareRun("view-1", "run-x", ["../../secret.png"]), /outside the image folder/);
});

test("run inspection lists files and validates the agent's manifest", async () => {
  const { library } = await fixture();
  const { dir } = await library.prepareRun("view-1", "run-1", []);
  assert.deepEqual(await library.inspectRun("view-1", "run-1"), { files: [] });
  await writeFile(join(dir, "manifest.json"), "{\"complete\": fal");
  assert.match((await library.inspectRun("view-1", "run-1")).manifestError, /JSON/);
  const manifest = { complete: false, variants: [{ index: 1, title: "Close", prompt: "A cat", sources: [], changes: "Kept as written.", status: "pending" }] };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "candidate-1.png"), PNG);
  const snapshot = await library.inspectRun("view-1", "run-1");
  assert.deepEqual(snapshot.manifest, manifest);
  assert.deepEqual(snapshot.files.map((file) => file.name), ["candidate-1.png", "manifest.json"]);
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ ...manifest, variants: [{ ...manifest.variants[0], status: "maybe" }] }));
  assert.ok((await library.inspectRun("view-1", "run-1")).manifestError);
});
