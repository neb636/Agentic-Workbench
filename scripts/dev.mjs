// Start both local renderers and Electron. Everything uses this checkout; no sibling repo or packaged app required.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const studio = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = path.dirname(studio);
const children = new Set();
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  process.exitCode = code;
}
function launch(file, args, cwd, env = {}) {
  const child = spawn(file, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', detached: true });
  children.add(child);
  child.on('error', error => { console.error(error); shutdown(1); });
  child.on('exit', code => { children.delete(child); shutdown(code ?? 1); });
  return child;
}
async function unused(origin) {
  try { await fetch(origin, { signal: AbortSignal.timeout(1000) }); } catch { return; }
  throw new Error(`${origin} is already in use. Stop the other studio/server first.`);
}
async function ready(origin) {
  for (let tries = 0; tries < 120 && !stopping; tries++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Could not start ${origin}`);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
try {
  // The game isn't served here: Studio starts a checkout's game server when its game panel opens, and stops it after.
  const studioOrigin = 'http://127.0.0.1:5175';
  await unused(studioOrigin);
  // Build Electron before opening its window.
  const compiler = spawn(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.electron.json'], { cwd: studio, stdio: 'inherit' });
  const result = await new Promise(resolve => compiler.on('exit', resolve));
  if (result !== 0) throw new Error('Electron compilation failed');
  launch(process.execPath, [path.join(studio, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5175', '--strictPort'], studio);
  await ready(studioOrigin);
  if (!process.argv.includes('--servers-only')) launch(require('electron'), ['.'], studio, { VITE_DEV_SERVER_URL: studioOrigin, STUDIO_REPO_ROOT: repo });
} catch (error) { console.error(error); shutdown(1); }
