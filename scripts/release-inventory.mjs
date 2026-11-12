import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const sbom = execFileSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit=dev'], { maxBuffer: 16 * 1024 * 1024 });
await writeFile('release/dependencies.cdx.json', sbom);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const artifacts = [];
for (const name of await readdir('release')) {
  if (!name.endsWith('.dmg')) continue;
  const bytes = await readFile(path.join('release', name));
  artifacts.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile('release/release-inventory.json', JSON.stringify({ electron: lock.packages['node_modules/electron'].version, artifacts }, null, 2) + '\n');
