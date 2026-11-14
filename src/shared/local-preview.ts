// A local preview is a web page served on this machine (a game's or a site's development server) that an extension
// shows inside one of its views. Main checks every frame navigation with it; the renderer checks the URL it is given.
// Pure: no Electron, React or Node.

const HOSTS = new Set(["127.0.0.1", "localhost"]);

/** The CSP `frame-src` sources that match `localPreviewUrl`. CSP has no syntax for IPv6 literals, so `[::1]` is left out. */
export const LOCAL_PREVIEW_FRAME_SOURCES = ["http", "https"].flatMap((scheme) => [...HOSTS].map((host) => `${scheme}://${host}:*`)).join(" ");

/** What the page posts to its parent to ask for a connection, and what the app answers with (the port in `ports[0]`). */
export const LOCAL_PREVIEW_HELLO = "local-preview.hello";
export const LOCAL_PREVIEW_CONNECT = "local-preview.connect";

/**
 * The URL when it may be shown as a local preview: http(s) on 127.0.0.1 or localhost, without credentials, and never
 * the app's own origin (in development the app itself is served from loopback, and a frame of it would be same-origin
 * with the app).
 */
export function localPreviewUrl(value: string, appOrigin?: string): URL | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (!HOSTS.has(url.hostname) || url.username || url.password) return undefined;
  if (appOrigin && url.origin === appOrigin) return undefined;
  return url;
}
