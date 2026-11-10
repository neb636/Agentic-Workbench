#!/usr/bin/env node
// Records what a native CLI really draws, so the composer's screen rules can be tested against it.
//
//   node scripts/cli-probe.mjs codex --cwd ~/repos/some-project \
//     --steps "wait:8000 key:esc wait:3000 type:/plan wait:600 key:enter wait:3000" \
//     --out tests/fixtures/codex-plan.json
//
// Steps: wait:<ms>, type:<text>, paste:<text>, key:<enter|esc|shift-tab|tab|ctrl-c|backspace>, mouse (a pointer move),
// mark:<name> (a named checkpoint for transcript inspection). Each step prints the bottom of the screen.
// The fixture holds the raw output chunks (with step marks), the terminal size and the CLI's version, never the
// environment. Re-record when a CLI update changes its screens, then verify the adapter behavior with focused QA.
// --model and --effort launch the CLI with that model. Send a real prompt only when a screen can't be seen otherwise
// (such as a prompt queued mid-turn), and then only as AGENTS.md allows: the cheapest model at low effort, a short
// prompt that needs no tools, and never past a billing, login or trust prompt.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const pty = require("node-pty");
const { Terminal } = require("@xterm/headless");

const args = process.argv.slice(2);
const cli = args[0];
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i > 0 ? args[i + 1] : fallback; };
if (!["codex", "claude"].includes(cli)) {
  console.error("Usage: node scripts/cli-probe.mjs <codex|claude> [--cwd dir] [--steps \"...\"] [--out file] [--cols 120] [--rows 40] [--model id] [--effort level]");
  process.exit(1);
}
const cwd = path.resolve(option("cwd", process.cwd()).replace(/^~/, process.env.HOME ?? "~"));
const cols = Number(option("cols", 120)), rows = Number(option("rows", 40));
const steps = (option("steps", "wait:8000")).split(/\s+(?=(?:wait|type|paste|key|mouse|mark)\b)/).filter(Boolean);
const out = option("out");
const model = option("model"), effort = option("effort");
// The same launch arguments the adapters build (modelArgs).
const launchArgs = !model ? [] : cli === "claude" ? ["--model", model, ...(effort ? ["--effort", effort] : [])]
  : ["--model", model, ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : [])];
const executable = execFileSync("/bin/sh", ["-lc", `command -v ${cli}`], { encoding: "utf8" }).trim();
const version = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
const keys = { enter: "\r", esc: "\x1b", "shift-tab": "\x1b[Z", tab: "\t", "ctrl-c": "\x03", backspace: "\x7f" };

const terminal = new Terminal({ cols, rows, scrollback: 2000, allowProposedApi: true });
// A probe run from inside an agent session must not inherit that session's markers.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDECODE|CLAUDE_CODE_|CODEX_)/.test(key)));
const child = pty.spawn(executable, launchArgs, { name: "xterm-256color", cwd, cols, rows, env: { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" } });
const started = Date.now();
const chunks = [];
terminal.onData((data) => child.write(data));
child.onData((data) => { chunks.push({ at: Date.now() - started, data }); terminal.write(data); });

const flush = () => new Promise((resolve) => terminal.write("", resolve));
async function show(label) {
  await flush();
  const buffer = terminal.buffer.active;
  const lines = Array.from({ length: rows }, (_, i) => buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? "");
  const last = lines.findLastIndex((line) => line.trim());
  console.log(`\n── ${label} · cursor ${buffer.cursorX},${buffer.cursorY} · paste ${terminal.modes.bracketedPasteMode ? "on" : "off"}`);
  for (let i = Math.max(0, last - 9); i <= last; i++) if (lines[i].trim()) console.log(`${String(i).padStart(2)} │${lines[i]}`);
}

for (const step of steps) {
  const [kind, ...rest] = step.split(":");
  const value = rest.join(":");
  if (kind === "wait") await sleep(Number(value));
  else if (kind === "type") child.write(value);
  else if (kind === "paste") child.write(`\x1b[200~${value}\x1b[201~`);
  else if (kind === "key") { if (!keys[value]) throw new Error(`Unknown key ${value}`); child.write(keys[value]); }
  else if (kind === "mouse") child.write("\x1b[<35;10;10M");
  else if (kind === "mark") chunks.push({ at: Date.now() - started, mark: value });
  else throw new Error(`Unknown step ${step}`);
  if (kind === "wait" || kind === "mark") await show(step);
}
child.kill();
if (out) {
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  // Paths in the transcript are the user's own; keep only the folder name.
  const home = process.env.HOME ?? "";
  const scrub = (data) => home ? data.split(home).join("~") : data;
  writeFileSync(out, `${JSON.stringify({ cli, version, cols, rows, recordedAt: new Date().toISOString().slice(0, 10), steps,
    chunks: chunks.map((c) => c.mark ? c : { ...c, data: scrub(c.data) }) }, null, 1)}\n`);
  console.log(`\nWrote ${out} (${chunks.length} chunks)`);
}
process.exit(0);
