// Deterministic interactive CLI fixture for Electron composer QA; no model calls.
import { appendFileSync, existsSync } from "node:fs";
import { setTimeout } from "node:timers";

// One-shot mode as the internal AI service runs it: prompt on stdin, answer on stdout, no terminal.
// The model list is read with -p too, over stream-json; this fixture doesn't offer one for that protocol.
if (process.argv.includes("--input-format")) process.exit(1);
if (process.argv[2] === "exec" || process.argv[2] === "-p") {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  appendFileSync(process.env.COMPOSER_QA_ONE_SHOTS, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), prompt: input }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 600));
  process.stdout.write("```\nAdd QA notes\n```\n");
  process.exit(0);
}
// The model list the app reads at startup, the shape of `codex debug models`.
if (process.argv[2] === "debug" && process.argv[3] === "models") {
  const levels = (efforts) => efforts.map((effort) => ({ effort }));
  const model = (slug, efforts, visibility = "list") => ({ slug, display_name: slug, visibility, supported_reasoning_levels: levels(efforts) });
  process.stdout.write(JSON.stringify({ models: [
    model("gpt-6-astra", ["low", "medium", "high"]), model("gpt-6-luna", ["low", "medium", "high"]), model("qa-fresh-model", ["low", "high"]), model("qa-hidden-model", ["low"], "hide"),
  ] }));
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
const screen = (text) => process.stdout.write(`\x1b[2J\x1b[H\x1b[?2004h${text}`);
const ready = () => screen(`ERROR: Connection refused\r\n› ${plan ? "\r\n\r\n  Plan mode (⇧tab to cycle)\x1b[2;3H" : ""}`);
let pending = "";
let prompt = "";
let plan = false;
let typedPlan = false;
// Model and effort arrive as launch arguments, like Codex: --model <id> -c model_reasoning_effort="<effort>".
const argv = process.argv.slice(2);
if (process.env.COMPOSER_QA_LAUNCHES) appendFileSync(process.env.COMPOSER_QA_LAUNCHES, JSON.stringify({ argv, cwd: process.cwd() }) + "\n");
// A conversation the CLI no longer has: it says so and exits, as the real ones do.
if (argv[0] === "resume" && existsSync(`${process.env.COMPOSER_QA_LOG}.no-conversations`)) {
  process.stdout.write("No conversation found\r\n");
  process.exit(1);
}
const model = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : "";
const effort = argv.find((arg) => arg.startsWith("model_reasoning_effort="))?.match(/"(.*)"/)?.[1] ?? "";
ready();
process.stdin.on("data", (data) => {
  if (data === "\x03") { pending = ""; prompt = ""; ready(); return; }
  // Ctrl+B: startup work that keeps the CLI busy with its input open.
  if (data === "\x02") { screen("• Working (esc to interrupt)\r\n› "); setTimeout(ready, 2500); return; }
  // Plan mode as Codex does it: /plan, Enter, and the footer shows the mode a moment later. Shift+Tab leaves it.
  if (data === "\x1b[Z") { plan = false; ready(); return; }
  if (data === "/plan") { typedPlan = true; screen("› /plan"); return; }
  if (typedPlan && data === "\r") { typedPlan = false; screen("› "); setTimeout(() => { plan = true; ready(); }, 400); return; }
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
    appendFileSync(process.env.COMPOSER_QA_LOG, JSON.stringify({ prompt, model, effort, plan, cwd: process.cwd() }) + "\n");
    const sent = prompt;
    pending = ""; prompt = "";
    setTimeout(() => {
      if (sent.includes("UNCERTAIN")) screen("Do you want to proceed?\r\n› Yes, proceed");
      // LATE: a hint the composer's rules don't know stays in the input past the confirmation deadline, then clears.
      else if (sent.includes("LATE")) { screen("› Holding your message"); setTimeout(ready, 3000); }
      else ready();
    }, 700);
  }
});
