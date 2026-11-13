import { app, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, session, protocol, net } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleFor } from "./extensions/bundles";

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
  window.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
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
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(appContents(contents) && clipboardPermission(permission)));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => appContents(contents) && clipboardPermission(permission));
  session.defaultSession.on("will-download", (event) => event.preventDefault());
  const dev = developmentUrl();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const policy = `default-src 'self'; script-src 'self' workbench://ext${dev ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${dev ? "'self' ws://127.0.0.1:5173" : "'none'"}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [policy] } });
  });
}
