import assert from 'node:assert/strict';
import test from 'node:test';
import labs from '../dist-electron/shared/labs.js';

test('lab handoffs accept only bounded text and known actions', () => {
  for (const action of ['copy', 'agent']) {
    const share = { action, text: 'Camera settings\n#/world/thailand/hub/downstairs?cam=1', label: 'Camera lab changes' };
    assert.deepEqual(labs.validateLabShare(share), share);
    // Extra fields cannot turn a handoff into a native command.
    assert.deepEqual(labs.validateLabShare({ ...share, command: '/bin/sh' }), share);
    for (const invalid of [null, {}, { ...share, action: 'execute' }, { ...share, text: '' }, { ...share, text: 1 }, { ...share, text: 'x'.repeat(200001) }, { ...share, label: 'x'.repeat(201) }]) {
      assert.throws(() => labs.validateLabShare(invalid), /Invalid lab handoff/);
    }
  }
});
