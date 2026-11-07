import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ImageAttachment, ImageRunSnapshot } from "../shared/models";
import { imageRunManifestSchema } from "../shared/schemas";

const IMAGE_LIMIT = 25 * 1024 * 1024;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** Identifies an image by its bytes, so a renamed or mislabeled file cannot pass as an image. */
export function imageType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "png";
  if (starts(0xff, 0xd8, 0xff)) return "jpg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  return undefined;
}

/**
 * Image folders for image generator views: `<root>/<viewId>/` holds staged attachments and one
 * folder per run. The agent runs inside the view folder, and the renderer reaches only these files.
 */
export class ImageLibrary {
  constructor(readonly root: string) {}

  async folder(viewId: string): Promise<string> {
    const folder = path.join(this.root, viewId);
    await fs.mkdir(path.join(folder, "attachments"), { recursive: true });
    return fs.realpath(folder);
  }

  async importData(viewId: string, name: string, data: Uint8Array): Promise<ImageAttachment> {
    if (data.byteLength > IMAGE_LIMIT) throw new Error("Images must be 25 MB or smaller.");
    const type = imageType(data);
    if (!type) throw new Error("Only PNG, JPEG, WebP, and GIF images can be attached.");
    const file = `attachments/${randomUUID()}.${type}`;
    await fs.writeFile(path.join(await this.folder(viewId), file), data);
    return { id: randomUUID(), name: path.basename(name).slice(0, 120) || `image.${type}`, file };
  }

  /** Copies staged attachments into a new run folder as `source-N.<ext>`. */
  async prepareRun(viewId: string, runId: string, attachments: string[]): Promise<{ dir: string; sources: string[] }> {
    const folder = await this.folder(viewId);
    const dir = path.join(folder, runId);
    await fs.mkdir(dir);
    const sources: string[] = [];
    for (const [index, attachment] of attachments.entries()) {
      const from = await this.resolve(folder, attachment);
      const source = `source-${index + 1}${path.extname(from).toLowerCase()}`;
      await fs.copyFile(from, path.join(dir, source));
      sources.push(source);
    }
    return { dir, sources };
  }

  async inspectRun(viewId: string, runId: string): Promise<ImageRunSnapshot> {
    const dir = await this.resolve(await this.folder(viewId), runId);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = (await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const stats = await fs.stat(path.join(dir, entry.name));
      return { name: entry.name, size: stats.size, modifiedAt: stats.mtimeMs };
    }))).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.some((file) => file.name === "manifest.json")) return { files };
    try {
      const manifest = imageRunManifestSchema.parse(JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")));
      return { files, manifest };
    } catch (error) {
      // The agent may be mid-write; the next inspection usually succeeds.
      return { files, manifestError: error instanceof Error ? error.message : String(error) };
    }
  }

  async read(viewId: string, file: string): Promise<string> {
    const target = await this.resolve(await this.folder(viewId), file);
    const stats = await fs.stat(target);
    if (!stats.isFile() || stats.size > IMAGE_LIMIT) throw new Error("That image cannot be shown.");
    const bytes = await fs.readFile(target);
    const type = imageType(bytes);
    if (!type) throw new Error("That file is not a supported image.");
    return `data:${MIME[type]};base64,${bytes.toString("base64")}`;
  }

  async locate(viewId: string, file: string): Promise<string> {
    return this.resolve(await this.folder(viewId), file);
  }

  private async resolve(folder: string, relative: string): Promise<string> {
    if (path.isAbsolute(relative)) throw new Error("Image paths must be relative to the image folder.");
    const target = await fs.realpath(path.resolve(folder, relative));
    const inside = path.relative(folder, target);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("Path is outside the image folder.");
    return target;
  }
}
