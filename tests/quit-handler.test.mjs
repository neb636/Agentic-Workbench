import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createQuitHandler } = require('../dist-electron/main/quit-handler.js');

test('quit waits for cleanup once, blocks repeated requests and permits the final quit', async () => {
  let finish;
  const cleanup = new Promise(resolve => { finish = resolve; });
  let cleanups = 0;
  let quits = 0;
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  const handler = createQuitHandler(() => { cleanups++; return cleanup; }, () => {
    quits++;
    handler(event);
  }, assert.fail);
  handler(event);
  handler(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, 2);
  assert.equal(cleanups, 1);
  assert.equal(quits, 0);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quits, 1);
  assert.equal(prevented, 2);
});

test('cleanup failure is reported and still permits quitting', async () => {
  const error = new Error('cleanup failed');
  const errors = [];
  let quits = 0;
  const handler = createQuitHandler(async () => { throw error; }, () => { quits++; }, error => errors.push(error));
  handler({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [error]);
  assert.equal(quits, 1);
});
