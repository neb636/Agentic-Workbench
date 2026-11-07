// Deterministic stand-in for the image agent in Electron QA; it writes candidates itself, so there are no model calls.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import process from "node:process";
import { setTimeout } from "node:timers";
import { deflateSync } from "node:zlib";

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
appendFileSync(process.env.IMAGE_QA_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\n");
const screen = (text) => process.stdout.write(`\x1b[2J\x1b[H\x1b[?2004h${text}`);
const ready = () => screen("Image QA agent\r\n❯ ");
const working = () => screen("✻ Generating… (esc to interrupt)\r\n❯ ");

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return ~crc >>> 0;
}
function png(size, [r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const rows = Array.from({length:size}, (_, y) => {
    const row = Buffer.alloc(1 + size * 4);
    for (let x=0;x<size;x++) { const at=1+x*4; row[at]=r; row[at+1]=g; row[at+2]=b; row[at+3]=x>128 && x<size-128 && y>128 && y<size-128 ? 255 : 0; }
    return row;
  });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const colors = [[214, 112, 88], [96, 148, 206], [120, 178, 112], [204, 170, 80], [150, 110, 196], [90, 170, 170], [200, 120, 160], [130, 130, 130]];

function generate(dir, count) {
  const manifest = { complete: false, variants: Array.from({ length: count }, (_, i) => ({ index: i + 1, title: `Take ${i + 1}`,
    prompt: `Variant ${i + 1} prompt`, sources: i % 2 ? [] : ["source-1.png"], changes: i % 2 ? "Left out the source image." : "Kept the source image.", status: "pending" })) };
  const save = () => writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  save();
  working();
  manifest.variants.forEach((variant, i) => setTimeout(() => {
    // Variant 3 fails the first time, so QA covers retry.
    if (variant.index === 3) { variant.status = "failed"; variant.error = "QA failure"; }
    else { writeFileSync(join(dir, `candidate-${variant.index}.png`), png(1024, colors[i])); variant.status = "done"; }
    if (manifest.variants.every((item) => item.status !== "pending")) { manifest.complete = true; ready(); }
    save();
  }, 400 * (i + 1)));
}

let pending = "";
let prompt = "";
ready();
process.stdin.on("data", (data) => {
  pending += data;
  const start = pending.indexOf("\x1b[200~");
  const end = pending.indexOf("\x1b[201~");
  if (start >= 0 && end >= start) { prompt = pending.slice(start + 6, end); pending = pending.slice(end + 6); screen("❯ pasted draft"); }
  if (!pending.includes("\r") || !prompt) return;
  appendFileSync(process.env.IMAGE_QA_LOG, JSON.stringify({ prompt }) + "\n");
  const sent = prompt; pending = ""; prompt = "";
  const fresh = sent.match(/^Create ONE character concept[\s\S]*?Run folder: (.+)$/m);
  const retry = sent.match(/^Regenerate variant (\d+) in (.+?)\. /m);
  if (fresh) generate(fresh[1], 1);
  else if (retry) {
    const [, index, dir] = retry;
    writeFileSync(join(dir, `candidate-${index}.png`), png(1024, colors[2]));
    const manifestPath = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const variant = manifest.variants.find((item) => item.index === Number(index));
    variant.status = "done"; delete variant.error;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    ready();
  } else ready();
});
