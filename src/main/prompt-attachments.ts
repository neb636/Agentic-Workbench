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
  /** `shrink` makes a thumbnail data URL, or returns null for a picture it can't decode. */
  constructor(private readonly base: () => string, private readonly shrink: (bytes: Buffer) => string | null = () => null) {}

  private folder(viewId: string): string {
    if (!/^[\w-]+$/.test(viewId)) throw new Error("That isn't a view id.");
    return path.join(this.base(), viewId);
  }

  /** The view's folder, created if needed so a CLI can be granted it at launch. */
  folderFor(viewId: string): string {
    const folder = this.folder(viewId);
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  async save(viewId: string, name: string, bytes: Uint8Array): Promise<PromptAttachment> {
    const id = randomUUID();
    const safeName = safeAttachmentName(name);
    const folder = path.join(this.folderFor(viewId), id);
    await fs.mkdir(folder);
    const file = path.join(folder, safeName);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return { id, name: safeName, path: file, size: bytes.byteLength, image: Boolean(imageType(safeName)) };
  }

  async thumbnail(viewId: string, id: string): Promise<string | null> {
    const folder = path.join(this.folder(viewId), id);
    const [name] = await fs.readdir(folder).catch(() => []);
    const type = name ? imageType(name) : undefined;
    if (!name || !type) return null;
    const bytes = await fs.readFile(path.join(folder, name));
    return this.shrink(bytes) ?? (bytes.length <= ORIGINAL_PREVIEW_LIMIT ? `data:${type};base64,${bytes.toString("base64")}` : null);
  }

  /** Deletes the folders of views that no longer exist. */
  async retain(viewIds: string[]): Promise<void> {
    const keep = new Set(viewIds);
    const folders = await fs.readdir(this.base()).catch(() => []);
    await Promise.all(folders.filter((name) => !keep.has(name)).map((name) => fs.rm(path.join(this.base(), name), { recursive: true, force: true })));
  }
}
