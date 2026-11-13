import { create } from "zustand";
import type { ExtensionInfo } from "@dimsum/sdk";
import { APP_DIR, EXTENSIONS_DIR } from "../../shared/app-identity";
import type { DimsumSettings, ExtensionListing } from "../../shared/dimsum";
import { isFilesWorkspace } from "../../shared/files-workspace";
import type { Workspace } from "../../shared/models";
import { layersOf, layerValue, loadConfig, saveConfig, useConfigLayers } from "../core/config-layers";
import { errorMessage } from "../core/errors";
import { watchWorkspace } from "../core/workspace-watch";
import { useWorkbenchStore } from "../state/workbench-store";
import { activateExtension, deactivateExtension, extensionKey, useActiveExtensions } from "./host";
import { loadExtensionScript } from "./runtime";

/** What the Extensions panel shows for one installed extension in one workspace. */
export interface InstalledExtension extends ExtensionListing {
  /** Per workspace for workspace extensions; user extensions run once, for every workspace. */
  key: string;
  workspaceId?: string;
  disabled: boolean;
  state: "needs-trust" | "disabled" | "loading" | "active" | "failed";
  error?: string;
}

/** Installed extensions as last listed: user ones under "", workspace ones under their workspace id. */
export const useInstalledExtensions = create<{ byWorkspace: Record<string, ExtensionListing[]>; loading: Record<string, true>; errors: Record<string, string> }>(
  () => ({ byWorkspace: {}, loading: {}, errors: {} }));

const USER = "";
const listingKey = (listing: ExtensionListing, workspaceId?: string) => extensionKey({ id: listing.id, workspaceId: listing.layer === "workspace" ? workspaceId : undefined });

/** Extension ids turned off by any layer of `settings.json` that applies here. */
export function disabledExtensions(root?: string): Set<string> {
  const layers = layersOf("settings", root);
  return new Set((["user", "workspace", "local"] as const).flatMap((scope) => layerValue<DimsumSettings>(layers, scope)?.extensions?.disabled ?? []));
}

/** Turns an extension on or off for this person: a workspace extension in this workspace only, a user one everywhere. */
export function setExtensionEnabled(listing: ExtensionListing, enabled: boolean): Promise<string | undefined> {
  const scope = listing.layer === "workspace" ? "local" : "user";
  return saveConfig<DimsumSettings>("settings", scope, listing.root, (current) => {
    const disabled = new Set(current?.extensions?.disabled ?? []);
    if (enabled) disabled.delete(listing.id); else disabled.add(listing.id);
    return { ...current, version: 1, extensions: { ...current?.extensions, disabled: [...disabled].sort() } };
  });
}

const inflight = new Map<string, Promise<void>>();
/** Bumped when an extension stops being wanted, so a start still bundling for it never activates. */
const generations = new Map<string, number>();
const generationOf = (key: string) => generations.get(key) ?? 0;
/** A reload asked for while that extension was still starting: it runs again once the start settles. */
const reloadAfter = new Map<string, string | undefined>();
const stopWanting = (key: string) => { generations.set(key, generationOf(key) + 1); reloadAfter.delete(key); };
/** The workspace files each workspace extension was last built from (it may import code from anywhere in its workspace). */
const builtFrom = new Map<string, Set<string>>();
/** Whether a change touched a file one of this workspace's extensions was built from. */
const touchesBuiltFiles = (workspaceId: string, paths: string[]) => {
  for (const [key, inputs] of builtFrom) if (key.startsWith(`${workspaceId}|`) && paths.some((path) => inputs.has(path))) return true;
  return false;
};

/** Starts one extension, and starts it once more if a reload came in meanwhile (a newer save, or Reload). */
function launch(key: string, listing: ExtensionListing, workspace?: Workspace): void {
  const run = start(listing, workspace).finally(() => {
    inflight.delete(key);
    if (!reloadAfter.has(key)) return;
    const workspaceId = reloadAfter.get(key);
    reloadAfter.delete(key);
    const latest = workspaceId === undefined ? undefined : useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId);
    if (workspaceId !== undefined && !latest) return;
    void reconcile(latest, false, new Set([listing.id]));
  });
  inflight.set(key, run);
}

async function start(listing: ExtensionListing, workspace?: Workspace): Promise<void> {
  const info: ExtensionInfo = {
    id: listing.id, name: listing.name, layer: listing.layer,
    ...(listing.layer === "workspace" && workspace ? { workspaceId: workspace.id, root: workspace.path } : {}),
  };
  const key = extensionKey(info);
  const generation = generationOf(key);
  const stale = () => generationOf(key) !== generation;
  const loaded = await window.workbench.extensions.load(listing.id, listing.root).catch((error: unknown) => ({ ok: false as const, error: errorMessage(error) }));
  // A reload that fails keeps the version already running, and says why.
  const fail = (error: string) => {
    const running = useActiveExtensions.getState().records[key];
    useActiveExtensions.setState((state) => ({ records: { ...state.records, [key]: { key, info, title: running?.title ?? listing.name, description: running?.description, status: running?.status === "active" ? "active" : "failed", error } } }));
  };
  if (stale()) return;
  if (!loaded.ok) { fail(loaded.error); return; }
  if (listing.layer === "workspace") builtFrom.set(key, new Set(loaded.inputs));
  let definition;
  try { definition = await loadExtensionScript(loaded.url); }
  catch (error) { fail(errorMessage(error)); return; }
  // Trust was reset, it was turned off, or its workspace closed while it was loading.
  if (stale()) return;
  await activateExtension(definition, info);
}

/** Lists, and starts or stops, the extensions of one workspace (and the user's, with `workspace` undefined). */
async function reconcile(workspace: Workspace | undefined, relist: boolean, reload: Set<string> = new Set()): Promise<void> {
  const slot = workspace?.id ?? USER;
  const root = workspace?.path;
  let listings = useInstalledExtensions.getState().byWorkspace[slot];
  if (relist || !listings) {
    useInstalledExtensions.setState((state) => ({ loading: { ...state.loading, [slot]: true } }));
    try {
      listings = (await window.workbench.extensions.list(root)).filter((item) => (workspace ? item.layer === "workspace" : item.layer === "user"));
      useInstalledExtensions.setState((state) => { const { [slot]: _, ...errors } = state.errors; void _; return { byWorkspace: { ...state.byWorkspace, [slot]: listings ?? [] }, errors }; });
    } catch (error) {
      listings = [];
      useInstalledExtensions.setState((state) => ({ errors: { ...state.errors, [slot]: errorMessage(error) } }));
    } finally {
      useInstalledExtensions.setState((state) => { const { [slot]: _, ...loading } = state.loading; void _; return { loading }; });
    }
  }
  // Know what is turned off before starting anything, so a disabled extension never runs, not even briefly.
  if (!useConfigLayers.getState()[`settings\0${root ?? ""}`]) await loadConfig("settings", root);
  const disabled = disabledExtensions(root);
  const wanted = new Set<string>();
  for (const listing of listings) {
    const key = listingKey(listing, workspace?.id);
    if (!listing.trusted || disabled.has(listing.id)) continue;
    wanted.add(key);
    const record = useActiveExtensions.getState().records[key];
    if (record && !reload.has(listing.id) && record.status === "active") continue;
    if (record && !reload.has(listing.id) && record.status === "failed" && !relist) continue;
    if (inflight.has(key)) {
      // The running start may have bundled an older revision: build again when it is done.
      if (reload.has(listing.id)) reloadAfter.set(key, workspace?.id);
      continue;
    }
    launch(key, listing, workspace);
  }
  // Removed, turned off, or no longer trusted: stop it.
  for (const record of Object.values(useActiveExtensions.getState().records)) {
    if (record.info.layer === "builtin" || (record.info.workspaceId ?? USER) !== slot) continue;
    if (!wanted.has(record.key)) deactivateExtension(record.key);
  }
  for (const listing of listings) {
    const key = listingKey(listing, workspace?.id);
    if (!wanted.has(key) && inflight.has(key)) stopWanting(key);
  }
  await Promise.all([...inflight.values()]);
}

/** Every installed extension known for a workspace, with what it is doing there. */
export function installedFor(workspace: Workspace | undefined): InstalledExtension[] {
  const { byWorkspace } = useInstalledExtensions.getState();
  const records = useActiveExtensions.getState().records;
  const disabled = disabledExtensions(workspace && !isFilesWorkspace(workspace) ? workspace.path : undefined);
  const listings = [...(byWorkspace[USER] ?? []), ...(workspace ? byWorkspace[workspace.id] ?? [] : [])];
  return listings.map((listing) => {
    const workspaceId = listing.layer === "workspace" ? workspace?.id : undefined;
    const key = listingKey(listing, workspaceId);
    const record = records[key];
    const isDisabled = disabled.has(listing.id);
    const state: InstalledExtension["state"] = !listing.trusted ? "needs-trust" : isDisabled ? "disabled"
      : record?.status === "active" ? "active" : record?.status === "failed" ? "failed" : "loading";
    return { ...listing, key, workspaceId, disabled: isDisabled, state, error: record?.error };
  });
}

/** Asks the person to trust the workspace, then starts its extensions. */
export async function trustWorkspaceExtensions(workspace: Workspace): Promise<void> {
  await window.workbench.extensions.trust(workspace.path);
  // Trusting a repository also trusts its worktrees, which may be open as workspaces of their own.
  await relistWorkspaceExtensions();
}

/** Lists every open workspace again (after trust was granted or cleared), starting or stopping their extensions. */
export async function relistWorkspaceExtensions(): Promise<void> {
  await Promise.all(useWorkbenchStore.getState().workspaces.filter((item) => !isFilesWorkspace(item)).map((item) => reconcile(item, true)));
}

export async function reloadExtensions(workspace: Workspace | undefined): Promise<void> {
  const ids = new Set(Object.values(useActiveExtensions.getState().records).filter((record) => record.info.layer !== "builtin").map((record) => record.info.id));
  await reconcile(undefined, true, ids);
  if (workspace && !isFilesWorkspace(workspace)) await reconcile(workspace, true, ids);
}

/**
 * Keeps every workspace's extensions running while the workspace is open, and the user's always. A change under
 * `.dimsum/` reloads the extensions there (a syntax error keeps the last version that worked).
 */
export function startWorkspaceExtensions(): () => void {
  const watches = new Map<string, () => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const later = (slot: string, run: () => void) => { clearTimeout(timers.get(slot)); timers.set(slot, setTimeout(run, 200)); };
  const folders = () => useWorkbenchStore.getState().workspaces.filter((workspace) => !isFilesWorkspace(workspace));
  const changedIn = (paths: string[]) => paths.some((path) => path === "" || path === APP_DIR || path.startsWith(`${APP_DIR}/`));
  const reloadSlot = (workspace: Workspace | undefined) => {
    const slot = workspace?.id ?? USER;
    const ids = new Set((useInstalledExtensions.getState().byWorkspace[slot] ?? []).map((listing) => listing.id));
    void reconcile(workspace, true, ids);
  };
  let last = "";
  const sync = () => {
    if (!useWorkbenchStore.getState().isHydrated) return;
    const current = folders();
    const key = current.map((workspace) => `${workspace.id}\0${workspace.path}`).join("\n");
    if (key === last) return;
    last = key;
    for (const [workspaceId, stop] of watches) {
      if (current.some((workspace) => workspace.id === workspaceId)) continue;
      stop();
      watches.delete(workspaceId);
      for (const record of Object.values(useActiveExtensions.getState().records)) if (record.info.workspaceId === workspaceId) deactivateExtension(record.key);
      for (const key of inflight.keys()) if (key.startsWith(`${workspaceId}|`)) stopWanting(key);
      for (const key of builtFrom.keys()) if (key.startsWith(`${workspaceId}|`)) builtFrom.delete(key);
      useInstalledExtensions.setState((state) => { const { [workspaceId]: _, ...byWorkspace } = state.byWorkspace; void _; return { byWorkspace }; });
    }
    for (const workspace of current) {
      if (watches.has(workspace.id)) continue;
      void reconcile(workspace, true);
      watches.set(workspace.id, watchWorkspace(workspace.path, (event) => {
        const imported = touchesBuiltFiles(workspace.id, event.paths);
        if (!imported && !changedIn(event.paths)) return;
        const latest = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspace.id);
        if (!latest) return;
        // Files under extensions/, or ones an extension imports from elsewhere in the workspace, need a rebuild;
        // settings changes just start or stop extensions.
        const code = imported || event.paths.some((path) => path === "" || path.startsWith(`${APP_DIR}/${EXTENSIONS_DIR}`));
        later(workspace.id, () => (code ? reloadSlot(latest) : void reconcile(latest, false)));
      }));
    }
  };
  void reconcile(undefined, true);
  const offUser = window.workbench.config.onUserChanged(() => later(USER, () => reloadSlot(undefined)));
  // Turning an extension on or off in settings.json takes effect at once.
  const offSettings = useConfigLayers.subscribe((state, previous) => {
    for (const workspace of [undefined, ...folders()]) {
      const key = `settings\0${workspace?.path ?? ""}`;
      if (state[key] !== previous[key]) void reconcile(workspace, false);
    }
  });
  sync();
  const offStore = useWorkbenchStore.subscribe(sync);
  return () => {
    offStore(); offUser(); offSettings();
    for (const stop of watches.values()) stop();
    watches.clear();
  };
}
