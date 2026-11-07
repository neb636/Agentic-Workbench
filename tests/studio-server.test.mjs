import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { StudioServer } = require('../dist-electron/main/studio-server.js');
test('packaged renderer serves built files and rejects port conflicts and path escapes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-ui-'));
  const server = new StudioServer(), other = new StudioServer();
  try {
    await writeFile(path.join(root, 'index.html'), '<h1>Studio</h1>');
    await writeFile(path.join(root, 'app.js'), 'console.log("studio")');
    await server.start(root, 15175);
    const home = await fetch('http://127.0.0.1:15175/');
    assert.match(await home.text(), /Studio/);
    assert.equal((await fetch('http://127.0.0.1:15175/app.js')).headers.get('content-type'), 'text/javascript');
    assert.equal((await fetch('http://127.0.0.1:15175/..%2fprivate')).status, 403);
    assert.equal((await fetch('http://127.0.0.1:15175/missing')).status, 404);
    await assert.rejects(other.start(root, 15175), /EADDRINUSE/);
  } finally { server.stop(); other.stop(); await rm(root, { recursive: true, force: true }); }
});
