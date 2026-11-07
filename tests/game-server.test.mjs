import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { GameServer, validateGameCheckout } = require('../dist-electron/main/game-server.js');
const { createQuitHandler } = require('../dist-electron/main/quit-handler.js');

test('packaged game server owns its process, rejects an occupied origin and releases it on stop', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
  const server = new GameServer();
  const other = new GameServer();
  try {
    await mkdir(path.join(root, 'node_modules/vite/bin'), { recursive: true });
    await mkdir(path.join(root, 'src/world/labs'), { recursive: true });
    await writeFile(path.join(root, 'src/world/labs/workbench.ts'), '');
    await writeFile(path.join(root, 'node_modules/vite/bin/vite.js'), `require('node:http').createServer((req,res)=>res.end('fixture')).listen(5174,'127.0.0.1');`);
    await validateGameCheckout(root);
    const failures = [];
    await server.start(root, message => failures.push(message));
    assert.equal(await (await fetch('http://127.0.0.1:5174/@vite/client')).text(), 'fixture');
    await assert.rejects(other.start(root, () => {}), /already in use/);
    await server.stop();
    for (let attempt = 0; attempt < 50; attempt++) {
      try { await fetch('http://127.0.0.1:5174'); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await assert.rejects(fetch('http://127.0.0.1:5174'));
    assert.deepEqual(failures, []);
    // A detached server that ignores SIGTERM must be killed before Electron exits.
    await writeFile(path.join(root, 'node_modules/vite/bin/vite.js'), `process.on('SIGTERM', () => {}); require('node:http').createServer((req,res)=>res.end('stubborn')).listen(5174,'127.0.0.1');`);
    await server.start(root, message => failures.push(message));
    let prevented = 0;
    let quits = 0;
    let quitHandler;
    const event = { preventDefault() { prevented++; } };
    const quitComplete = new Promise(resolve => {
      quitHandler = createQuitHandler(() => server.stop(), () => { quits++; quitHandler(event); resolve(); }, assert.fail);
    });
    quitHandler(event);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(quits, 0);
    assert.equal(await (await fetch('http://127.0.0.1:5174')).text(), 'stubborn');
    await quitComplete;
    assert.equal(quits, 1);
    assert.equal(prevented, 1);
    // Confirm a new launch can bind the same port after the SIGKILL fallback.
    await server.start(root, message => failures.push(message));
    await server.stop();
    assert.deepEqual(failures, []);
    await writeFile(path.join(root, 'node_modules/vite/bin/vite.js'), 'process.exit(3)');
    await assert.rejects(server.start(root, () => {}), /Game server exited \(3\)/);
  } finally { await server.stop(); await other.stop(); await rm(root, { recursive: true, force: true }); }
});
