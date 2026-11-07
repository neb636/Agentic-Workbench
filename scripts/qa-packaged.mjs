// Run after dist:dir, with all Studio instances closed. No model requests.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const studio = fileURLToPath(new URL('..', import.meta.url));
const folder = process.arch === 'x64' ? 'mac' : `mac-${process.arch}`;
const executablePath = path.join(studio, 'release', folder, 'Kaylee Gamepack Studio.app/Contents/MacOS/Kaylee Gamepack Studio');
const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', WORKBENCH_USER_DATA_DIR: await mkdtemp(path.join(tmpdir(), 'studio-packaged-')) };
delete env.STUDIO_REPO_ROOT;
delete env.VITE_DEV_SERVER_URL;
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
for (const port of [5174, 5175]) {
  let occupied = false;
  try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch {}
  if (occupied) throw new Error(`Quit Studio before this test: port ${port} is in use.`);
}
const gitFixture = await mkdtemp(path.join(tmpdir(), 'studio-git-'));
const git = (...args) => execFileSync('git', args, { cwd: gitFixture, encoding: 'utf8' });
git('init', '-b', 'main'); git('config', 'user.name', 'Studio QA'); git('config', 'user.email', 'studio@example.test');
await writeFile(path.join(gitFixture, 'file.txt'), 'initial'); git('add', '.'); git('commit', '-m', 'fixture'); git('branch', 'feature/chosen');
let app;
try {
  app = await electron.launch({ executablePath, env, timeout: 60000 });
  const page = await app.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal(new URL(page.url()).origin, 'http://127.0.0.1:5175');
  assert.equal(await page.evaluate(() => window.workbench.studio.repoRoot()), null);
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, gitFixture);
  await page.getByRole('button', { name: 'Open the Gamepack repo', exact: true }).first().click();
  const showPanel = page.getByRole('button', { name: 'Show side panel', exact: true });
  if (await showPanel.isVisible()) await showPanel.click();
  await page.getByRole('radio', { name: 'Source control' }).click();
  await page.getByLabel('Checkout branch').selectOption('feature/chosen');
  await page.getByRole('button', { name: 'Switch branch', exact: true }).click();
  await page.locator('.branch-name').filter({ hasText: 'feature/chosen' }).waitFor();
  assert.equal(git('branch', '--show-current').trim(), 'feature/chosen');
  await page.getByLabel('New worktree branch').fill('feature/separate');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await page.locator('.branch-name').filter({ hasText: 'feature/separate' }).waitFor();
  assert.equal(git('branch', '--show-current').trim(), 'feature/chosen');
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, path.dirname(studio));
  await page.getByRole('treegrid', { name: 'Main checkout' }).getByRole('button', { name: 'main actions' }).click();
  await page.getByRole('menuitem', { name: 'Open a different checkout…' }).click();
  await page.getByRole('treegrid', { name: 'Main checkout' }).getByRole('row', { name: /^main/ }).waitFor();
  await page.getByRole('tab', { name: 'Game', exact: true }).click();
  await page.getByRole('button', { name: 'Current section' }).click();
  await page.getByLabel('Game link').fill('#/world/thailand/hub/downstairs?cam=1&cam.frame=ipad-wide');
  await page.keyboard.press('Enter');
  await page.locator('iframe').waitFor();
  await page.frameLocator('iframe').getByRole('slider').nth(5).waitFor();
  await page.getByRole('button', { name: 'Read controls', exact: true }).click();
  await page.getByText(/6 live controls/).waitFor();

  const frame = page.frames().find(frame => frame.url().startsWith('http://127.0.0.1:5174'));
  assert.equal(await frame.evaluate(() => typeof window.workbench), 'undefined');
  // Exercise the packaged native module, not just renderer JavaScript.
  const terminal = await page.evaluate(async root => {
    const id = await window.workbench.pty.create({ cwd: root, cols: 80, rows: 24 });
    window.workbench.pty.terminate(id);
    return id;
  }, path.dirname(studio));
  assert.equal(typeof terminal, 'string');
  assert.deepEqual(errors, []);
  await mkdir(path.join(studio, '../qa-output'), { recursive: true });
  await page.screenshot({ path: path.join(studio, '../qa-output/studio-packaged.png') });
  console.log('PASS: packaged app, Finder PATH, Git branch switch + worktree, chosen checkout, live camera controls, iframe isolation, native PTY');
} finally { await app?.close(); try { git('worktree', 'remove', '--force', `${gitFixture}-worktrees/feature-separate`); } catch { /* may not have been created */ } await rm(gitFixture, { recursive: true, force: true }); await rm(`${gitFixture}-worktrees`, { recursive: true, force: true }); }
for (const port of [5174, 5175]) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await fetch(`http://127.0.0.1:${port}`); } catch { break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
}
console.log('PASS: both loopback servers stopped on quit');
