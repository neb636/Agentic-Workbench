import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import labs from '../dist-electron/shared/labs.js';
import runner from '../dist-electron/main/lab-ai.js';
const { validateProposal, snapshotKey, undoSceneKey } = labs;
const { LabAi, labRequestSchema, labPrompt } = runner;
const snapshot = { kind: 'camera', href: 'http://127.0.0.1:5174/#/world/thailand/hub/downstairs?cam=1', context: { mode: 'nudge', frame: 'ipad-wide', watched: 1 }, controls: [{ key: 'zoom', label: 'Zoom', min: .3, max: 3, step: .01, value: 1 }] };
test('AI proposals reject invalid values atomically and never invent controls', () => {
  const proposal = { explanation: 'Wider', changes: [{ key: 'zoom', value: .8 }] };
  assert.deepEqual(validateProposal(snapshot, proposal), proposal);
  for (const value of [NaN, Infinity, -1, 4, '1', null]) assert.throws(() => validateProposal(snapshot, { ...proposal, changes: [{ key: 'zoom', value }] }));
  assert.throws(() => validateProposal(snapshot, { ...proposal, changes: [...proposal.changes, { key: 'shell', value: 1 }] }));
  assert.throws(() => validateProposal(snapshot, { ...proposal, changes: [...proposal.changes, ...proposal.changes] }));
  assert.equal(snapshot.controls[0].value, 1);
});
test('freshness tracks the scene, mode, frame and controls, while ignoring live telemetry', () => {
  assert.equal(snapshotKey(snapshot), snapshotKey({ ...snapshot, context: { ...snapshot.context, watched: 99 } }));
  for (const changed of [{ ...snapshot, href: snapshot.href + '&round=2' }, { ...snapshot, context: { ...snapshot.context, mode: 'lock' } }, { ...snapshot, controls: [{ ...snapshot.controls[0], value: 2 }] }]) assert.notEqual(snapshotKey(snapshot), snapshotKey(changed));
});
test('Undo checks the hash section and game params, ignoring outer studio query and tuning values', () => {
  const base = { ...snapshot, href: 'http://127.0.0.1:5174/?studio=1#/world/thailand/nan-trip/drive?road=valley&round=1&cam=1&cam.zoom=0.9' };
  const changed = href => ({ ...base, href });
  assert.notEqual(undoSceneKey(base), undoSceneKey(changed(base.href.replace('/drive?', '/race?'))));
  assert.notEqual(undoSceneKey(base), undoSceneKey(changed(base.href.replace('road=valley', 'road=sky'))));
  assert.notEqual(undoSceneKey(base), undoSceneKey(changed(base.href.replace('round=1', 'round=2'))));
  assert.equal(undoSceneKey(base), undoSceneKey(changed('http://127.0.0.1:5174/?studio=other#/world/thailand/nan-trip/drive?cam=1&round=1&cam.zoom=1.2&road=valley&feel.steer.slide=5.5')));
  assert.notEqual(undoSceneKey(base), undoSceneKey({ ...base, context: { ...base.context, mode: 'lock' } }));
  assert.notEqual(undoSceneKey(base), undoSceneKey({ ...base, context: { ...base.context, frame: 'ipad-tall' } }));
});
test('tuning requests constrain provider/input and explicitly ask for values without edits', () => {
  const input = { id: randomUUID(), provider: 'codex', prompt: 'Wider please', snapshot };
  assert.equal(labRequestSchema.parse(input).provider, 'codex');
  assert.throws(() => labRequestSchema.parse({ ...input, provider: '/bin/sh' }));
  assert.match(labPrompt(input), /No tools, commands or file edits/);
});
// Exercise real subprocess/JSON/cancel behavior without spending tokens or requiring an external account.
test('both fixed CLI adapters return validated values, surface failures, and honour job ownership on cancel', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-cli-fixture-'));
  const original = process.env.PATH;
  try {
    const script = `#!${process.execPath}\nconst fs = require('node:fs'); let text=''; process.stdin.on('data', b=>text+=b); process.stdin.on('end',()=> { if(text.includes('hold-job')) { setTimeout(()=>{},20000); return; } if(text.includes('fail-job')) { process.stderr.write('Sign in first'); process.exitCode=1; return; } const proposal={explanation:'Wider', changes:[{key:'zoom',value:.8}]}; const i=process.argv.indexOf('--output-last-message'); if(i>=0) fs.writeFileSync(process.argv[i+1],JSON.stringify(proposal)); else process.stdout.write(JSON.stringify({structured_output:proposal})); });`;
    for (const name of ['claude', 'codex']) { await writeFile(path.join(dir, name), script); await chmod(path.join(dir, name), 0o755); }
    process.env.PATH = dir;
    const ai = new LabAi();
    for (const provider of ['claude', 'codex']) {
      const result = await ai.run({ id: randomUUID(), provider, prompt: 'Wider', snapshot }, 7);
      assert.equal(result.changes[0].value, .8);
    }
    await assert.rejects(ai.run({ id: randomUUID(), provider: 'claude', prompt: 'fail-job', snapshot }, 7), /Sign in first/);
    const id = randomUUID();
    const held = ai.run({ id, provider: 'codex', prompt: 'hold-job', snapshot }, 7);
    ai.cancel(id, 8); // another window may not cancel this request
    ai.cancel(id, 7); // works even before the child is spawned
    await assert.rejects(held, /Cancelled/);
  } finally { process.env.PATH = original; await rm(dir, { recursive: true, force: true }); }
});
