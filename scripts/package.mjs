// Package Studio independently of the repositories opened in it.
import { fileURLToPath } from 'node:url';
import { build, Platform } from 'electron-builder';
const studio = fileURLToPath(new URL('..', import.meta.url));
if (process.platform !== 'darwin') throw new Error('Studio packaging currently supports macOS only.');
await build({ projectDir: studio, targets: Platform.MAC.createTarget(process.argv.includes('--dir') ? ['dir'] : ['dmg']) });
