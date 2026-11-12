/* global window, fetch */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { qaEnvironment } from './qa-environment.mjs';
const profile = await mkdtemp(path.join(tmpdir(), 'workbench-security-qa-'));
const root = path.join(profile, 'files'), repo = path.join(profile, 'repo');
await mkdir(root); await mkdir(repo);
await writeFile(path.join(root, 'regex.txt'), 'a'.repeat(32) + '!');
const marker = path.join(profile, 'monitor-ran');
const git = (...args) => execFileSync('git', args, { cwd: repo });
git('init', '--quiet');
await writeFile(path.join(repo, 'tracked.txt'), 'fixture'); git('add', '.');
const hook = path.join(profile, 'monitor.sh');
await writeFile(hook, `#!/bin/sh\nprintf ran > '${marker}'\nprintf 'token\\0'\n`, { mode: 0o700 });
git('config', 'core.fsmonitor', hook);
await writeFile(path.join(profile, 'workbench-state.json'), JSON.stringify({ workspaces: [root,repo].map((p,i) => ({id:String(i),name:'QA',path:p,views:[]})), personas:[], instructionOptions:[], layout:{leftCollapsed:false,rightCollapsed:false} }));
const app = await electron.launch({args:['.'], env:qaEnvironment({WORKBENCH_USER_DATA_DIR:profile,WORKBENCH_CODEX_PATH:path.join(profile,'absent'),WORKBENCH_CLAUDE_PATH:path.join(profile,'absent')})});
try {
  const page=await app.firstWindow();
  await page.waitForFunction(()=>Boolean(window.workbench));
  const prefs=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(prefs.sandbox,true); assert.equal(prefs.nodeIntegration,false);
  await page.evaluate(()=>window.workbench.persistence.load());
  assert.equal(await page.evaluate(async()=>{const state=await window.workbench.persistence.load(); state.workspaces.push({id:'bad',name:'bad',path:'/',views:[]});try{await window.workbench.persistence.save(state);return false;}catch{return true;}}),true);
  await page.evaluate(root=>window.workbench.sourceControl.status(root),repo);
  assert.equal(await access(marker).then(()=>true,()=>false),false);
  const started=Date.now();
  assert.equal(await page.evaluate(async root=>{try{await window.workbench.files.search(root,'^(a+)+$',{regex:true});return false;}catch{return true;}},root),true);
  assert.ok(Date.now()-started<5000);
  assert.equal(await page.evaluate(async()=>{try{await fetch('https://example.com');return false;}catch{return true;}}),true);
  assert.equal(await app.evaluate(async({BrowserWindow,app})=>{const win=new BrowserWindow({show:false,webPreferences:{preload:app.getAppPath()+'/dist-electron/preload/index.js',sandbox:true,contextIsolation:true}});await win.loadURL('data:text/html,<p>Foreign window</p>');const rejected=await win.webContents.executeJavaScript('window.workbench.persistence.load().then(()=>false,()=>true)');win.destroy();return rejected;}),true);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});
  assert.equal(await page.evaluate(async root=>{try{await window.workbench.sourceControl.stage(root,['tracked.txt']);return false;}catch{return true;}},repo),true);
  console.log('Security QA passed: sandbox, sender identity, root grants, passive Git execution, trust cancellation, CSP and cancellable regex. Profile:',profile);
} finally {await app.close();}
