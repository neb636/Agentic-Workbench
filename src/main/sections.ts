import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { SectionsIndex } from '../shared/models';

const SCRIPT = 'scripts/sections-index.mjs';
const TTL = 5 * 60_000;

/**
 * The game's section directory for one checkout, from its own `scripts/sections-index.mjs` (the data the README
 * directory uses). The Studio never imports game source: it runs that fixed script with Electron's Node, no shell.
 */
export class SectionsService {
  private readonly cache = new Map<string, { at: number; value: Promise<SectionsIndex> }>();

  get(root: string, refresh = false): Promise<SectionsIndex> {
    const key = path.resolve(root);
    const cached = this.cache.get(key);
    if (!refresh && cached && Date.now() - cached.at < TTL) return cached.value;
    const value = this.read(key);
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => { if (this.cache.get(key)?.value === value) this.cache.delete(key); });
    return value;
  }

  private async read(root: string): Promise<SectionsIndex> {
    try { await access(path.join(root, SCRIPT)); }
    catch { return { version: 1, places: [], missing: 'This branch is older than the Sections tree. Merge main into it to see its sections.' }; }
    try { await access(path.join(root, 'node_modules/vite')); }
    catch { return { version: 1, places: [], missing: 'Game dependencies are missing here. Run npm ci in this checkout.' }; }
    const output = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, [SCRIPT], { cwd: root, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
        (error, stdout, stderr) => error ? reject(new Error(`Could not read the sections: ${String(stderr || error.message).trim().slice(-600)}`)) : resolve(stdout));
    });
    const parsed = JSON.parse(output) as SectionsIndex;
    if (parsed?.version !== 1 || !Array.isArray(parsed.places)) throw new Error('The sections index has an unknown format.');
    return parsed;
  }
}
