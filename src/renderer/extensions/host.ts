import { create } from "zustand";
import type { Disposable, ExtensionContext, ExtensionDefinition, ExtensionInfo } from "@dimsum/sdk";
import { services } from "../core/services";
import { errorMessage } from "../core/errors";
import { guarded } from "./ExtensionBoundary";

/** One extension as the host knows it: running, or failed with the reason. */
export interface ExtensionRecord {
  key: string;
  info: ExtensionInfo;
  title: string;
  description?: string;
  status: "active" | "failed";
  error?: string;
}

export const useActiveExtensions = create<{ records: Record<string, ExtensionRecord> }>(() => ({ records: {} }));
const running = new Map<string, Disposable[]>();

/** Workspace extensions are known per workspace: two worktrees may each run their own copy. */
export const extensionKey = (info: Pick<ExtensionInfo, "id" | "workspaceId">) => `${info.workspaceId ?? ""}|${info.id}`;

const once = (dispose: () => void): Disposable => { let done = false; return { dispose: () => { if (!done) { done = true; dispose(); } } }; };

function createContext(info: ExtensionInfo, subscriptions: Disposable[]): ExtensionContext {
  const builtin = info.layer === "builtin";
  const scope = info.layer === "workspace" ? info.workspaceId : undefined;
  const track = (dispose: () => void) => { const disposable = once(dispose); subscriptions.push(disposable); return disposable; };
  const owned = (id: string) => {
    if (!builtin && !id.startsWith(`${info.name}.`)) throw new Error(`${info.id} must prefix the ids it registers with "${info.name}." (got "${id}").`);
    return id;
  };
  // A built-in feature failing is a bug to see; an extension's component failing must not take the workbench down.
  const component = <P extends object>(inner: import("react").ComponentType<P>) => (builtin ? inner : guarded(info.id, inner));
  const files = info.layer === "workspace" && info.root ? (() => {
    const root = info.root;
    return {
      read: (path: string) => window.workbench.files.read(root, path),
      list: (path = "") => window.workbench.files.list(root, path),
      write: (path: string, content: string, expectedHash: string | null) => window.workbench.files.write(root, path, content, expectedHash),
    };
  })() : undefined;
  return {
    extension: info,
    subscriptions,
    views: { register: (definition) => { owned(definition.id); return track(services.views.register({ ...definition, component: component(definition.component) }, scope)); } },
    panels: { register: (definition) => { owned(definition.id); return track(services.panels.register({ ...definition, component: component(definition.component), badge: definition.badge && component(definition.badge) }, scope)); } },
    widgets: { register: (definition) => { owned(definition.id); return track(services.widgets.register({ ...definition, component: component(definition.component) }, scope)); } },
    commands: {
      register: (id, handler) => track(services.commands.register(owned(id), handler, scope)),
      execute: (id, args) => services.commands.execute(id, scope && args === undefined ? { workspaceId: scope } : args),
    },
    promptMenus: { register: (menu) => { owned(menu.id); return track(services.promptMenus.register(menu.manage && !builtin ? { ...menu, manage: { ...menu.manage, component: guarded(info.id, menu.manage.component) } } : menu, scope)); } },
    promptContributors: { register: (contributor) => { owned(contributor.id); return track(services.promptContributors.register(contributor, scope)); } },
    contextMenus: { register: (contribution) => { owned(contribution.id); return track(services.contextMenus.register(contribution, scope)); } },
    beforeSend: (guards) => {
      const added = (Array.isArray(guards) ? guards : [guards]).map((guard) => services.sendGuards.register({ ...guard, id: owned(guard.id) }, scope));
      return track(() => added.forEach((remove) => remove()));
    },
    events: { on: (name, handler) => { const subscription = services.events.on(name, handler); return track(() => subscription.dispose()); } },
    files,
  };
}

function setRecord(record: ExtensionRecord): void {
  useActiveExtensions.setState((state) => ({ records: { ...state.records, [record.key]: record } }));
}

/**
 * Runs an extension's `activate`. Whatever it registered before failing is removed again, so a broken extension
 * leaves nothing half-installed. Activating one that is already running replaces it (a reload).
 */
export async function activateExtension(definition: ExtensionDefinition, info: ExtensionInfo): Promise<ExtensionRecord> {
  const key = extensionKey(info);
  deactivateExtension(key, false);
  const subscriptions: Disposable[] = [];
  running.set(key, subscriptions);
  const base = { key, info, title: definition.name ?? info.name, description: definition.description };
  try {
    const result = await definition.activate(createContext(info, subscriptions));
    if (result) subscriptions.push(result);
    const record: ExtensionRecord = { ...base, status: "active" };
    setRecord(record);
    services.events.emit("extension.activated", { extensionId: info.id, workspaceId: info.workspaceId });
    return record;
  } catch (error) {
    disposeAll(subscriptions);
    running.delete(key);
    const record: ExtensionRecord = { ...base, status: "failed", error: errorMessage(error) };
    setRecord(record);
    services.events.emit("extension.failed", { extensionId: info.id, workspaceId: info.workspaceId, error: record.error ?? "" });
    if (info.layer === "builtin") throw error;
    return record;
  }
}

/** Removes everything the extension registered. With `forget`, it also leaves the list of known extensions. */
export function deactivateExtension(key: string, forget = true): void {
  const subscriptions = running.get(key);
  running.delete(key);
  if (subscriptions) disposeAll(subscriptions);
  if (forget && useActiveExtensions.getState().records[key]) {
    useActiveExtensions.setState((state) => { const records = { ...state.records }; delete records[key]; return { records }; });
  }
}

function disposeAll(subscriptions: Disposable[]): void {
  for (const subscription of subscriptions.splice(0).reverse()) {
    try { subscription.dispose(); } catch (error) { console.error("An extension's clean-up failed:", error); }
  }
}
