import { randomUUID } from "node:crypto";
import { mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import type { PromptAttachment } from "../shared/models";
import { imageType } from "./workspace-files";

/** Twice the tile size, for sharp thumbnails on high-density displays. */
export const THUMBNAIL_SIDE = 160;
const ORIGINAL_PREVIEW_LIMIT = 2 * 1024 * 1024;
const NAME_LIMIT = 120;

/** Only letters, digits and plain punctuation: the name ends up in a prompt pasted into a terminal. */
export function safeAttachmentName(name: string): string {
  const cleaned = (name.split(/[\\/]/).pop() ?? "").replace(/[^\p{L}\p{N}\p{M} ._()+-]/gu, "_").replace(/^[. ]+/, "").trim();
  if (cleaned.length <= NAME_LIMIT) return cleaned || "attachment";
  const extension = path.extname(cleaned).slice(0, 16);
  return `${cleaned.slice(0, NAME_LIMIT - extension.length).trimEnd()}${extension}`;
}

/**
 * Files added to prompts, in `<base>/<view id>/<attachment id>/<name>`. They outlive the prompt because the agent reads
 * them while it works and may return to them later in the conversation; they go when their view is gone.
 */
export class PromptAttachments {
  private readonly touchedViews = new Set<string>();
  /** `shrink` makes a thumbnail data URL, or returns null for a picture it can't decode. */
  constructor(private readonly base: () => string, private readonly shrink: (bytes: Buffer) => string | null | Promise<string | null> = () => null) {}

  private folder(viewId: string): string {
    if (!/^[\w-]+$/.test(viewId)) throw new Error("That isn't a view id.");
    return path.join(this.base(), viewId);
  }

  /** The view's folder, created if needed so a CLI can be granted it at launch. */
  folderFor(viewId: string): string {
    const folder = this.folder(viewId);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    return folder;
  }

  async storageBytes(): Promise<number> {
    const walk = async (folder: string): Promise<number> => {
      const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
      let bytes = 0;
      for (const entry of entries) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) bytes += await walk(file);
        else if (entry.isFile()) bytes += (await fs.stat(file)).size;
      }
      return bytes;
    };
    return walk(this.base());
  }

  private writes: Promise<unknown> = Promise.resolve();
  save(viewId: string, name: string, bytes: Uint8Array): Promise<PromptAttachment> {
    const next = this.writes.catch(() => undefined).then(async () => {
      if (await this.storageBytes() + bytes.byteLength > 5 * 1024 * 1024 * 1024) throw new Error("Attachment storage exceeds 5 GB. Remove attachments for closed views in Settings.");
      return this.saveNow(viewId, name, bytes);
    });
    this.writes = next;
    return next;
  }

  private async saveNow(viewId: string, name: string, bytes: Uint8Array): Promise<PromptAttachment> {
    this.touchedViews.add(viewId);
    const id = randomUUID();
    const safeName = safeAttachmentName(name);
    const folder = path.join(this.folderFor(viewId), id);
    await fs.mkdir(folder, { mode: 0o700 });
    const file = path.join(folder, safeName);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return { id, name: safeName, path: file, size: bytes.byteLength, image: Boolean(imageType(safeName)) };
  }

  /** The stored file when it is a picture. Each attachment's folder holds just that one file. */
  private async picture(viewId: string, id: string): Promise<{ bytes: Buffer; dataUrl: () => string } | null> {
    const folder = path.join(this.folder(viewId), id);
    const [name] = await fs.readdir(folder).catch(() => []);
    const type = name ? imageType(name) : undefined;
    if (!name || !type) return null;
    const file = path.join(folder, name);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("Attachment preview exceeds 25 MB.");
    const bytes = await fs.readFile(file);
    return { bytes, dataUrl: () => `data:${type};base64,${bytes.toString("base64")}` };
  }

  async thumbnail(viewId: string, id: string): Promise<string | null> {
    const picture = await this.picture(viewId, id);
    if (!picture) return null;
    return (await this.shrink(picture.bytes)) ?? (picture.bytes.length <= ORIGINAL_PREVIEW_LIMIT ? picture.dataUrl() : null);
  }

  /** The picture at full size, for the preview. */
  async image(viewId: string, id: string): Promise<string | null> {
    return (await this.picture(viewId, id))?.dataUrl() ?? null;
  }

  /** Deletes the folders of views that no longer exist. */
  async retain(viewIds: string[], preserveRecent = false): Promise<void> {
    const keep = new Set([...viewIds, ...(preserveRecent ? this.touchedViews : [])]);
    const folders = await fs.readdir(this.base()).catch(() => []);
    await Promise.all(folders.filter((name) => !keep.has(name)).map((name) => fs.rm(path.join(this.base(), name), { recursive: true, force: true })));
  }
}
