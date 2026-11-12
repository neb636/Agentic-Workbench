import { spawnSync } from 'node:child_process';
if (!process.env.CSC_NAME || !process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
  throw new Error('Release requires CSC_NAME (Developer ID identity), APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID. Use dist:dir for local development packaging.');
}
const result = spawnSync('npx', ['electron-builder', '--mac', '--config.mac.identity=' + process.env.CSC_NAME, '--config.mac.hardenedRuntime=true', '--config.mac.notarize=true'], { stdio: 'inherit', env: process.env });
if (result.status === 0) await import("./release-inventory.mjs");
process.exitCode = result.status ?? 1;
