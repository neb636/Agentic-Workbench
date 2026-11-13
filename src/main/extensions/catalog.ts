import { promises as fs } from "node:fs";
import path from "node:path";
import { APP_DIR, EXTENSIONS_DIR } from "../../shared/app-identity";
import type { ExtensionListing } from "../../shared/dimsum";
import { dimsumHome } from "../dimsum-home";
import { isWorkspaceTrusted } from "../workspace-trust";

const ENTRIES = ["index.tsx", "index.ts", "index.jsx", "index.js"];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The folder a layer's extensions and settings live in: `~/.dimsum`, or `<workspace>/.dimsum`. */
export function layerFolder(layer: "user" | "workspace", root?: string): string {
  if (layer === "user") return dimsumHome();
  if (!root) throw new Error("Workspace extensions belong to a workspace.");
  return path.join(root, APP_DIR);
}

async function scan(layer: "user" | "workspace", root?: string): Promise<ExtensionListing[]> {
  const base = layerFolder(layer, root);
  const folder = path.join(base, EXTENSIONS_DIR);
  let names: string[];
  try { names = (await fs.readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory() && NAME.test(entry.name)).map((entry) => entry.name).sort(); }
  catch { return []; }
  const trusted = layer === "user" || Boolean(root && isWorkspaceTrusted(root));
  const found = await Promise.all(names.map(async (name): Promise<ExtensionListing | undefined> => {
    for (const file of ENTRIES) {
      const entry = path.join(folder, name, file);
      if (await fs.stat(entry).then((stat) => stat.isFile(), () => false)) {
        return { id: `${layer}:${name}`, name, layer, root, entry: path.relative(base, entry).split(path.sep).join("/"), trusted };
      }
    }
    return undefined;
  }));
  return found.filter((item): item is ExtensionListing => Boolean(item));
}

/** User extensions, and with `root` that workspace's. Listing reads names only: nothing runs. */
export async function listExtensions(root?: string): Promise<ExtensionListing[]> {
  return [...await scan("user"), ...(root ? await scan("workspace", root) : [])];
}

export async function findExtension(id: string, root?: string): Promise<ExtensionListing | undefined> {
  const layer = id.startsWith("workspace:") ? "workspace" : "user";
  return (await scan(layer, layer === "workspace" ? root : undefined)).find((item) => item.id === id);
}
