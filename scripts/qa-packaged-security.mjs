/* global setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const profile = await mkdtemp(path.join(tmpdir(), 'workbench-packaged-security-'));
const executable = path.resolve('release/mac-arm64/Agent Workbench.app/Contents/MacOS/Agent Workbench');
const port = 20000 + Math.floor(Math.random() * 30000);
const child = spawn(executable, [`--remote-debugging-port=${port}`], { env: { ...process.env, WORKBENCH_QA_HIDDEN: '1', WORKBENCH_USER_DATA_DIR: profile, WORKBENCH_CODEX_PATH: path.join(profile,'missing'), WORKBENCH_CLAUDE_PATH: path.join(profile,'missing'), VITE_DEV_SERVER_URL: 'https://example.invalid' }, stdio: ['ignore','pipe','pipe'] });
let diagnostic = '';
child.stderr.on('data', (data) => { diagnostic = (diagnostic + data).slice(-4000); });
let browser;
try {
  for (let i=0;i<100;i++) {
    try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout:500 }); break; }
    catch { if(child.exitCode!==null) throw new Error(`Packaged app exited: ${diagnostic}`); await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  if(!browser) throw new Error(`Packaged app unavailable: ${diagnostic}`);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForURL('workbench://app/index.html');
  await page.getByRole('treegrid', {name:'Workspaces'}).waitFor();
  assert.equal(await page.evaluate(()=>typeof globalThis.require),'undefined');
  assert.ok(await page.locator('meta[http-equiv="Content-Security-Policy"]').count());
  console.log('Packaged security smoke passed: hardened app launches, trusted UI loads, production ignores remote dev override. Profile:',profile);
} finally {
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await browser?.close(); } finally { clearTimeout(force); if (child.exitCode === null) child.kill('SIGKILL'); }
}
