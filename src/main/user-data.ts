import { app } from "electron";
import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { APP_NAME } from "../shared/app-identity";

/**
 * Chromium caches that rebuild themselves. They are left behind when an old profile is copied, so the copy stays small
 * and never carries a half-written cache from a copy that is still running.
 */
const CACHES = new Set(["Cache", "Code Cache", "GPUCache", "GPUPersistentCache", "DawnGraphiteCache", "DawnWebGPUCache", "GraphiteDawnCache", "ShaderCache", "blob_storage", "Crashpad"]);

/**
 * Chooses the profile folder before Electron or anything else touches it. The packaged app keeps its profile in
 * `<appData>/DimSum` and a run from source in `<appData>/DimSum Dev`, so the two never share one (macOS folder names
 * ignore case, so `dimsum` and `DimSum` would). `WORKBENCH_USER_DATA_DIR` overrides both (QA, profiles).
 *
 * The app used to be called Agent Workbench. A new profile starts as a copy of the old one, so workspaces, views,
 * attachments and trust carry over. The old folder is left as it was: an older build may still be running from it.
 */
export function chooseUserData(): void {
  if (process.env.WORKBENCH_USER_DATA_DIR) {
    app.setPath("userData", process.env.WORKBENCH_USER_DATA_DIR);
    return;
  }
  const appData = app.getPath("appData");
  const target = path.join(appData, app.isPackaged ? APP_NAME : `${APP_NAME} Dev`);
  app.setPath("userData", target);
  if (existsSync(target)) return;
  const legacy = path.join(appData, app.isPackaged ? "Agent Workbench" : "agent-workbench");
  if (!existsSync(legacy)) return;
  // Copy beside the target and rename into place, so an interrupted copy is never taken for a finished one.
  const partial = `${target}.partial`;
  try {
    rmSync(partial, { recursive: true, force: true });
    cpSync(legacy, partial, { recursive: true, verbatimSymlinks: true, filter: (source) => source === legacy || !CACHES.has(path.relative(legacy, source)) });
    renameSync(partial, target);
  } catch (error) {
    console.warn(`Could not copy the ${legacy} profile:`, String(error));
    rmSync(partial, { recursive: true, force: true });
  }
}
