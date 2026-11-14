import { create } from "zustand";
import type { Disposable, ExtensionContext, ExtensionDefinition, ExtensionInfo } from "@dimsum/sdk";
import { services } from "../core/services";
import { errorMessage } from "../core/errors";
import { guarded, guardedIcon, guardedNode } from "./ExtensionBoundary";
import { LocalPreview } from "../ui/LocalPreview";

/** One extension as the host knows it: running, or failed with the reason. */
export interface ExtensionRecord {
  key: string;
  info: ExtensionInfo;
  title: string;
  description?: string;
  status: "active" | "failed";
  error?: string;
  stack?: string;
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
  // Icons and ready-made content are drawn by the shell (tabs, menus, dialogs), outside the extension's own components.
  const icon = <P extends object>(inner: import("react").ComponentType<P>) => (builtin ? inner : guardedIcon(info.id, inner));
  const node = (inner: import("react").ReactNode) => (builtin ? inner : guardedNode(info.id, inner));
  /**
   * An extension's callback that the shell calls while drawing (a menu's options, a view's status) runs outside any of
   * the extension's components: a throw is reported and `fallback` used instead, so the shell keeps working.
   */
  const safe = <A extends unknown[], R>(what: string, callback: ((...args: A) => R) | undefined, fallback: (...args: A) => R): ((...args: A) => R) | undefined =>
    !callback || builtin ? callback : (...args: A) => {
      try { return callback(...args); }
      catch (error) { console.error(`Extension ${info.id}: ${what} failed:`, error); return fallback(...args); }
    };
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
    views: { register: (definition) => {
      owned(definition.id);
      const { confirmClose } = definition;
      return track(services.views.register({
        ...definition, component: component(definition.component), icon: icon(definition.icon),
        createState: safe(`${definition.id} createState`, definition.createState, () => undefined),
        isPreview: safe(`${definition.id} isPreview`, definition.isPreview, () => false),
        tabMenu: safe(`${definition.id} tabMenu`, definition.tabMenu, () => []),
        onActivate: safe(`${definition.id} onActivate`, definition.onActivate, () => undefined),
        idleStatus: safe(`${definition.id} idleStatus`, definition.idleStatus, () => undefined),
        // When it can't say what closing loses, ask anyway rather than close without asking.
        confirmClose: safe(`${definition.id} confirmClose`, confirmClose && !builtin ? (view) => {
          const confirmation = confirmClose(view);
          return confirmation && { ...confirmation, warning: node(confirmation.warning), subject: { ...confirmation.subject, icon: node(confirmation.subject.icon) } };
        } : confirmClose, (view) => ({
          title: `Close ${view.title}?`, message: `${definition.label} couldn't say what closing this view loses.`,
          warning: "Anything not yet saved in it may be lost.", subject: { icon: null, name: view.title }, confirmLabel: "Close view",
        })),
      }, scope));
    } },
    panels: { register: (definition) => { owned(definition.id); return track(services.panels.register({ ...definition, icon: icon(definition.icon), component: component(definition.component), badge: definition.badge && component(definition.badge) }, scope)); } },
    widgets: { register: (definition) => { owned(definition.id); return track(services.widgets.register({ ...definition, component: component(definition.component) }, scope)); } },
    commands: {
      register: (id, handler) => track(services.commands.register(owned(id), handler, scope)),
      // The lookup uses the extension's own workspace whatever the arguments look like, so its commands are found.
      execute: (id, args) => services.commands.execute(id, scope && args === undefined ? { workspaceId: scope } : args, scope),
    },
    promptMenus: { register: (menu) => {
      owned(menu.id);
      if (builtin) return track(services.promptMenus.register(menu, scope));
      const { optionTag } = menu;
      return track(services.promptMenus.register({
        ...menu, icon: icon(menu.icon),
        options: safe(`${menu.id} options`, menu.options, () => []) ?? menu.options,
        subscribe: safe(`${menu.id} subscribe`, menu.subscribe, () => () => undefined),
        optionTag: safe(`${menu.id} optionTag`, optionTag && ((optionId, context) => { const tag = optionTag(optionId, context); return tag && { ...tag, icon: icon(tag.icon) }; }), () => undefined),
        manage: menu.manage && { ...menu.manage, component: guarded(info.id, menu.manage.component) },
      }, scope));
    } },
    promptContributors: { register: (contributor) => {
      owned(contributor.id);
      const contributions = safe(`${contributor.id} contributions`, contributor.contributions, () => []) ?? contributor.contributions;
      return track(services.promptContributors.register({ ...contributor, contributions }, scope));
    } },
    contextMenus: { register: (contribution) => {
      owned(contribution.id);
      const items = builtin ? contribution.items : safe(`${contribution.id} items`, (context: Parameters<typeof contribution.items>[0]) =>
        contribution.items(context).map((action) => (action.icon === undefined ? action : { ...action, icon: node(action.icon) })), () => []) ?? contribution.items;
      return track(services.contextMenus.register({ ...contribution, items }, scope));
    } },
    beforeSend: (guards) => {
      // Each guard is tracked as soon as it is installed, so one failing registration can't leave the earlier ones behind.
      const added = (Array.isArray(guards) ? guards : [guards]).map((guard) => track(services.sendGuards.register({ ...guard, id: owned(guard.id) }, scope)));
      return once(() => added.forEach((guard) => guard.dispose()));
    },
    events: { on: (name, handler) => { const subscription = services.events.on(name, handler); return track(() => subscription.dispose()); } },
    files,
    ui: { LocalPreview },
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
    const record: ExtensionRecord = { ...base, status: "failed", error: errorMessage(error), stack: error instanceof Error ? error.stack : undefined };
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
