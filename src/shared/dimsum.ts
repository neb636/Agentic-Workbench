import { z } from "zod";
import { repoInstructionsFileSchema } from "./schemas";

/**
 * Layered configuration and extensions:
 * - user: `~/.dimsum/<name>.json` and `~/.dimsum/extensions/`, the person's own, in every workspace;
 * - workspace: `<workspace>/.dimsum/<name>.json` and `<workspace>/.dimsum/extensions/`, checked in, for everyone there;
 * - local: `<workspace>/.dimsum/<name>.local.json`, the person's own, for one workspace, never committed.
 */
export const DIMSUM_IPC = {
  configRead: "dimsum:config-read",
  configWrite: "dimsum:config-write",
  /** The person's own folder changed; workspace folders are watched through the files API. */
  userChanged: "dimsum:user-changed",
  extensionsList: "dimsum:extensions-list",
  extensionsLoad: "dimsum:extensions-load",
  extensionsTrust: "dimsum:extensions-trust",
  extensionsScaffold: "dimsum:extensions-scaffold",
} as const;

export type ConfigScope = "user" | "workspace" | "local";

/** `settings.json`: small switches that layer like instructions do. */
export const dimsumSettingsSchema = z.object({
  version: z.literal(1),
  extensions: z.object({
    /** Extension ids (`user:<name>`, `workspace:<name>`) turned off. A layer can only add to this list. */
    disabled: z.array(z.string()).optional(),
  }).optional(),
});
export type DimsumSettings = z.infer<typeof dimsumSettingsSchema>;

/** The documents that may be read and written in layers, each with its own schema. Nothing else can be. */
export const CONFIG_DOCUMENTS = {
  instructions: repoInstructionsFileSchema,
  settings: dimsumSettingsSchema,
} as const;
export type ConfigName = keyof typeof CONFIG_DOCUMENTS;
export const configNameSchema = z.enum(Object.keys(CONFIG_DOCUMENTS) as [ConfigName, ...ConfigName[]]);

/** One layer's file as last read: its parsed value, or why it couldn't be used. `hash` guards the next write. */
export type ConfigDocument =
  | { status: "ok"; value: unknown; hash: string; path: string }
  | { status: "invalid"; error: string; hash?: string; path: string };

export interface ConfigLayers {
  user?: ConfigDocument;
  workspace?: ConfigDocument;
  local?: ConfigDocument;
  /** The workspace layer was read from a file this app used to keep it in (`.workbench/instructions.json`). */
  legacyWorkspace?: boolean;
}

export const configReadSchema = z.object({ name: configNameSchema, root: z.string().optional() });
export const configWriteSchema = z.object({
  name: configNameSchema,
  scope: z.enum(["user", "workspace", "local"]),
  root: z.string().optional(),
  value: z.unknown(),
  /** The hash last read; null: the file must not exist yet. */
  expectedHash: z.string().nullable(),
});

export type ConfigWriteResult = { ok: true; hash: string } | { ok: false; reason: "changed" };

export interface ExtensionListing {
  /** `user:<name>` or `workspace:<name>`. */
  id: string;
  name: string;
  layer: "user" | "workspace";
  /** The workspace folder, for workspace extensions. */
  root?: string;
  /** The entry file, relative to its layer folder (`extensions/<name>/index.tsx`). */
  entry: string;
  /** Workspace extensions run only in a workspace the person trusts; user extensions always may. */
  trusted: boolean;
}

export type ExtensionLoadResult = { ok: true; url: string } | { ok: false; error: string };

export const extensionsListSchema = z.object({ root: z.string().optional() });
export const extensionLoadSchema = z.object({ id: z.string().regex(/^(user|workspace):[A-Za-z0-9][A-Za-z0-9._-]*$/), root: z.string().optional() });
export const extensionNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use lowercase letters, digits and dashes.");
export const extensionScaffoldSchema = z.object({ root: z.string(), name: extensionNameSchema });

export interface DimsumApi {
  config: {
    read: (name: ConfigName, root?: string) => Promise<ConfigLayers>;
    write: (name: ConfigName, scope: ConfigScope, root: string | undefined, value: unknown, expectedHash: string | null) => Promise<ConfigWriteResult>;
    /** Something in `~/.dimsum` changed. Returns unsubscribe. */
    onUserChanged: (listener: () => void) => () => void;
  };
  extensions: {
    /** User extensions, and with `root` that workspace's too. */
    list: (root?: string) => Promise<ExtensionListing[]>;
    /** Bundles the extension and returns a script URL that defines it. */
    load: (id: string, root?: string) => Promise<ExtensionLoadResult>;
    /** Asks the person to trust the workspace's programs and extensions. Rejects when they decline. */
    trust: (root: string) => Promise<void>;
    /** Creates `.dimsum/extensions/<name>/` with a starter extension, its types, and the guide for agents. */
    scaffold: (root: string, name: string) => Promise<{ entry: string }>;
  };
}
