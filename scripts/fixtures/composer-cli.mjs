// Deterministic interactive CLI fixture for Electron composer QA; no model calls.
import { appendFileSync } from "node:fs";
import { setTimeout } from "node:timers";

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
const screen = (text) => process.stdout.write(`\x1b[2J\x1b[H\x1b[?2004h${text}`);
const ready = () => screen("ERROR: Connection refused\r\n› ");
let pending = "";
let prompt = "";
// Model and effort arrive as launch arguments, like Codex: --model <id> -c model_reasoning_effort="<effort>".
const argv = process.argv.slice(2);
const model = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : "";
const effort = argv.find((arg) => arg.startsWith("model_reasoning_effort="))?.match(/"(.*)"/)?.[1] ?? "";
ready();
process.stdin.on("data", (data) => {
  if (data === "\x03") { pending = ""; prompt = ""; ready(); return; }
  // Mouse reports from the window's terminal are not input to the editor.
  // eslint-disable-next-line no-control-regex
  pending += data.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "");
  const start = pending.indexOf("\x1b[200~");
  const end = pending.indexOf("\x1b[201~");
  if (start >= 0 && end >= start) {
    prompt = pending.slice(0, start) + pending.slice(start + 6, end);
    pending = pending.slice(end + 6);
    screen("› pasted draft");
  }
  if (pending.includes("\r") && prompt) {
    appendFileSync(process.env.COMPOSER_QA_LOG, JSON.stringify({ prompt, model, effort, cwd: process.cwd() }) + "\n");
    const sent = prompt;
    pending = ""; prompt = "";
    setTimeout(() => {
      if (sent.includes("UNCERTAIN")) screen("Do you want to proceed?\r\n› Yes, proceed");
      else ready();
    }, 700);
  }
});
