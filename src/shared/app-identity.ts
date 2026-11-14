/**
 * The app's on-disk identity. Every folder and file name the app reads from a person's home or a workspace comes from
 * here, so renaming the product changes one file.
 */
export const APP_NAME = "DimSum";
/** `~/.dimsum` (the person's own) and `<workspace>/.dimsum` (checked in with the workspace). */
export const APP_DIR = ".dimsum";
/** `<name>.local.json` beside a checked-in `<name>.json`: the person's own, for one workspace, never committed. */
export const LOCAL_SUFFIX = ".local";
/** The module name extensions import their API from. */
export const SDK_MODULE = "@dimsum/sdk";
/** Extensions live in `<layer folder>/extensions/<name>/index.ts(x)`. */
export const EXTENSIONS_DIR = "extensions";
/** Written into an extension's folder after every build and activation: whether it is running, and why not. Never committed. */
export const EXTENSION_STATUS_FILE = ".status.json";
/** The guide for agents, written beside a workspace's extensions. */
export const AGENT_GUIDE_FILE = "AGENTS.md";
