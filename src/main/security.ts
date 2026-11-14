import { app, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, session, protocol, net } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleFor } from "./extensions/bundles";
import { LOCAL_PREVIEW_FRAME_SOURCES, localPreviewUrl } from "../shared/local-preview";

export const APP_URL = "workbench://app/index.html";
protocol.registerSchemesAsPrivileged([{ scheme: "workbench", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const windows = new Set<Electron.WebContents>();
export function developmentUrl(): string | undefined {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return undefined;
  const url = new URL(process.env.VITE_DEV_SERVER_URL);
  if (url.origin !== "http://127.0.0.1:5173") throw new Error("Development server must use the configured loopback endpoint.");
  return url.href;
}
export function registerAppWindow(window: BrowserWindow): void {
  windows.add(window.webContents);
  window.webContents.once("destroyed", () => windows.delete(window.webContents));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  // The app's own document never navigates. Frames inside it (an extension's local preview, and frames that page opens)
  // may only go to pages served on this machine.
  window.webContents.on("will-frame-navigate", (event) => { if (!localFrame(event)) event.preventDefault(); });
  window.webContents.on("will-redirect", (event) => { if (!localFrame(event)) event.preventDefault(); });
}
function devOrigin(): string | undefined {
  const dev = developmentUrl();
  return dev && new URL(dev).origin;
}
function localFrame({ isMainFrame, url }: { isMainFrame: boolean; url: string }): boolean {
  return !isMainFrame && Boolean(localPreviewUrl(url, devOrigin()));
}
/** The app's own document and the files it loads, as opposed to a local preview's. */
function appResource(url: string): boolean {
  if (url.startsWith("workbench://")) return true;
  const dev = devOrigin();
  try { return Boolean(dev) && new URL(url).origin === dev; } catch { return false; }
}
export function assertAppSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  const expected = developmentUrl() ?? APP_URL;
  if (!windows.has(event.sender) || !frame || frame !== event.sender.mainFrame || frame.url.split("#")[0] !== expected.split("#")[0]) {
    throw new Error("Untrusted app document");
  }
}
export function configureSecurity(): void {
  protocol.handle("workbench", async (request) => {
    const url = new URL(request.url);
    // Extension scripts the host built, from memory; never a file.
    if (url.host === "ext") {
      const code = request.method === "GET" ? bundleFor(url) : undefined;
      return code === undefined ? new Response(null, { status: 404 }) : new Response(code, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
    }
    const root = path.resolve(__dirname, "../../dist");
    const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    const relative = path.relative(root, file);
    if (url.host !== "app" || request.method !== "GET" || relative.startsWith("..") || path.isAbsolute(relative)) return new Response(null, { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  const clipboardPermission = (permission: string) => ["clipboard-read", "clipboard-sanitized-write", "deprecated-sync-clipboard-read"].includes(permission);
  const appContents = (contents: Electron.WebContents | null) => Boolean(contents && windows.has(contents) && contents.getURL().split("#")[0] === (developmentUrl() ?? APP_URL));
  // Only the app's own document: a local preview runs in the same webContents but is someone else's page.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(appContents(contents) && details.isMainFrame && clipboardPermission(permission)));
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => appContents(contents) && details.isMainFrame && clipboardPermission(permission));
  session.defaultSession.on("will-download", (event) => event.preventDefault());
  const dev = developmentUrl();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // A local preview keeps the policy its own server sends; the app's would stop it loading its scripts and assets.
    if (!appResource(details.url)) { callback({}); return; }
    const policy = `default-src 'self'; script-src 'self' workbench://ext${dev ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${dev ? "'self' ws://127.0.0.1:5173" : "'none'"}; object-src 'none'; frame-src ${LOCAL_PREVIEW_FRAME_SOURCES}; base-uri 'none'; form-action 'none'`;
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [policy] } });
  });
}
