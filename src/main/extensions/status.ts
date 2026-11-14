import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { EXTENSIONS_DIR, EXTENSION_STATUS_FILE } from "../../shared/app-identity";
import type { ExtensionStatusReport } from "../../shared/dimsum";
import { assertInsideRoot, ignorePersonalFiles } from "../config-layers";
import { layerFolder } from "./catalog";

/**
 * Writes `<layer folder>/extensions/<name>/.status.json`, so an agent that just saved the extension can read whether
 * it runs. It is a report, never configuration: nothing reads it back. An extension whose folder is gone gets no file,
 * and a workspace's is written only inside that workspace (and kept out of Git).
 */
export async function writeExtensionStatus(id: string, root: string | undefined, report: ExtensionStatusReport): Promise<void> {
  const workspace = id.startsWith("workspace:");
  const base = layerFolder(workspace ? "workspace" : "user", root);
  const folder = path.join(base, EXTENSIONS_DIR, id.slice(id.indexOf(":") + 1));
  const file = path.join(folder, EXTENSION_STATUS_FILE);
  if (workspace && root) await assertInsideRoot(root, file);
  if (!await fs.stat(folder).then((stat) => stat.isDirectory(), () => false)) return;
  if (workspace && root) await ignorePersonalFiles(base, root);
  const text = `${JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2)}\n`;
  // A fresh name, then a rename: a reader never sees half a file, and a link at the final path is replaced, not followed.
  const temporary = `${file}.${randomUUID()}.next`;
  await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
  try { await fs.rename(temporary, file); }
  catch (error) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw error; }
}
