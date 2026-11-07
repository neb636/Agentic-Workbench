import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { GameServerPool } = require('../dist-electron/main/game-server.js');
const { migratePersistedState } = require('../dist-electron/shared/schemas.js');

/** A server that only records what happened to it. */
function fakes() {
  const log = [];
  const create = port => ({
    port, live: false,
    get origin() { return `http://127.0.0.1:${port}`; },
    get running() { return this.live; },
    async start(root) { this.live = true; log.push(`start ${port} ${root}`); },
    async stop() { if (this.live) log.push(`stop ${port}`); this.live = false; },
  });
  return { log, create };
}

test('one game server per piece of work, the last two kept, the external one never started or stopped', async () => {
  const { log, create } = fakes();
  const pool = new GameServerPool([5176, 5178, 5180], { keep: 2, external: { root: '/repo', port: 5174 }, validate: async () => {}, create });
  assert.equal(await pool.origin('/repo'), 'http://127.0.0.1:5174');
  assert.equal(await pool.origin('/a'), 'http://127.0.0.1:5176');
  assert.equal(await pool.origin('/b'), 'http://127.0.0.1:5178');
  // Back to /a is instant: it is still running.
  assert.equal(await pool.origin('/a'), 'http://127.0.0.1:5176');
  // A third piece of work stops the least recently used (/b) and takes its port.
  assert.equal(await pool.origin('/c'), 'http://127.0.0.1:5178');
  assert.deepEqual(log, ['start 5176 /a', 'start 5178 /b', 'stop 5178', 'start 5178 /c']);
  assert.deepEqual(pool.running().map(item => item.root), ['/repo', '/c', '/a']);
  // The one on screen is kept even when another was used more recently (main, after compare is switched off).
  await pool.trim(1, '/a');
  assert.deepEqual(pool.running().map(item => item.root), ['/repo', '/a']);
  await pool.stopAll();
  assert.deepEqual(pool.running().map(item => item.root), ['/repo']);
  assert.equal(log.at(-1), 'stop 5176');
});

test('concurrent requests for the same checkout start one server', async () => {
  const { log, create } = fakes();
  const pool = new GameServerPool([5176, 5178], { validate: async () => {}, create });
  const [a, b] = await Promise.all([pool.origin('/a'), pool.origin('/a')]);
  assert.equal(a, b);
  assert.deepEqual(log, ['start 5176 /a']);
});

test('a checkout that fails validation starts nothing', async () => {
  const { log, create } = fakes();
  const pool = new GameServerPool([5176], { validate: async () => { throw new Error('Game dependencies are missing.'); }, create });
  await assert.rejects(pool.origin('/a'), /dependencies/);
  assert.deepEqual(log, []);
});

test('lab tabs migrate onto the game pane', () => {
  const state = migratePersistedState({
    workspaces: [{
      id: 'w', name: 'main', path: '/repo', activeViewId: 'feel', views: [
        { id: 'agent', type: 'agent', workspaceId: 'w', title: 'Untitled' },
        { id: 'feel', type: 'feel-lab', workspaceId: 'w', title: 'Feel lab', state: { link: 'http://127.0.0.1:5174/?studio=1#/world/thailand/nan-trip/drive?feel=1&feel.steer=2' } },
        { id: 'cam', type: 'camera-lab', workspaceId: 'w', title: 'Camera lab', state: { link: '#/world/thailand/hub/downstairs?cam=1' } },
        { id: 'char', type: 'character-lab', workspaceId: 'w', title: '3D character lab', state: { link: '#/world/characters/joy' } },
      ],
    }],
    instructionOptions: [],
  });
  const [workspace] = state.workspaces;
  assert.deepEqual(workspace.views.map(view => view.id), ['agent']);
  assert.equal(workspace.activeViewId, 'agent');
  assert.equal(workspace.game.link, '#/world/thailand/nan-trip/drive?feel.steer=2');
  assert.equal(workspace.game.characterLink, '#/world/characters/joy');
});

test('a port someone else is using is skipped', async () => {
  const { log, create } = fakes();
  const busy = port => { const server = create(port); if (port === 5174) server.start = async () => { throw new Error('http://127.0.0.1:5174 is already in use.'); }; return server; };
  const pool = new GameServerPool([5174, 5176], { validate: async () => {}, create: busy });
  assert.equal(await pool.origin('/a'), 'http://127.0.0.1:5176');
  assert.deepEqual(log, ['start 5176 /a']);
});
