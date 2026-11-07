import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const folder = process.arch === 'x64' ? 'mac' : `mac-${process.arch}`;
const app = fileURLToPath(new URL(`../release/${folder}/Kaylee Gamepack Studio.app`, import.meta.url));
const result = spawnSync('open', [app], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
