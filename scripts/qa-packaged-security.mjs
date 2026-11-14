/* global setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const profile = await mkdtemp(path.join(tmpdir(), 'workbench-packaged-security-'));
const executable = path.resolve('release/mac-arm64/DimSum.app/Contents/MacOS/DimSum');
// A workspace to scaffold an extension in: the packaged app must hand it the SDK's types (electron-builder keeps
// *.d.ts out of the archive, so they ship as a resource) and keep them out of Git.
const repo = path.join(profile, 'repo');
await mkdir(repo);
await writeFile(path.join(profile, 'workbench-state.json'), JSON.stringify({ workspaces: [{ id: 'qa', name: 'Packaged QA', path: repo, views: [] }], activeWorkspaceId: 'qa', personas: [], seededInstructionIds: [] }));
const port = 20000 + Math.floor(Math.random() * 30000);
const child = spawn(executable, [`--remote-debugging-port=${port}`], { env: { ...process.env, WORKBENCH_QA_HIDDEN: '1', WORKBENCH_USER_DATA_DIR: profile, DIMSUM_HOME: path.join(profile,'dimsum-home'), WORKBENCH_CODEX_PATH: path.join(profile,'missing'), WORKBENCH_CLAUDE_PATH: path.join(profile,'missing'), VITE_DEV_SERVER_URL: 'https://example.invalid' }, stdio: ['ignore','pipe','pipe'] });
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
  await page.evaluate((root)=>globalThis.workbench.extensions.scaffold(root,'probe'), repo);
  assert.ok((await stat(path.join(repo,'.dimsum','.sdk','sdk','index.d.ts'))).isFile(), 'the scaffold copies the SDK types');
  assert.ok((await readFile(path.join(repo,'.dimsum','AGENTS.md'),'utf8')).includes('ctx.ui.LocalPreview'), 'the scaffold writes the current guide');
  assert.match(await readFile(path.join(repo,'.dimsum','.gitignore'),'utf8'), /^\.sdk\/$/m);
  console.log('Packaged security smoke passed: hardened app launches, trusted UI loads, production ignores remote dev override, scaffolding ships the SDK types. Profile:',profile);
} finally {
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await browser?.close(); } finally { clearTimeout(force); if (child.exitCode === null) child.kill('SIGKILL'); }
}
