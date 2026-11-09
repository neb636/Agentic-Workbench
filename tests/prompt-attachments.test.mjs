import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, readdir, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import attachmentsModule from "../dist-electron/main/prompt-attachments.js";
import schemasModule from "../dist-electron/shared/schemas.js";
import promptModule from "../dist-electron/shared/prompt-attachments.js";

const { PromptAttachments, safeAttachmentName } = attachmentsModule;
const { attachmentSaveSchema, attachmentLocationSchema } = schemasModule;
const { attachmentsPrompt, MAX_ATTACHMENT_BYTES } = promptModule;
const fixture = async (shrink) => {
  const base = join(await realpath(await mkdtemp(join(tmpdir(), "workbench-attachments-"))), "attachments");
  return { base, attachments: new PromptAttachments(() => base, shrink) };
};
const bytes = (text) => new Uint8Array(Buffer.from(text));

test("attachment names stay plain, inside one folder, and bounded", () => {
  assert.equal(safeAttachmentName("Screen Shot (1).png"), "Screen Shot (1).png");
  assert.equal(safeAttachmentName("../../etc/passwd"), "passwd");
  assert.equal(safeAttachmentName("C:\\Users\\me\\notes.txt"), "notes.txt");
  assert.equal(safeAttachmentName("a\x1b[31m\nb.txt"), "a__31m_b.txt");
  assert.equal(safeAttachmentName("résumé 履歴.pdf"), "résumé 履歴.pdf");
  assert.equal(safeAttachmentName("..."), "attachment");
  assert.equal(safeAttachmentName(".env"), "env");
  const long = safeAttachmentName(`${"x".repeat(300)}.png`);
  assert.equal(long.length, 120);
  assert(long.endsWith(".png"));
});

test("a saved attachment keeps its bytes under the view's folder", async () => {
  const { base, attachments } = await fixture();
  const saved = await attachments.save("view-1", "notes.md", bytes("# hi"));
  assert.equal(saved.path, join(base, "view-1", saved.id, "notes.md"));
  assert.equal(await readFile(saved.path, "utf8"), "# hi");
  assert.equal(saved.size, 4);
  assert.equal(saved.image, false);
  assert.equal((await stat(saved.path)).mode & 0o777, 0o600);
  const again = await attachments.save("view-1", "notes.md", bytes("two"));
  assert.notEqual(again.path, saved.path);
});

test("a view id can never leave the attachments folder", async () => {
  const { attachments } = await fixture();
  await assert.rejects(attachments.save("../outside", "a.txt", bytes("x")), /view id/);
  await assert.rejects(attachments.thumbnail("..", "a"), /view id/);
  assert.throws(() => attachments.folderFor("a/b"), /view id/);
});

test("thumbnails shrink pictures, fall back to the original, and skip everything else", async () => {
  const shrunk = await fixture(() => "data:image/png;base64,small");
  const picture = await shrunk.attachments.save("v", "a.png", bytes("png"));
  assert.equal(await shrunk.attachments.thumbnail("v", picture.id), "data:image/png;base64,small");

  const { attachments } = await fixture(() => null);
  const svg = await attachments.save("v", "a.svg", bytes("<svg/>"));
  assert.equal(svg.image, true);
  assert.equal(await attachments.thumbnail("v", svg.id), `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`);
  const huge = await attachments.save("v", "b.webp", new Uint8Array(3 * 1024 * 1024));
  assert.equal(await attachments.thumbnail("v", huge.id), null);
  const text = await attachments.save("v", "c.txt", bytes("x"));
  assert.equal(await attachments.thumbnail("v", text.id), null);
  assert.equal(await attachments.thumbnail("v", "00000000-0000-4000-8000-000000000000"), null);
});

test("the preview gets the original picture, however large, and nothing else", async () => {
  const { attachments } = await fixture(() => "data:image/png;base64,small");
  const picture = await attachments.save("v", "a.png", bytes("png"));
  assert.equal(await attachments.image("v", picture.id), `data:image/png;base64,${Buffer.from("png").toString("base64")}`);
  const huge = await attachments.save("v", "b.webp", new Uint8Array(3 * 1024 * 1024));
  assert.equal((await attachments.image("v", huge.id)).startsWith("data:image/webp;base64,"), true);
  const text = await attachments.save("v", "c.txt", bytes("x"));
  assert.equal(await attachments.image("v", text.id), null);
  assert.equal(await attachments.image("v", "00000000-0000-4000-8000-000000000000"), null);
  await assert.rejects(attachments.image("..", "a"), /view id/);
});

test("only the folders of existing views are kept", async () => {
  const { base, attachments } = await fixture();
  await attachments.save("keep", "a.txt", bytes("a"));
  await attachments.save("closed", "b.txt", bytes("b"));
  await attachments.retain(["keep", "other"]);
  assert.deepEqual(await readdir(base), ["keep"]);
  await mkdir(join(base, "stray"));
  await attachments.retain(["keep"]);
  assert.deepEqual(await readdir(base), ["keep"]);
  await new PromptAttachments(() => join(base, "missing")).retain([]);
});

test("the prompt lists each attachment's path, one per line", () => {
  assert.equal(attachmentsPrompt([{ path: "/a/one two.png" }, { path: "/a/b.md" }]),
    "Attached files (read them from these paths):\n- /a/one two.png\n- /a/b.md");
});

test("the IPC schemas bound what a renderer can send", () => {
  const valid = { viewId: "v", name: "a.png", bytes: new Uint8Array(1) };
  assert.equal(attachmentSaveSchema.safeParse(valid).success, true);
  assert.equal(attachmentSaveSchema.safeParse({ ...valid, bytes: "text" }).success, false);
  assert.equal(attachmentSaveSchema.safeParse({ ...valid, bytes: { byteLength: MAX_ATTACHMENT_BYTES + 1, __proto__: Uint8Array.prototype } }).success, false);
  assert.equal(attachmentLocationSchema.safeParse({ viewId: "v", id: "../secret" }).success, false);
});
