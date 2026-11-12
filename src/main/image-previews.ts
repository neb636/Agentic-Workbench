import { BrowserWindow } from "electron";

let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
export function imagePreview(bytes: Buffer, side: number, square = false): Promise<string | null> {
  if (pending >= 12) return Promise.resolve(null);
  pending++;
  const next = queue.catch(() => undefined).then(() => decodePreview(bytes, side, square)).finally(() => pending--);
  queue = next;
  return next;
}

/** Decode user-controlled pictures in a disposable sandboxed renderer with no preload or network access. */
async function decodePreview(bytes: Buffer, side: number, square = false): Promise<string | null> {
  if (bytes.length > 25 * 1024 * 1024) return null;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) return null;
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "image-preview" } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const timer = setTimeout(() => { if (!window.isDestroyed()) window.destroy(); }, 5000);
  try {
    await window.loadURL("data:text/html,<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:\"><canvas></canvas>");
    // Only the serialized data URL is interpolated; decoded bytes never become HTML or source code.
    const data = JSON.stringify(`data:${png ? "image/png" : "image/jpeg"};base64,${bytes.toString("base64")}`);
    return await window.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${data}; await image.decode();
      const w = image.naturalWidth, h = image.naturalHeight;
      if (!w || !h || w * h > 40_000_000) return null;
      const canvas = document.querySelector('canvas');
      const crop = ${square}; const side = ${side};
      const scale = Math.min(1, side / Math.min(w, h));
      canvas.width = crop ? side : Math.round(w * scale);
      canvas.height = crop ? side : Math.round(h * scale);
      if (canvas.width * canvas.height > 4_000_000) return null;
      const ctx = canvas.getContext('2d');
      if (crop) { const size = Math.min(w,h); ctx.drawImage(image,(w-size)/2,(h-size)/2,size,size,0,0,side,side); }
      else ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/png');
    })()`);
  } catch { return null; }
  finally { clearTimeout(timer); if (!window.isDestroyed()) window.destroy(); }
}
