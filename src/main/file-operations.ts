import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { FileEffect, FileHistoryState, FileLocation, FileOperation, FileOperationResult, FileOperationProgress } from "../shared/file-operations";
import { isInside, resolveEntry, resolveInside, resolveNew, WorkspaceFiles, WorkspaceRoots } from "./workspace-files";

type Step = { source?: FileLocation; target: FileLocation; hash: string; bytes: number; stash?: string };
type Entry = { label: string; steps: Step[] };
const overlaps = (a: FileLocation, b: FileLocation) => a.root === b.root && (a.path === b.path || a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`));
const exists = (file: string) => fs.lstat(file).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });

/** Serialized, window-owned filesystem commands. History never crosses a renderer boundary. */
export class FileOperations {
  private undo: Entry[] = [];
  private redo: Entry[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private roots: WorkspaceRoots, private files: WorkspaceFiles, private cache: string, private maxEntries = 50, private maxBytes = 256 * 1024 * 1024, private progress: (progress: FileOperationProgress) => void = () => undefined) {}

  run(operation: FileOperation): Promise<FileOperationResult> {
    const next = this.queue.then(() => this.execute(operation));
    this.queue = next.catch(() => undefined);
    return next;
  }
  async dispose(): Promise<void> { await this.queue; await fs.rm(this.cache, { recursive: true, force: true }); }
  private state(): FileHistoryState {
    const paths = (entry?: Entry) => entry?.steps.flatMap((s) => [...(s.source ? [s.source] : []), s.target]) ?? [];
    const label = (entry?: Entry) => entry ? `${entry.label} ${entry.steps.length === 1 ? path.posix.basename(entry.steps[0].target.path) : `${entry.steps.length} items`}` : undefined;
    return { undo: label(this.undo.at(-1)), redo: label(this.redo.at(-1)), undoPaths: paths(this.undo.at(-1)), redoPaths: paths(this.redo.at(-1)) };
  }
  private async location(location: FileLocation, fresh = false): Promise<string> {
    const base = await this.roots.resolve(location.root);
    const absolute = await (fresh ? resolveNew(base, location.path) : resolveEntry(base, location.path));
    if (absolute === base || path.relative(base, absolute).split(path.sep).includes(".git")) throw new Error("Workspace roots and .git cannot be changed.");
    return absolute;
  }
  private async fingerprint(file: string): Promise<{ hash: string; bytes: number }> {
    const hash = createHash("sha256"); let bytes = 0;
    const walk = async (target: string) => {
      const stat = await fs.lstat(target);
      hash.update(`${stat.mode}:`);
      if (stat.isSymbolicLink()) hash.update(`link:${await fs.readlink(target)}`);
      else if (stat.isDirectory()) {
        for (const name of (await fs.readdir(target)).sort()) { hash.update(`name:${name.length}:${name}`); await walk(path.join(target, name)); }
      } else if (stat.isFile()) {
        bytes += stat.size; hash.update(`file:${stat.size}:`);
        for await (const chunk of createReadStream(target)) hash.update(chunk);
      } else throw new Error("Only regular files, folders, and symbolic links are supported.");
    };
    await walk(file); return { hash: hash.digest("hex"), bytes };
  }
  private async check(file: string, expected: string): Promise<void> {
    if ((await this.fingerprint(file)).hash !== expected) throw new Error("Files changed since this operation. No newer work was overwritten.");
  }
  private async validateLinks(source: string, target: string, sourceBase: string, targetBase: string, checkSource = true): Promise<void> {
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) {
      const real = checkSource ? await fs.realpath(source) : sourceBase;
      const link = await fs.readlink(source);
      const mapped = path.resolve(path.dirname(target), link);
      let ancestor = mapped;
      while (!await exists(ancestor)) ancestor = path.dirname(ancestor);
      const resolvedAncestor = await fs.realpath(ancestor);
      if ((resolvedAncestor !== targetBase && !isInside(resolvedAncestor, targetBase)) || (real !== sourceBase && !isInside(real, sourceBase)) || (mapped !== targetBase && !isInside(mapped, targetBase))) throw new Error("A symbolic link would escape its workspace.");
    } else if (stat.isDirectory()) {
      for (const name of await fs.readdir(source)) {
        if (name === ".git") throw new Error("Folders containing .git cannot be copied or moved.");
        await this.validateLinks(path.join(source, name), path.join(target, name), sourceBase, targetBase, checkSource);
      }
    } else if (!stat.isFile()) throw new Error("Special filesystem entries cannot be copied.");
  }
  /** Copy off to the side first: read failures and changing sources never publish a partial destination. */
  private async copy(source: string, target: string, hash: string): Promise<void> {
    if (await exists(target)) throw new Error("Destination already exists.");
    const staging = await fs.mkdtemp(path.join(path.dirname(target), ".workbench-transfer-"));
    const staged = path.join(staging, "entry");
    try {
      await fs.cp(source, staged, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
      await this.check(source, hash); await this.check(staged, hash);
      if (await exists(target)) throw new Error("Destination appeared while copying. Nothing was replaced.");
      await fs.rename(staged, target);
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  private async relocate(source: string, target: string, hash: string): Promise<void> {
    if (await exists(target)) throw new Error("Destination already exists.");
    await this.check(source, hash);
    if (await exists(target)) throw new Error("Destination appeared while validating the move. Nothing was replaced.");
    try { await fs.rename(source, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await this.copy(source, target, hash);
      try {
        await this.check(source, hash); await this.check(target, hash);
      } catch (error) {
        // Validation failed before source deletion began. Remove only our unchanged copy.
        try { await this.check(target, hash); await fs.rm(target, { recursive: true }); }
        catch { throw new Error(`Move could not finish; a changed copy remains at ${target}. ${String(error)}`, { cause: error }); }
        throw error;
      }
      try { await fs.rm(source, { recursive: true }); }
      catch (error) {
        // Recursive removal can fail after deleting children. The destination may now be their only copy.
        throw new Error(`Source removal could not finish; the source may be incomplete. The destination copy remains at ${target}. ${String(error)}`, { cause: error });
      }
    }
  }
  private async drop(entries: Entry[]): Promise<void> {
    for (const step of entries.flatMap((e) => e.steps)) if (step.stash) await fs.rm(step.stash, { recursive: true, force: true });
  }
  private async trim(): Promise<void> {
    while (this.undo.length + this.redo.length > this.maxEntries) await this.drop([this.undo.shift() ?? this.redo.shift()!]);
    const size = () => [...this.undo, ...this.redo].flatMap((e) => e.steps).reduce((n, s) => n + (s.stash ? s.bytes : 0), 0);
    while (size() > this.maxBytes && this.redo.length) await this.drop([this.redo.shift()!]);
  }
  private async execute(operation: FileOperation): Promise<FileOperationResult> {
    const effects: FileEffect[] = [], errors: string[] = [];
    if (operation.kind === "status") return { ...this.state(), effects, errors };
    if (operation.kind === "undo" || operation.kind === "redo") {
      const reversing = operation.kind === "undo";
      const stack = reversing ? this.undo : this.redo, other = reversing ? this.redo : this.undo;
      const entry = stack.at(-1);
      if (!entry) return { ...this.state(), effects, errors };
      const steps = reversing ? [...entry.steps].reverse() : entry.steps;
      // Check the entire group before changing any member.
      for (const step of steps) {
        const from = reversing ? step.target : step.source;
        const source = from ? await this.location(from) : step.stash!;
        await this.check(source, step.hash);
        const to = reversing ? step.source : step.target;
        if (to && await exists(await this.location(to, true))) throw new Error("Undo/Redo destination already exists.");
        if (to) await this.validateLinks(source, await this.location(to, true), from ? await this.roots.resolve(from.root) : this.cache, await this.roots.resolve(to.root), Boolean(from));
      }
      const completed: Step[] = [];
      for (const step of steps) {
        this.progress({ completed: completed.length, total: steps.length, path: step.target.path });
        try {
          if (reversing && !step.source) {
            await fs.mkdir(this.cache, { recursive: true });
            const stash = path.join(this.cache, randomUUID());
            await this.relocate(await this.location(step.target), stash, step.hash); step.stash = stash;
            effects.push({ source: step.target, removed: true });
          } else {
            const from = reversing ? step.target : step.source;
            const to = reversing ? step.source! : step.target;
            await this.relocate(from ? await this.location(from) : step.stash!, await this.location(to, true), step.hash);
            if (!from) step.stash = undefined;
            effects.push({ ...(from ? { source: from } : {}), target: to });
          }
          completed.push(step);
        } catch (error) { errors.push(String(error)); break; }
      }
      if (completed.length) {
        entry.steps = entry.steps.filter((s) => !completed.includes(s));
        if (!entry.steps.length) stack.pop();
        other.push({ label: entry.label, steps: reversing ? completed.reverse() : completed });
      }
    } else {
      const steps: Step[] = [];
      const label = operation.kind === "transfer" ? operation.move ? "Move" : "Copy" : operation.kind === "create" ? "Create" : operation.kind === "rename" ? "Rename" : operation.kind === "trash" ? "Trash" : "Duplicate";
      if (operation.kind === "create") {
        await this.location(operation.target, true);
        await this.files.create(operation.target.root, operation.target.path, operation.entryKind);
        steps.push({ target: operation.target, ...await this.fingerprint(await this.location(operation.target)) });
        effects.push({ target: operation.target });
      } else if (operation.kind === "rename") {
        if (operation.source.root !== operation.target.root) throw new Error("Rename must stay in its workspace.");
        const source = await this.location(operation.source), target = await this.location(operation.target, true);
        const fingerprint = await this.fingerprint(source);
        if (isInside(target, source)) throw new Error("A folder cannot be moved into itself.");
        await this.validateLinks(source, target, await this.roots.resolve(operation.source.root), await this.roots.resolve(operation.target.root));
        await this.relocate(source, target, fingerprint.hash);
        steps.push({ source: operation.source, target: operation.target, ...fingerprint }); effects.push({ source: operation.source, target: operation.target });
      } else {
        const sources = operation.sources.filter((s, index, all) => !all.some((p, i) => i !== index && p.root === s.root && (s.path.startsWith(`${p.path}/`) || (s.path === p.path && i < index))));
        for (const [index, source] of sources.entries()) {
          this.progress({ completed: index, total: sources.length, path: source.path });
          try {
            const absolute = await this.location(source);
            if (operation.kind === "trash") {
              await this.files.trash(source.root, source.path);
              for (const stack of [this.undo, this.redo]) {
                const removed = stack.filter((e) => e.steps.some((s) => overlaps(s.target, source) || (s.source && overlaps(s.source, source))));
                await this.drop(removed); for (const item of removed) stack.splice(stack.indexOf(item), 1);
              }
              effects.push({ source, removed: true }); continue;
            }
            const destination = operation.kind === "duplicate" ? { root: source.root, path: path.posix.dirname(source.path) === "." ? "" : path.posix.dirname(source.path) } : operation.destination;
            const base = await this.roots.resolve(destination.root);
            const folder = await resolveInside(base, destination.path);
            let name = path.basename(absolute), target = path.join(folder, name);
            if (target === absolute && operation.kind === "transfer" && operation.move) continue;
            if (isInside(target, absolute)) throw new Error("A folder cannot be copied or moved into itself.");
            if (await exists(target)) {
              if (operation.kind === "transfer" && operation.collision === "skip") continue;
              if (operation.kind === "transfer" && operation.collision === "error") throw new Error(`Destination already exists: ${name}`);
              const extension = (await fs.lstat(absolute)).isDirectory() ? "" : path.extname(name), stem = name.slice(0, name.length - extension.length);
              for (let n = 1; await exists(target); n++) { name = `${stem} copy${n === 1 ? "" : ` ${n}`}${extension}`; target = path.join(folder, name); }
            }
            const location = { root: destination.root, path: path.relative(base, target).split(path.sep).join("/") };
            await this.location(location, true);
            await this.validateLinks(absolute, target, await this.roots.resolve(source.root), base);
            const fingerprint = await this.fingerprint(absolute);
            const move = operation.kind === "transfer" && operation.move;
            if (move) await this.relocate(absolute, target, fingerprint.hash);
            else await this.copy(absolute, target, fingerprint.hash);
            steps.push({ ...(move ? { source } : {}), target: location, ...fingerprint });
            effects.push({ ...(move ? { source } : {}), target: location });
          } catch (error) { errors.push(`${source.path}: ${String(error)}`); }
        }
      }
      if (effects.length) { await this.drop(this.redo); this.redo = []; }
      if (steps.length) this.undo.push({ label, steps });
    }
    this.files.invalidate(); await this.trim();
    return { ...this.state(), effects, errors };
  }
}
