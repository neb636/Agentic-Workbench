// An extension is a typed object with an `activate` function. The workbench's own features are extensions too: they
// receive the same context, so anything a first-party feature can contribute, a workspace extension can as well.
import type {
  CommandHandler, MenuContribution, PanelDefinition, PromptContributor, PromptMenuDefinition, ViewDefinition, WidgetDefinition,
} from "./contributions";
import type { WorkbenchEventHandler, WorkbenchEventName } from "./events";
import type { SendGuard } from "./guards";
import type { FileContent, FileEntry, FileWriteResult } from "../shared/models";

export type { FileContent, FileEntry, FileWriteResult };

/** Undoes one registration or subscription. Disposing twice does nothing. */
export interface Disposable { dispose(): void }

/**
 * Where an extension comes from:
 * - builtin: part of the app;
 * - user: `~/.dimsum/extensions/<name>`, the person's own, in every workspace;
 * - workspace: `<workspace>/.dimsum/extensions/<name>`, checked in with one workspace and active only there.
 */
export type ExtensionLayer = "builtin" | "user" | "workspace";

export interface ExtensionInfo {
  /** `builtin:<name>`, `user:<name>` or `workspace:<name>`. */
  id: string;
  /** The extension's folder name (or a built-in feature's name); a user or workspace extension prefixes its ids with it. */
  name: string;
  layer: ExtensionLayer;
  /** The workspace a workspace extension belongs to. Its contributions appear only there. */
  workspaceId?: string;
  /** The workspace folder, for workspace extensions. */
  root?: string;
}

/** Text files of the extension's own workspace, by path relative to the workspace folder. Only workspace extensions have one. */
export interface ExtensionFiles {
  read(path: string): Promise<FileContent>;
  list(path?: string): Promise<FileEntry[]>;
  /** Saves over the version with `expectedHash`; null: the file must not exist yet. */
  write(path: string, content: string, expectedHash: string | null): Promise<FileWriteResult>;
}

/**
 * Everything an extension can do. Each `register`/`on` returns a Disposable that is also added to `subscriptions`, so
 * an extension that needs no clean-up of its own just registers things: they all go when it deactivates or reloads.
 *
 * Ids: an extension from a user or workspace folder must prefix the ids it registers with `<name>.`; the
 * prefix shows where each contribution came from and keeps extensions from replacing each other's.
 */
export interface ExtensionContext {
  readonly extension: ExtensionInfo;
  readonly subscriptions: Disposable[];
  views: { register(definition: ViewDefinition): Disposable };
  panels: { register(definition: PanelDefinition): Disposable };
  widgets: { register(definition: WidgetDefinition): Disposable };
  commands: {
    register<TArgs = unknown, TResult = unknown>(id: string, handler: CommandHandler<TArgs, TResult>): Disposable;
    execute<TResult = unknown>(id: string, args?: unknown): Promise<TResult>;
  };
  promptMenus: { register(menu: PromptMenuDefinition): Disposable };
  promptContributors: { register(contributor: PromptContributor): Disposable };
  contextMenus: { register(contribution: MenuContribution): Disposable };
  /** Guards run before every send, in order; one block refuses it, warnings ask the person once. */
  beforeSend(guards: SendGuard | SendGuard[]): Disposable;
  events: { on<K extends WorkbenchEventName>(name: K, handler: WorkbenchEventHandler<K>): Disposable };
  /** Undefined outside a workspace extension. */
  files?: ExtensionFiles;
}

export interface ExtensionDefinition {
  /** Shown in the Extensions panel. Defaults to the folder name. */
  name?: string;
  description?: string;
  activate(context: ExtensionContext): void | Disposable | Promise<void | Disposable>;
}

/** Identity at runtime; it exists so `export default defineExtension({...})` is checked against the contract. */
export const defineExtension = (definition: ExtensionDefinition): ExtensionDefinition => definition;
