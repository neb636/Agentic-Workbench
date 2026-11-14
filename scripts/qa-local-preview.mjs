import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { assertQaWindowVisibility, qaEnvironment } from "./qa-environment.mjs";

// QA inventory, with no CLI and no model use. A user extension's view shows a page from a loopback server:
// - The page loads with its own inline script (the app's CSP is not applied to it) and has no app preload.
// - It says hello, gets a port, and messages go both ways; a reload reconnects and the old connection goes quiet.
// - It can't read the clipboard, navigate itself off loopback or navigate the app.
// - A URL that isn't on this machine is refused in place, without a frame.
const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-local-preview-qa-")));
const shots = process.env.QA_SHOTS ?? directory;
const home = join(directory, "dimsum-home");
const repo = join(directory, "repo");

const page = `<!doctype html><meta charset="utf-8"><title>Game</title>
<body style="font: 14px sans-serif; background: #fffbe6"><h1>Local game</h1><p id="state">waiting</p>
<script>
  const state = document.getElementById("state");
  let port;
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.dimsum !== "local-preview.connect") return;
    port = event.ports[0];
    state.textContent = "connected from " + event.origin;
    port.onmessage = async ({ data }) => {
      if (data.ping !== undefined) port.postMessage({ pong: data.ping, loads: Number(sessionStorage.loads) });
      if (data.probe) {
        let clipboard = "allowed";
        try { await navigator.clipboard.readText(); } catch (error) { clipboard = "refused"; }
        let parentAccess = "refused";
        try { parentAccess = typeof parent.workbench; } catch {}
        port.postMessage({ probe: { preload: typeof window.workbench, clipboard, parentAccess } });
      }
      // [::1] is this machine too, but not a host a preview may use: only main's navigation check stops these.
      if (data.leave) location.href = "http://[::1]:" + location.port + "/left";
      if (data.nest) for (const src of ["http://[::1]:" + location.port + "/nested-off", "/nested-ok"]) {
        const frame = document.createElement("iframe"); frame.src = src; document.body.append(frame);
      }
      if (data.top) { try { top.location.href = "https://example.com/"; } catch (error) { port.postMessage({ top: "refused" }); } }
      if (data.reload) location.reload();
    };
  });
  sessionStorage.loads = Number(sessionStorage.loads ?? 0) + 1;
  parent.postMessage({ dimsum: "local-preview.hello" }, "*");
</script>`;
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(page);
});
// Both stacks, so the same page is reachable on [::1], which previews may not use.
await new Promise((done) => server.listen(0, "::", done));
const origin = `http://127.0.0.1:${server.address().port}`;

await mkdir(repo, { recursive: true });
await mkdir(join(home, "extensions", "preview"), { recursive: true });
await writeFile(join(home, "extensions", "preview", "index.tsx"), `import { useRef, useState } from "react";
import { defineExtension, type ExtensionContext, type LocalPreviewConnection } from "@dimsum/sdk";

const Icon = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" /></svg>;

function view(ctx: ExtensionContext, url: string) {
  return function Preview() {
    const connection = useRef<LocalPreviewConnection>();
    const [connections, setConnections] = useState(0);
    const [last, setLast] = useState("");
    const [stale, setStale] = useState<LocalPreviewConnection>();
    const [shown, setShown] = useState(url);
    const send = (data: unknown) => connection.current?.post(data);
    return <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
      <div className="qa-preview-bar">
        <span className="qa-connections">connections {connections}</span> <span className="qa-last">{last}</span>
        <button type="button" onClick={() => send({ ping: 1 })}>Ping</button>
        <button type="button" onClick={() => send({ probe: true })}>Probe</button>
        <button type="button" onClick={() => send({ nest: true })}>Nest</button>
        <button type="button" onClick={() => send({ leave: true })}>Leave</button>
        <button type="button" onClick={() => send({ top: true })}>Top</button>
        <button type="button" onClick={() => { setStale(() => connection.current); send({ reload: true }); }}>Reload</button>
        <button type="button" onClick={() => stale?.post({ ping: 99 })}>Stale ping</button>
        <button type="button" onClick={() => setShown(url.replace(/#.*/, "#/game"))}>Hash</button>
      </div>
      <ctx.ui.LocalPreview url={shown} title="Local game"
        onConnect={(next) => { connection.current = next; setConnections((n) => n + 1); }}
        onMessage={(data) => setLast(JSON.stringify(data))} />
    </div>;
  };
}

export default defineExtension({ name: "Preview", activate(ctx) {
  ctx.views.register({ id: "preview.local", label: "Local preview", description: "QA", icon: Icon, component: view(ctx, ${JSON.stringify(`${origin}/#/lab?feel=1`)}) });
  ctx.views.register({ id: "preview.remote", label: "Remote preview", description: "QA", icon: Icon, component: view(ctx, "https://example.com/") });
} });
`);
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Preview QA", path: repo, activeViewId: "local", views: [
    { id: "local", workspaceId: "qa", type: "preview.local", title: "Local" },
    { id: "remote", workspaceId: "qa", type: "preview.remote", title: "Remote" },
  ] }],
  activeWorkspaceId: "qa", personas: [], seededInstructionIds: [],
}));

const app = await electron.launch({ args: ["."], env: qaEnvironment({ WORKBENCH_USER_DATA_DIR: directory, DIMSUM_HOME: home }) });
const window = await app.firstWindow();
await assertQaWindowVisibility(app);
window.setDefaultTimeout(10_000);
const errors = [];
window.on("pageerror", (error) => errors.push(String(error)));
const shot = async (name) => {
  await window.waitForTimeout(200);
  const bytes = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const [width, height] = w.getContentSize(); return (await w.capturePage()).resize({ width, height }).toPNG(); });
  await writeFile(join(shots, `${name}.png`), Buffer.from(bytes));
};
const frameUrls = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.mainFrame.framesInSubtree.map((frame) => frame.url));
// What each frame really loaded: a blocked navigation can leave the attempted URL in frame.url over an empty document.
const loaded = () => app.evaluate(({ BrowserWindow }) => Promise.all(BrowserWindow.getAllWindows()[0].webContents.mainFrame.framesInSubtree
  .map((frame) => frame.executeJavaScript("location.href + ' ' + document.title").catch(() => "unreachable"))));
const offLoopback = (entries) => entries.filter((entry) => entry.startsWith("http://[::1]"));
const last = () => window.locator(".qa-last").textContent();
const until = async (check, what) => { for (let i = 0; i < 100; i++) { if (await check().catch(() => false)) return; await window.waitForTimeout(100); } throw new Error(`Timed out waiting for ${what}`); };

try {
  const game = window.frameLocator('iframe[title="Local game"]');
  await game.getByText(/connected from /).waitFor();
  // In the packaged app the parent is workbench://app; under `npm run dev` it would be the Vite origin.
  assert.match(await game.locator("#state").textContent(), /connected from (workbench:\/\/app|http:\/\/127\.0\.0\.1:5173)/);
  await window.locator(".qa-connections", { hasText: "connections 1" }).waitFor();
  assert.ok((await frameUrls()).includes(`${origin}/#/lab?feel=1`));
  await shot("1-connected");

  await window.getByRole("button", { name: "Ping", exact: true }).click();
  await until(async () => JSON.parse((await last()) || "{}").pong === 1, "pong");
  // sessionStorage outlives a remount of the view, so loads count from here.
  const { loads } = JSON.parse(await last());

  await window.getByRole("button", { name: "Probe" }).click();
  await until(async () => (await last()).includes("probe"), "probe");
  assert.deepEqual(JSON.parse(await last()).probe, { preload: "undefined", clipboard: "refused", parentAccess: "refused" });

  await window.getByRole("button", { name: "Top" }).click();
  await until(async () => (await last()).includes('"top":"refused"'), "top navigation refused");
  assert.ok(!(await window.evaluate(() => document.location.href)).includes("example.com"));

  // A reload says hello again: a new connection, and the old one does nothing.
  await window.getByRole("button", { name: "Reload" }).click();
  await window.locator(".qa-connections", { hasText: "connections 2" }).waitFor();
  await window.getByRole("button", { name: "Ping", exact: true }).click();
  await until(async () => (await last()) === JSON.stringify({ pong: 1, loads: loads + 1 }), "pong after reload");
  await window.getByRole("button", { name: "Stale ping" }).click();
  await window.waitForTimeout(500);
  assert.equal(await last(), JSON.stringify({ pong: 1, loads: loads + 1 }), "a stale connection sends nothing");

  // A new fragment only: the same document, so the same connection keeps working.
  await window.getByRole("button", { name: "Hash" }).click();
  await until(async () => (await frameUrls()).some((url) => url.endsWith("#/game")), "fragment change");
  await window.getByRole("button", { name: "Probe" }).click();
  await until(async () => (await last()).includes("probe"), "probe after a fragment change");
  await window.locator(".qa-connections", { hasText: "connections 2" }).waitFor();

  // Frames the page opens itself (outside the app's CSP): a local one loads, one off the allowed hosts doesn't.
  await window.getByRole("button", { name: "Nest" }).click();
  await until(async () => (await loaded()).some((entry) => entry.includes("/nested-ok Game")), "nested local frame");
  await window.waitForTimeout(800);
  assert.deepEqual(offLoopback(await loaded()), [], "a nested frame can't load off the allowed hosts");

  // Off the allowed hosts: the app's CSP blocks it and the frame shows an error page instead.
  await window.getByRole("button", { name: "Leave" }).click();
  await window.waitForTimeout(800);
  assert.deepEqual(offLoopback(await loaded()), [], "the frame can't leave the allowed hosts");
  // Not on this machine: refused in place, no frame.
  await window.getByRole("tab", { name: /Remote/ }).click();
  await window.getByRole("alert").filter({ hasText: "Only pages served on this machine" }).waitFor();
  assert.equal(await window.locator('iframe[title="Local game"]:visible').count(), 0);
  assert.ok((await frameUrls()).every((url) => !url.includes("example.com")));
  await shot("2-refused");

  assert.deepEqual(errors, []);
  console.log(`Local preview QA passed. Screenshots: ${shots}`);
} catch (error) {
  await shot("failure").catch(() => undefined);
  console.error("Frames:", await frameUrls().catch(String), "Page errors:", errors);
  throw error;
} finally {
  await app.close();
  server.close();
}
