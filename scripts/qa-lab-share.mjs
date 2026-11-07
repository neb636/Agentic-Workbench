// Native clipboard and composer handoffs. Start `node scripts/dev.mjs --servers-only` first.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const profile = await mkdtemp(path.join(tmpdir(), 'studio-share-qa-'));
let app;
try {
  app = await electron.launch({ args: ['.'], env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5175', STUDIO_REPO_ROOT: path.resolve('..'), WORKBENCH_USER_DATA_DIR: profile } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  let activeFrame;
  const goto = async link => {
    await page.getByRole('button', { name: 'Current section' }).click();
    await page.getByLabel('Game link').fill(link); await page.keyboard.press('Enter');
    const element = page.locator('iframe[title^="Game:"]');
    await element.waitFor();
    activeFrame = await (await element.elementHandle()).contentFrame();
    await activeFrame.waitForURL(url => url.hash.split('?')[0] === link.split('?')[0]);
  };
  const game = () => activeFrame;
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  await goto('#/world/thailand/hub/downstairs?cam=1&cam.frame=ipad-wide&cam.zoom=0.9');
  await game().getByRole('button', { name: 'Send to agent', exact: true }).waitFor();
  await game().waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Send to agent' && !b.disabled));
  // Clipboard is denied to the iframe: copying still succeeds through native Studio IPC.
  await game().evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await game().getByRole('button', { name: 'Copy link', exact: true }).click();
  await page.getByText('Copied to clipboard', { exact: true }).waitFor();
  assert.match(await clipboard(), /cam.zoom=0.9/);
  assert.equal(await game().evaluate(() => typeof window.workbench), 'undefined');
  const draft = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await draft.fill('Keep my existing note');
  await page.getByRole('button', { name: 'Collapse composer', exact: true }).click();
  await game().getByRole('button', { name: 'Send to agent', exact: true }).click();
  await page.getByLabel(/Quoted context/).getByText('Camera lab changes', { exact: true }).waitFor();
  assert.equal(await draft.inputValue(), 'Keep my existing note');
  await game().getByRole('button', { name: 'Send to agent', exact: true }).click();
  assert.equal(await page.getByLabel(/Quoted context/).getByText('Camera lab changes', { exact: true }).count(), 1);
  await page.getByLabel(/Quoted context/).getByText('Camera lab changes', { exact: true }).click();
  await page.getByLabel(/Quoted context/).locator('pre').filter({ hasText: 'cam.zoom=0.9' }).waitFor();
  // A spoof from the parent has the right origin but the wrong source and cannot write to the clipboard.
  const before = await clipboard();
  await page.evaluate(() => window.postMessage({ channel: 'kaylee-studio-v1', shareId: 'spoof', share: { action: 'copy', label: 'Spoof', text: 'bad' } }, location.origin));
  await page.waitForTimeout(200);
  assert.equal(await clipboard(), before);
  await goto('#/world/thailand/nan-trip/drive?feel=1&feel.steer.slide=5.5');
  await game().getByRole('button', { name: 'Send to agent', exact: true }).waitFor();
  await game().getByRole('button', { name: 'Send to agent', exact: true }).click();
  await page.getByLabel(/Quoted context/).getByText('Feel lab changes', { exact: true }).waitFor();
  assert.equal(await draft.inputValue(), 'Keep my existing note');
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await page.getByText('Link copied', { exact: true }).waitFor();
  assert.match(await clipboard(), /feel.steer.slide=5.5/);
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await page.getByLabel(/Quoted context/).getByText('Game section', { exact: true }).waitFor();
  await goto('#/world/characters/nick');
  await page.getByRole('button', { name: 'Prepare character builder prompt' }).waitFor();
  await game().getByRole('button', { name: /Copy.*link|Share/i }).click();
  await page.getByText('Copied to clipboard', { exact: true }).waitFor();
  assert.match(await clipboard(), /#\/world\/characters\/nick/);
  await page.screenshot({ path: '/tmp/studio-lab-share.png' });
  assert.deepEqual(errors, []);
  console.log('Native link copy (camera, feel, character), composer attachments, draft preservation, iframe isolation and spoof rejection passed.');
} catch (error) {
  const page = await app?.firstWindow();
  console.error(await page?.locator('body').innerText());
  console.error(page?.frames().map(f => f.url()));
  await page?.screenshot({ path: '/tmp/studio-share-failure.png' });
  throw error;
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
