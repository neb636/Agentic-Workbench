// Desktop lab integration smoke test. Start `npm run studio` first. Uses fixture CLIs, no model calls.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const profile = await mkdtemp(path.join(tmpdir(), 'gamepack-labs-qa-'));
const repo = path.resolve('..');
await fetch('http://127.0.0.1:5175');
const fixture = `#!${process.execPath}\nconst fs=require('node:fs');let text='';process.stdin.on('data',b=>text+=b);process.stdin.on('end',()=>{const feel=text.includes('"kind":"feel"');const fail=text.includes('FAIL_PREVIEW');const none=text.includes('NO_CHANGES');const p={explanation:none?'Fixture no changes':'Fixture control update',changes:none?[]:[{key:feel?'steer.slide':'zoom',value:feel?5.5:.9}]};setTimeout(()=>{if(fail){process.stderr.write('Fixture failed');process.exitCode=1;return;}const i=process.argv.indexOf('--output-last-message');if(i>=0)fs.writeFileSync(process.argv[i+1],JSON.stringify(p));else process.stdout.write(JSON.stringify({structured_output:p}));},900);});`;
for(const name of ['claude','codex']) await writeFile(path.join(profile,name),fixture,{mode:0o755});
let app;
try {
  app = await electron.launch({args:['.'],env:{...process.env,VITE_DEV_SERVER_URL:'http://127.0.0.1:5175',STUDIO_REPO_ROOT:repo,WORKBENCH_USER_DATA_DIR:profile,PATH:`${profile}${path.delimiter}${process.env.PATH}`}});
  const page=await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // The game and each lab are tabs in the middle (one running game); a pasted link opens a section with a lab on.
  const tab = async name=>{await page.getByRole('button',{name:'New tab'}).click();await page.getByRole('menuitem',{name}).click();};
  await tab(/Camera lab/);
  const goto = async link=>{await page.getByRole('button',{name:'Current section'}).click();await page.getByLabel('Game link').fill(link);await page.keyboard.press('Enter');};
  await goto('#/world/thailand/hub/downstairs?cam=1&cam.frame=ipad-wide');
  // This checkout's game runs on whichever loopback port Studio's server pool gave it.
  const frame=()=>page.frames().find(f=>/^http:\/\/127\.0\.0\.1:\d+\/\?studio=1/.test(f.url()));
  // The first game start in a fresh profile builds its dependencies: read again until the lab answers.
  for(let tries=0;;tries++){
    await page.getByRole('button',{name:'Read controls',exact:true}).click();
    try{await page.getByText(/6 live controls/).waitFor({timeout:5000});break;}catch(e){if(tries>=12)throw e;}
  }
  assert.equal(await frame().evaluate(()=>typeof window.workbench),'undefined');
  await page.getByLabel('Lab prompt').fill('Wider please');
  await page.getByLabel('AI provider').selectOption('codex');
  await page.getByRole('button',{name:'Ask AI & preview controls'}).click();
  await page.getByText('Fixture control update',{exact:true}).waitFor();
  assert.equal(await frame().getByRole('slider').nth(2).inputValue(),'0.9');
  // A later unsuccessful request must preserve the applied preview's original Undo.
  await page.getByLabel('Lab prompt').fill('FAIL_PREVIEW');
  await page.getByRole('button',{name:'Ask AI & preview controls'}).click();
  await page.getByText(/codex exited 1: Fixture failed/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Undo AI change'}).isEnabled(),true,'Failed follow-up must preserve Undo');
  await page.getByLabel('Lab prompt').fill('NO_CHANGES');
  await page.getByRole('button',{name:'Ask AI & preview controls'}).click();
  await page.getByText('Fixture no changes',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Undo AI change'}).isEnabled(),true,'No-change follow-up must preserve Undo');
  await page.getByLabel('Lab prompt').fill('Wider please');
  await page.getByRole('button',{name:'Ask AI & preview controls'}).click();
  await page.getByText('Asking codex…',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.studio-actions button').disabled);
  assert.equal(await page.getByRole('button',{name:'Undo AI change'}).isEnabled(),true,'Cancelled follow-up must preserve Undo');
  assert.equal(await frame().getByRole('slider').nth(2).inputValue(),'0.9');
  // Navigate inside the game, so this studio view retains Undo while the section changes.
  await frame().getByRole('button',{name:'Downstairs',exact:true}).click();
  await frame().getByRole('menuitemradio',{name:/Kaylee.s room upstairs/}).click();
  await frame().getByRole('button',{name:"Kaylee's room upstairs",exact:true}).waitFor();
  await frame().getByRole('slider').nth(2).focus(); await page.keyboard.press('ArrowRight');
  const otherZoom=await frame().getByRole('slider').nth(2).inputValue();
  await page.getByRole('button',{name:'Undo AI change'}).click();
  await page.getByText(/Return to the original scene, mode and frame before undoing/).waitFor();
  assert.equal(await frame().getByRole('slider').nth(2).inputValue(),otherZoom,'Undo must not alter a different section');
  await frame().getByRole('button',{name:"Kaylee's room upstairs",exact:true}).click();
  await frame().getByRole('menuitemradio',{name:/Downstairs/}).click();
  await frame().getByRole('button',{name:'Downstairs',exact:true}).waitFor();
  await page.getByRole('button',{name:'Undo AI change'}).click();
  await page.getByText('Restored the controls from before AI tuning.').waitFor();
  assert.equal(await frame().getByRole('slider').nth(2).inputValue(),'1');
  assert.equal(await frame().getByRole('slider').nth(3).inputValue(),'30');
  await page.getByRole('button',{name:'Ask AI & preview controls'}).click();
  await page.getByText('Fixture control update',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Ask AI & preview controls'}).click();
  await page.getByText('Asking codex…',{exact:true}).waitFor();
  await frame().getByRole('slider').nth(2).focus(); await page.keyboard.press('ArrowRight');
  await page.getByText(/The scene or controls changed while AI was thinking/).waitFor();
  assert.equal(await frame().getByRole('slider').nth(2).inputValue(),'0.91');
  assert.equal(await page.getByRole('button',{name:'Undo AI change'}).isEnabled(),true,'Stale follow-up must preserve Undo');
  await page.getByRole('button',{name:'Undo AI change'}).click();
  await page.getByText('Restored the controls from before AI tuning.').waitFor();
  assert.equal(await frame().getByRole('slider').nth(2).inputValue(),'1');
  await page.getByRole('button',{name:'Ask AI & preview controls'}).click();
  await page.getByText('Asking codex…',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Ask AI & preview controls'}).waitFor({state:'visible'});
  await goto('#/world/thailand/nan-trip/drive?feel=1');
  await page.getByRole('button',{name:'Read controls',exact:true}).click();
  await page.getByText(/38 live controls/).waitFor();
  await page.getByLabel('Lab prompt').fill('Gentler steering');
  await page.getByRole('button',{name:'Ask AI & preview controls'}).click();
  await page.getByText('Fixture control update',{exact:true}).waitFor();
  assert.match(frame().url(),/feel\.steer\.slide=5.5/);
  // Over to the Game tab and back to the Feel lab tab keeps the tuned values in the link.
  await tab(/^🎮 Game/); await tab(/Feel lab/);
  await page.getByRole('button',{name:'Read controls',exact:true}).click();
  assert.match(frame().url(),/feel\.steer\.slide=5.5/);
  await page.getByRole('button',{name:'Prepare prompt to save in game'}).click();
  const draft=page.getByRole('textbox',{name:'Prompt',exact:true}); await draft.waitFor();
  // The prepared prompt opens a new agent tab: wait until its composer shows it.
  const prepared=async re=>{for(let i=0;i<40&&!re.test(await draft.inputValue());i++) await page.waitForTimeout(250);return draft.inputValue();};
  assert.match(await prepared(/feel\.steer\.slide=5.5/),/feel\.steer\.slide=5.5/);
  assert.match(await draft.inputValue(),/mountain\.ts/);
  await tab(/Character lab/);
  await page.getByRole('button',{name:'Prepare character builder prompt'}).click();
  await draft.waitFor(); assert.match(await prepared(/"kind": "character"/),/"kind": "character"/);
  assert.match(await draft.inputValue(),/#\/world\/characters\/nick/);
  assert.deepEqual(errors,[]);
  console.log('Camera/Feel preview and Undo, Undo retained after failed/cancelled/stale/no-change follow-ups, cross-section Undo guard, link persistence, handoffs and native isolation passed.');
} finally {await app?.close();}
