import { RegexSearch } from "./search-worker";
import { createHash } from "node:crypto";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { FileContent, FileEntry, FileWriteResult } from "../shared/models";

const HIDDEN = new Set([".git", ".DS_Store"]);
const SKIP_WHEN_SEARCHING = new Set([".git", "node_modules"]);
const READ_LIMIT = 2 * 1024 * 1024;
const LIST_LIMIT = 5_000;
const WALK_LIMIT = 50_000;
const INDEX_TTL = 10_000;
const WRITE_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon" };
// Build output and dependencies change by the thousand during installs and builds; nothing shows them live. Inside
// .git only what changes the status or branch: other worktrees' activity lands in .git/worktrees and objects.
const QUIET_FOLDERS = new Set(["node_modules", "dist", "dist-electron", "release", "test-results", "playwright-report", ".vite", ".cache"]);
const GIT_SIGNALS = /^\.git\/(HEAD|index|packed-refs|MERGE_HEAD|refs\/.*)$/;

/** The picture type for a file name, or undefined for anything that isn't a picture. */
export function imageType(file: string): string | undefined {
  return IMAGE_TYPES[file.slice(file.lastIndexOf(".") + 1).toLowerCase()];
}

export function contentHash(bytes: Buffer): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/** True for a changed path (relative, portable) that the file and source-control views care about. */
export function isWatchedChange(changed: string): boolean {
  if (!changed) return true;
  if (changed.split("/").some((part) => part.startsWith(".workbench-transfer-"))) return false;
  if (changed === ".DS_Store" || changed.endsWith("/.DS_Store")) return false;
  if (changed === ".git" || changed.startsWith(".git/")) return GIT_SIGNALS.test(changed);
  return !changed.split("/").some((segment) => QUIET_FOLDERS.has(segment));
}

export function isInside(target: string, base: string): boolean {
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function toPortable(relative: string): string {
  return relative.split(path.sep).join("/");
}

/** Worktrees for a workspace are created beside it, in `<workspace>-worktrees/`. */
export function worktreeContainer(root: string): string {
  return `${path.resolve(root)}-worktrees`;
}

/**
 * The directories the renderer may read from: workspace paths and the worktrees created
 * beside them. Every file or source-control request names one of these roots.
 */
export class WorkspaceRoots {
  private roots = new Set<string>();

  replace(paths: string[]): void {
    this.roots = new Set(paths.map((item) => path.resolve(item)));
  }

  add(root: string): void {
    this.roots.add(path.resolve(root));
  }

  isAllowed(root: string): boolean {
    const requested = path.resolve(root);
    return [...this.roots].some((allowed) => requested === allowed || isInside(requested, worktreeContainer(allowed)));
  }

  async directory(requested: string): Promise<string> {
    const absolute = await fs.realpath(path.resolve(requested));
    for (const root of this.roots) {
      const base = await fs.realpath(root).catch(() => undefined);
      if (!base) continue;
      if (absolute === base || isInside(absolute, base)) return absolute;
      const container = await fs.realpath(worktreeContainer(root)).catch(() => undefined);
      if (container && isInside(absolute, container)) return absolute;
    }
    throw new Error("Terminal folder is outside a workspace.");
  }

  async resolve(root: string): Promise<string> {
    if (!this.isAllowed(root)) throw new Error("That folder is not part of a workspace.");
    return fs.realpath(path.resolve(root));
  }
}

export async function resolveInside(base: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error("Paths must be relative to the workspace.");
  const target = await fs.realpath(path.resolve(base, relative || "."));
  if (target !== base && !isInside(target, base)) throw new Error("Path is outside the workspace.");
  return target;
}

export function isGitPath(base: string, absolute: string): boolean {
  return toPortable(path.relative(base, absolute)).split("/")[0] === ".git";
}

/** A path that may not exist yet (a new file, a rename target): its folder must exist inside the base. */
export async function resolveNew(base: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error("Paths must be relative to the workspace.");
  const target = path.resolve(base, relative);
  const name = path.basename(target);
  if (!name || name === "." || name === ".." || name === ".git" || name.includes("\0")) throw new Error("That name can't be used.");
  const parent = await fs.realpath(path.dirname(target));
  if (parent !== base && !isInside(parent, base)) throw new Error("Path is outside the workspace.");
  const resolved = path.join(parent, name);
  if (isGitPath(base, resolved)) throw new Error("The workbench never changes .git.");
  return resolved;
}

/** An existing entry itself (a symlink stays the link, not its target): its folder must be inside the base. */
export async function resolveEntry(base: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error("Paths must be relative to the workspace.");
  const target = path.resolve(base, relative || ".");
  if (target === base) return base;
  const parent = await fs.realpath(path.dirname(target));
  if (parent !== base && !isInside(parent, base)) throw new Error("Path is outside the workspace.");
  const entry = path.join(parent, path.basename(target));
  await fs.lstat(entry);
  return entry;
}

interface Watch {
  watcher: FSWatcher;
  listeners: Set<(paths: string[]) => void>;
  pending: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
}

export class WorkspaceFiles {
  private readonly indexes = new Map<string, { files: string[]; at: number }>();
  private readonly watches = new Map<string, Watch>();

  private readonly saving = new Map<string, Promise<FileWriteResult>>();

  /** `trashItem` moves a path to the system trash (Electron's shell.trashItem); tests pass their own. */
  constructor(
    private readonly roots: WorkspaceRoots,
    private readonly trashItem: (absolute: string) => Promise<void> = async () => { throw new Error("Trash is not available."); },
  ) {}

  async list(root: string, relative: string): Promise<FileEntry[]> {
    const base = await this.roots.resolve(root);
    const directory = await resolveInside(base, relative);
    const entries = (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => !HIDDEN.has(entry.name) && !entry.name.startsWith(".workbench-transfer-")).slice(0, LIST_LIMIT);
    const listed = await Promise.all(entries.map(async (entry): Promise<FileEntry | undefined> => {
      const absolute = path.join(directory, entry.name);
      try {
        if (entry.isSymbolicLink()) await resolveInside(base, path.relative(base, absolute));
        const stats = await fs.stat(absolute);
        if (!stats.isFile() && !stats.isDirectory()) return undefined;
        return { name: entry.name, path: toPortable(path.relative(base, absolute)), kind: stats.isDirectory() ? "directory" : "file", size: stats.isFile() ? stats.size : 0 };
      } catch { return undefined; }
    }));
    return listed.filter((entry): entry is FileEntry => Boolean(entry)).sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.kind === "directory" ? -1 : 1);
  }

  async read(root: string, relative: string): Promise<FileContent> {
    const base = await this.roots.resolve(root);
    const file = await resolveInside(base, relative);
    const stats = await fs.stat(file);
    if (!stats.isFile()) throw new Error("Only files can be opened.");
    const handle = await fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stats.size, READ_LIMIT));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      const binary = bytes.subarray(0, 8000).includes(0);
      return { path: toPortable(path.relative(base, file)), content: binary ? "" : bytes.toString("utf8"), size: stats.size, truncated: stats.size > bytesRead, binary, hash: contentHash(bytes) };
    } finally { await handle.close(); }
  }

  /**
   * Saves text inside the root, only over the version that was opened (`expectedHash`; null for a file that must not
   * exist yet). When the file changed on disk since, nothing is written and the disk version comes back instead.
   */
  async write(root: string, relative: string, content: string, expectedHash: string | null): Promise<FileWriteResult> {
    // One save per file at a time: a second save waits, then finds the hash moved on and returns a conflict.
    const key = `${root}\0${relative}`;
    const previous = this.saving.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.writeNow(root, relative, content, expectedHash));
    this.saving.set(key, next);
    try { return await next; } finally { if (this.saving.get(key) === next) this.saving.delete(key); }
  }

  private async writeNow(root: string, relative: string, content: string, expectedHash: string | null): Promise<FileWriteResult> {
    const base = await this.roots.resolve(root);
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > WRITE_LIMIT) throw new Error("Files over 2 MB can't be saved here.");
    if (bytes.subarray(0, 8000).includes(0)) throw new Error("Only text files can be saved here.");
    let file: string;
    try { file = await resolveInside(base, relative); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      file = await resolveNew(base, relative);
    }
    if (isGitPath(base, file)) throw new Error("The workbench never changes .git.");
    const current = await fs.stat(file).then((stats) => stats, () => undefined);
    if (current && !current.isFile()) throw new Error("Only files can be saved.");
    if (current && current.size > WRITE_LIMIT) throw new Error("Files over 2 MB can't be saved here.");
    const disk = current ? await fs.readFile(file) : undefined;
    if (disk ? contentHash(disk) !== expectedHash : expectedHash !== null) {
      return { ok: false, disk: disk ? await this.read(root, relative) : null };
    }
    if (disk?.subarray(0, 8000).includes(0)) throw new Error("Only text files can be saved here.");
    // Write beside it, then rename: a crash never leaves half a file, and the mode stays.
    const temporary = `${file}.workbench-${process.pid}-${Date.now()}`;
    await fs.writeFile(temporary, bytes, current ? { mode: current.mode } : {});
    // Check again right before replacing it: an agent may have written while the new version was being written.
    const now = await fs.readFile(file).then((value) => contentHash(value), () => null);
    if (now !== (disk ? contentHash(disk) : null)) {
      await fs.rm(temporary, { force: true });
      return { ok: false, disk: now === null ? null : await this.read(root, relative) };
    }
    await fs.rename(temporary, file).catch(async (error: unknown) => { await fs.rm(temporary, { force: true }); throw error; });
    this.indexes.delete(base);
    return { ok: true, hash: contentHash(bytes) };
  }

  /** A picture inside the root as a data URL. */
  async image(root: string, relative: string): Promise<string> {
    const base = await this.roots.resolve(root);
    const file = await resolveInside(base, relative);
    const type = imageType(file);
    if (!type) throw new Error("That file isn't a picture.");
    const stats = await fs.stat(file);
    if (!stats.isFile()) throw new Error("Only files can be opened.");
    if (stats.size > IMAGE_LIMIT) throw new Error("Pictures over 8 MB aren't shown.");
    return `data:${type};base64,${(await fs.readFile(file)).toString("base64")}`;
  }

  /** The paths in the list that are files inside the root. */
  async exists(root: string, paths: string[]): Promise<string[]> {
    const base = await this.roots.resolve(root);
    const found = await Promise.all(paths.map(async (relative) => {
      try { return (await fs.stat(await resolveInside(base, relative))).isFile() ? relative : undefined; } catch { return undefined; }
    }));
    return found.filter((item): item is string => Boolean(item));
  }

  async create(root: string, relative: string, kind: "file" | "directory"): Promise<void> {
    const base = await this.roots.resolve(root);
    const target = await resolveNew(base, relative);
    if (kind === "directory") await fs.mkdir(target);
    else await fs.writeFile(target, "", { flag: "wx" });
    this.indexes.delete(base);
  }

  async rename(root: string, from: string, to: string): Promise<void> {
    const base = await this.roots.resolve(root);
    const source = await resolveEntry(base, from);
    if (source === base) throw new Error("The workspace itself can't be renamed.");
    if (isGitPath(base, source)) throw new Error("The workbench never changes .git.");
    const target = await resolveNew(base, to);
    if (await fs.lstat(target).then(() => true, () => false)) throw new Error(`${to} already exists.`);
    await fs.rename(source, target);
    this.indexes.delete(base);
  }

  async trash(root: string, relative: string): Promise<void> {
    const base = await this.roots.resolve(root);
    const target = await resolveEntry(base, relative);
    if (target === base) throw new Error("The workspace itself can't be moved to the trash.");
    if (isGitPath(base, target)) throw new Error("The workbench never changes .git.");
    await this.trashItem(target);
    this.indexes.delete(base);
  }

  /** A validated display path, including a deleted entry whose ancestor still exists. */
  async absolutePath(root: string, relative: string): Promise<string> {
    const base = await this.roots.resolve(root);
    if (path.isAbsolute(relative)) throw new Error("Paths must be relative to the workspace.");
    const target = path.resolve(base, relative);
    if (target !== base && !isInside(target, base)) throw new Error("Path is outside the workspace.");
    let ancestor = target;
    while (true) {
      try { await resolveInside(base, path.relative(base, ancestor)); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    return target;
  }

  /** The absolute path of something inside the root (to reveal it in the system file manager). */
  async locate(root: string, relative: string): Promise<string> {
    return resolveInside(await this.roots.resolve(root), relative);
  }

  invalidate(): void { this.indexes.clear(); }

  async search(root: string, query: string, options: import("../shared/models").SearchOptions): Promise<import("../shared/models").SearchResult> {
    const base = await this.roots.resolve(root);
    const directory = options.directory ?? "";
    await resolveInside(base, directory);

    const needle = options.caseSensitive ? query : query.toLowerCase();
    const matches: import("../shared/models").SearchMatch[] = [];
    const start = Date.now();
    const expression = options.regex ? new RegexSearch(query, options.caseSensitive) : undefined;
    try {
      for (const file of await this.index(base)) {
        if (directory && !file.startsWith(`${directory}/`)) continue;
        if (Date.now() - start > 2000 || matches.length >= 500) return { matches, limited: true };
        const content = await this.read(root, file).catch(() => undefined);
        if (!content || content.binary || content.truncated) continue;
        const lines = content.content.split(/\r?\n/);
        const regexMatches = expression ? new Set(await expression.lines(lines)) : undefined;
        for (let i = 0; i < lines.length; i++) {
          if (regexMatches ? regexMatches.has(i) : (options.caseSensitive ? lines[i] : lines[i].toLowerCase()).includes(needle)) matches.push({ path: file, line: i + 1, text: lines[i] });
          if (matches.length >= 500) return { matches, limited: true };
        }
      }
      return { matches, limited: false };
    } finally { expression?.dispose(); }
  }

  async find(root: string, query: string, limit = 200): Promise<string[]> {
    const base = await this.roots.resolve(root);
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const files = await this.index(base);
    const scored: { file: string; score: number }[] = [];
    for (const file of files) {
      const score = matchScore(file.toLowerCase(), needle);
      if (score > 0) scored.push({ file, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.file.length - b.file.length).slice(0, limit).map((item) => item.file);
  }

  /** Watches a workspace root; listeners for the same root share one recursive watcher. */
  async watch(root: string, listener: (paths: string[]) => void): Promise<() => void> {
    const base = await this.roots.resolve(root);
    let entry = this.watches.get(base);
    if (!entry) {
      const created: Watch = { listeners: new Set(), pending: new Set(), watcher: watch(base, { recursive: true }, (_type, name) => {
        const changed = name ? toPortable(String(name)) : "";
        if (!isWatchedChange(changed)) return;
        created.pending.add(changed.startsWith(".git/") ? ".git" : changed);
        this.indexes.delete(base);
        clearTimeout(created.timer);
        created.timer = setTimeout(() => {
          const paths = [...created.pending]; created.pending.clear();
          created.listeners.forEach((notify) => notify(paths));
        }, 150);
      }) };
      created.watcher.on("error", (error) => console.warn("Workspace watcher failed", String(error)));
      this.watches.set(base, created);
      entry = created;
    }
    const active = entry;
    active.listeners.add(listener);
    return () => {
      active.listeners.delete(listener);
      if (active.listeners.size) return;
      clearTimeout(active.timer); active.watcher.close(); this.watches.delete(base);
    };
  }

  private async index(base: string): Promise<string[]> {
    const cached = this.indexes.get(base);
    if (cached && Date.now() - cached.at < INDEX_TTL) return cached.files;
    const files: string[] = [];
    const queue = [base];
    let visited = 0;
    while (queue.length && files.length < WALK_LIMIT && visited++ < WALK_LIMIT) {
      const directory = queue.shift()!;
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.name.startsWith(".workbench-transfer-") || SKIP_WHEN_SEARCHING.has(entry.name) || entry.name === ".DS_Store") continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) queue.push(absolute);
        else if (entry.isFile()) files.push(toPortable(path.relative(base, absolute)));
        if (files.length >= WALK_LIMIT) break;
      }
    }
    this.indexes.set(base, { files, at: Date.now() });
    return files;
  }
}

/** Ranks file-name matches above path matches above in-order character matches; zero means no match. */
export function matchScore(file: string, needle: string): number {
  const name = file.slice(file.lastIndexOf("/") + 1);
  if (name === needle) return 1000;
  if (name.startsWith(needle)) return 800;
  if (name.includes(needle)) return 600;
  if (file.includes(needle)) return 400;
  let position = 0;
  for (const character of needle) {
    position = file.indexOf(character, position);
    if (position < 0) return 0;
    position += 1;
  }
  return 100;
}
