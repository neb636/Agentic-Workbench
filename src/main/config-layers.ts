import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { APP_DIR, LOCAL_SUFFIX } from "../shared/app-identity";
import { assertInputBudget } from "../shared/input-budget";
import { CONFIG_DOCUMENTS, DIMSUM_IPC, type ConfigDocument, type ConfigLayers, type ConfigName, type ConfigScope, type ConfigWriteResult } from "../shared/dimsum";
import { contentHash } from "./workspace-files";
import { dimsumHome } from "./dimsum-home";

const READ_LIMIT = 2 * 1024 * 1024;
/** Where shared instructions lived before `.dimsum/`; still read until the workspace has the new file. */
const LEGACY = { instructions: path.join(".workbench", "instructions.json") } as Partial<Record<ConfigName, string>>;

/** The file for one layer of a document. Workspace and local layers need the (already granted) workspace folder. */
export function layerFile(name: ConfigName, scope: ConfigScope, root?: string): string {
  if (scope === "user") return path.join(dimsumHome(), `${name}.json`);
  if (!root) throw new Error(`The ${scope} layer belongs to a workspace.`);
  return path.join(root, APP_DIR, scope === "local" ? `${name}${LOCAL_SUFFIX}.json` : `${name}.json`);
}

async function readDocument(name: ConfigName, file: string): Promise<ConfigDocument | undefined> {
  let bytes: Buffer;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return { status: "invalid", error: "Not a file.", path: file };
    if (stat.size > READ_LIMIT) return { status: "invalid", error: "The file is larger than 2 MB.", path: file };
    bytes = await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return { status: "invalid", error: (error as Error).message, path: file };
  }
  const hash = contentHash(bytes);
  let json: unknown;
  try { json = JSON.parse(bytes.toString("utf8")); assertInputBudget(json); }
  catch (error) { return { status: "invalid", error: (error as Error).message, hash, path: file }; }
  const result = CONFIG_DOCUMENTS[name].safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { status: "invalid", error: `${issue.path.join(".") || "file"}: ${issue.message}`, hash, path: file };
  }
  return { status: "ok", value: result.data, hash, path: file };
}

export async function readLayers(name: ConfigName, root?: string): Promise<ConfigLayers> {
  const layers: ConfigLayers = { user: await readDocument(name, layerFile(name, "user")) };
  if (!root) return layers;
  layers.workspace = await readDocument(name, layerFile(name, "workspace", root));
  const legacy = LEGACY[name];
  if (!layers.workspace && legacy) {
    layers.workspace = await readDocument(name, path.join(root, legacy));
    layers.legacyWorkspace = Boolean(layers.workspace);
  }
  layers.local = await readDocument(name, layerFile(name, "local", root));
  return layers;
}

/** Writes are serialized per file, so two saves can't both pass the hash check. */
const writing = new Map<string, Promise<unknown>>();

/** Pretty, stable JSON, so a checked-in file's diffs are easy to review. */
export function serializeDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Saves one layer over the version last read (`expectedHash`; null: there must be no file yet). */
export async function writeLayer(name: ConfigName, scope: ConfigScope, root: string | undefined, value: unknown, expectedHash: string | null): Promise<ConfigWriteResult> {
  const parsed = CONFIG_DOCUMENTS[name].parse(value);
  const file = layerFile(name, scope, root);
  const previous = writing.get(file) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async (): Promise<ConfigWriteResult> => {
    const current = await fs.readFile(file).then(contentHash, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (current !== expectedHash) return { ok: false, reason: "changed" };
    const folder = path.dirname(file);
    await fs.mkdir(folder, { recursive: true, mode: scope === "user" ? 0o700 : 0o755 });
    if (scope === "local") await ignoreLocalFiles(folder);
    const text = serializeDocument(parsed);
    const temporary = `${file}.${process.pid}.next`;
    await fs.writeFile(temporary, text, { encoding: "utf8", mode: scope === "user" ? 0o600 : 0o644 });
    await fs.rename(temporary, file);
    return { ok: true, hash: contentHash(Buffer.from(text, "utf8")) };
  });
  writing.set(file, next);
  try { return await next; } finally { if (writing.get(file) === next) writing.delete(file); }
}

/**
 * A workspace's `.local` files are the person's own. The first one written leaves a `.gitignore` beside it: a plain
 * convention file most version-control tools honour, written once and never edited after.
 */
export async function ignoreLocalFiles(folder: string): Promise<void> {
  const ignore = path.join(folder, ".gitignore");
  try { await fs.writeFile(ignore, `# Personal settings (${APP_DIR}/*${LOCAL_SUFFIX}.*) stay on this machine.\n*${LOCAL_SUFFIX}.*\nnode_modules/\n`, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

let homeWatcher: FSWatcher | undefined;
let homeTimer: ReturnType<typeof setTimeout> | undefined;

/** Tells every window when anything in `~/.dimsum` changes, so instructions, settings and user extensions reload. */
export function watchDimsumHome(): void {
  if (homeWatcher) return;
  const notify = () => {
    clearTimeout(homeTimer);
    homeTimer = setTimeout(() => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send(DIMSUM_IPC.userChanged);
    }, 150);
  };
  const start = () => {
    try {
      homeWatcher = watch(dimsumHome(), { recursive: true }, notify);
      homeWatcher.on("error", () => { homeWatcher?.close(); homeWatcher = undefined; });
    } catch { /* No folder yet: watched once something creates it. */ }
  };
  void fs.mkdir(dimsumHome(), { recursive: true, mode: 0o700 }).catch(() => undefined).then(start);
}
