import { app } from "electron";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_DIR } from "../shared/app-identity";

/** `~/.dimsum`: the person's own settings, instructions and extensions. `DIMSUM_HOME` moves it (QA, profiles). */
export function dimsumHome(): string {
  return process.env.DIMSUM_HOME ? path.resolve(process.env.DIMSUM_HOME) : path.join(os.homedir(), APP_DIR);
}

/** The SDK types and agent guide this build ships, written by `scripts/build-sdk.mjs`. */
export function sdkFolder(): string {
  return path.join(app.getAppPath(), "dist-electron", "sdk");
}

/** The guide agents read; undefined in a build that has none. */
export function agentGuidePath(): string | undefined {
  const guide = path.join(sdkFolder(), "GUIDE.md");
  return existsSync(guide) ? guide : undefined;
}
