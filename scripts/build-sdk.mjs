// The SDK's types and the agent guide, shipped with the app so a workspace's `.dimsum/` can be scaffolded from the
// version that will run it.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
rmSync("dist-electron/sdk", { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", "tsconfig.sdk.json"], { stdio: "inherit" });
mkdirSync("dist-electron/sdk", { recursive: true });
copyFileSync("src/sdk/GUIDE.md", "dist-electron/sdk/GUIDE.md");
