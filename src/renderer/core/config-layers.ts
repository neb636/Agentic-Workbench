import { create } from "zustand";
import { APP_DIR } from "../../shared/app-identity";
import type { ConfigDocument, ConfigLayers, ConfigName, ConfigScope } from "../../shared/dimsum";
import { watchWorkspace } from "./workspace-watch";
import { errorMessage } from "./errors";

/**
 * Layered documents (`~/.dimsum/<name>.json`, `<workspace>/.dimsum/<name>.json`, `<workspace>/.dimsum/<name>.local.json`)
 * as last read, by document and workspace. Reading one starts keeping it current: it reloads when its files change.
 */
export const useConfigLayers = create<Record<string, ConfigLayers>>(() => ({}));

const keyOf = (name: ConfigName, root?: string) => `${name}\0${root ?? ""}`;
const tracked = new Map<string, { name: ConfigName; root?: string }>();
const reads = new Map<string, number>();
const watching = new Map<string, () => void>();
let userWatch: (() => void) | undefined;
/** Folders whose changes may change a layer: the current one and the one shared instructions used to live in. */
const WATCHED = [APP_DIR, ".workbench"];

export function layersOf(name: ConfigName, root?: string): ConfigLayers | undefined {
  const key = keyOf(name, root);
  if (!tracked.has(key)) void loadConfig(name, root);
  return useConfigLayers.getState()[key];
}

export async function loadConfig(name: ConfigName, root?: string): Promise<ConfigLayers> {
  const key = keyOf(name, root);
  track(name, root);
  const read = (reads.get(key) ?? 0) + 1;
  reads.set(key, read);
  let layers: ConfigLayers;
  try { layers = await window.workbench.config.read(name, root); }
  catch (error) {
    const failed: ConfigDocument = { status: "invalid", error: errorMessage(error), path: "" };
    layers = { user: failed, ...(root ? { workspace: failed, local: failed } : {}) };
  }
  // A newer read started while this one waited: it has the fresher answer.
  if (reads.get(key) === read) useConfigLayers.setState({ [key]: layers });
  return layers;
}

function track(name: ConfigName, root?: string): void {
  const key = keyOf(name, root);
  if (tracked.has(key)) return;
  tracked.set(key, { name, root });
  userWatch ??= window.workbench.config.onUserChanged(() => { for (const entry of tracked.values()) void loadConfig(entry.name, entry.root); });
  if (root && !watching.has(root)) {
    watching.set(root, watchWorkspace(root, (event) => {
      if (!event.paths.some((path) => path === "" || WATCHED.some((folder) => path === folder || path.startsWith(`${folder}/`)))) return;
      for (const entry of tracked.values()) if (entry.root === root) void loadConfig(entry.name, entry.root);
    }));
  }
}

/** Stops keeping a workspace's documents current (its workspace was removed). */
export function forgetConfig(root: string): void {
  watching.get(root)?.();
  watching.delete(root);
  for (const [key, entry] of tracked) if (entry.root === root) tracked.delete(key);
}

/** The document a layer holds; undefined when its file is missing, loading, or unreadable. */
export function layerValue<T>(layers: ConfigLayers | undefined, scope: ConfigScope): T | undefined {
  const document = layers?.[scope];
  return document?.status === "ok" ? document.value as T : undefined;
}

/**
 * Rewrites one layer with `update` applied to its current value (undefined for a missing file). Writes only over the
 * version last read: when the file changed on disk meanwhile, nothing is written, it is reloaded, and an error comes back.
 */
export async function saveConfig<T>(name: ConfigName, scope: ConfigScope, root: string | undefined, update: (current: T | undefined) => T): Promise<string | undefined> {
  const layerRoot = scope === "user" ? undefined : root;
  if (scope !== "user" && !root) return "This layer belongs to a workspace.";
  const layers = useConfigLayers.getState()[keyOf(name, root)] ?? await loadConfig(name, root);
  const document = layers[scope];
  const where = document?.path || (scope === "user" ? `~/${APP_DIR}/${name}.json` : `${APP_DIR}/${name}${scope === "local" ? ".local" : ""}.json`);
  if (document?.status === "invalid") return `Fix ${where} first: ${document.error}`;
  // The legacy file is never written; the first save creates the new one beside it.
  const legacy = scope === "workspace" && layers.legacyWorkspace;
  try {
    const result = await window.workbench.config.write(name, scope, layerRoot, update(document?.value as T | undefined), legacy ? null : document?.hash ?? null);
    await loadConfig(name, root);
    return result.ok ? undefined : `${where} changed on disk and was reloaded. Try again.`;
  } catch (error) {
    return errorMessage(error);
  }
}
