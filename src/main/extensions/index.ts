import { DIMSUM_IPC, configReadSchema, configWriteSchema, extensionLoadSchema, extensionScaffoldSchema, extensionsListSchema } from "../../shared/dimsum";
import { readLayers, watchDimsumHome, writeLayer } from "../config-layers";
import { handle } from "../ipc";
import type { WorkspaceRoots } from "../workspace-files";
import { authorizeWorkspaceExecution, isWorkspaceTrusted } from "../workspace-trust";
import { dimsumHome } from "../dimsum-home";
import { bundleExtension } from "./bundler";
import { newBundleToken, storeBundle } from "./bundles";
import { findExtension, listExtensions, layerFolder } from "./catalog";
import path from "node:path";

/**
 * Layered `.dimsum` configuration and extensions. A workspace path from the window is used only once it is a granted
 * workspace root; a workspace extension is bundled only for a workspace the person trusts to run its programs.
 */
export function registerDimsum(roots: WorkspaceRoots): void {
  const granted = async (root: string | undefined) => { if (root !== undefined) await roots.resolve(root); return root; };
  handle(DIMSUM_IPC.configRead, async (_event, input) => {
    const { name, root } = configReadSchema.parse(input);
    return readLayers(name, await granted(root));
  });
  handle(DIMSUM_IPC.configWrite, async (_event, input) => {
    const { name, scope, root, value, expectedHash } = configWriteSchema.parse(input);
    if (scope !== "user" && !root) throw new Error(`The ${scope} layer belongs to a workspace.`);
    return writeLayer(name, scope, scope === "user" ? undefined : await granted(root), value, expectedHash);
  });
  handle(DIMSUM_IPC.extensionsList, async (_event, input) => {
    const { root } = extensionsListSchema.parse(input ?? {});
    return listExtensions(await granted(root));
  });
  handle(DIMSUM_IPC.extensionsLoad, async (_event, input) => {
    const { id, root } = extensionLoadSchema.parse(input);
    const workspace = id.startsWith("workspace:");
    if (workspace && !root) throw new Error("Workspace extensions belong to a workspace.");
    if (workspace) await granted(root);
    if (workspace && root && !isWorkspaceTrusted(root)) return { ok: false, error: "Trust this workspace to run its extensions." };
    const listing = await findExtension(id, root);
    if (!listing) return { ok: false, error: `${id} is not installed.` };
    const base = layerFolder(listing.layer, listing.root);
    const token = newBundleToken();
    const built = await bundleExtension(path.join(base, listing.entry), workspace && root ? root : dimsumHome(), token);
    if (!built.ok) return built;
    return { ok: true, url: storeBundle(`${root ?? ""}|${id}`, token, built.code) };
  });
  handle(DIMSUM_IPC.extensionsTrust, async (_event, input) => {
    const { root } = extensionsListSchema.parse(input);
    if (!root) throw new Error("Choose a workspace to trust.");
    await authorizeWorkspaceExecution(await roots.resolve(root));
  });
  handle(DIMSUM_IPC.extensionsScaffold, async (_event, input) => {
    const { root, name } = extensionScaffoldSchema.parse(input);
    const { scaffoldExtension } = await import("./scaffold");
    return scaffoldExtension(await roots.resolve(root), name);
  });
  watchDimsumHome();
}
