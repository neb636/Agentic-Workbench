import { mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UsageWindow } from "../../../shared/ai-usage";
import { claudeConfigDir } from "./claude-credentials";
import { claudeWindow } from "./claude-usage-parse";

/**
 * Claude Code passes its status line command a JSON payload that includes the plan's rate limits. A session started
 * from Workbench gets a status line command, through --settings for that session only, that keeps the latest payload
 * in Workbench's own folder. When the person has a status line of their own, the payload goes on to their command and
 * its output is the status line, as before; otherwise nothing is printed. Their Claude settings are never edited.
 */
const SCRIPT = `#!/bin/sh
# Agent Workbench: keeps the plan usage Claude Code reports, then runs the person's own status line command, if any.
payload=$(cat)
case "$payload" in
  *'"rate_limits"'*) temporary="$1.$$"; printf '%s' "$payload" > "$temporary" && mv -f "$temporary" "$1" ;;
esac
[ -n "$2" ] || exit 0
printf '%s' "$payload" | /bin/sh -c "$2"
`;
const PAYLOAD = "claude-statusline.json";
const DEBOUNCE_MS = 500;

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

type StatusLine = { type?: unknown; command?: unknown } & Record<string, unknown>;

function statusLineIn(file: string): StatusLine | undefined {
  try {
    const value = (JSON.parse(readFileSync(file, "utf8")) as { statusLine?: unknown }).statusLine;
    return typeof value === "object" && value !== null ? value as StatusLine : undefined;
  } catch { return undefined; }
}

export class ClaudeStatusLine {
  constructor(private readonly folder: () => string) {}

  /** POSIX shells only; elsewhere usage comes from scheduled reads alone. */
  get supported(): boolean { return process.platform !== "win32"; }

  /**
   * The --settings argument for a session in `cwd`. The person's own status line, from the settings Claude Code would
   * use (local, then project, then user), is kept: its command runs inside ours with the same payload. One that isn't
   * a plain command is left alone, and this returns [].
   */
  launchArgs(cwd: string): string[] {
    if (!this.supported) return [];
    const theirs = [join(cwd, ".claude", "settings.local.json"), join(cwd, ".claude", "settings.json"), join(claudeConfigDir(), "settings.json")]
      .map(statusLineIn).find(Boolean);
    if (theirs && (theirs.type !== "command" || typeof theirs.command !== "string" || !theirs.command.trim())) return [];
    const folder = this.folder();
    const script = join(folder, "claude-statusline.sh");
    try {
      mkdirSync(folder, { recursive: true });
      writeFileSync(script, SCRIPT, { mode: 0o755 });
    } catch { return []; }
    const own = typeof theirs?.command === "string" ? ` ${shellQuote(theirs.command)}` : "";
    const command = `/bin/sh ${shellQuote(script)} ${shellQuote(join(folder, PAYLOAD))}${own}`;
    return ["--settings", JSON.stringify({ statusLine: theirs ? { ...theirs, command } : { type: "command", command, padding: 0 } })];
  }

  /** Reports the windows of each payload a session writes. Payloads already there from before are ignored. */
  watch(onWindows: (windows: UsageWindow[]) => void): () => void {
    if (!this.supported) return () => undefined;
    const folder = this.folder();
    try { mkdirSync(folder, { recursive: true }); } catch { return () => undefined; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      timer = undefined;
      void readFile(join(folder, PAYLOAD), "utf8").then((text) => {
        const limits = (JSON.parse(text) as { rate_limits?: Record<string, unknown> }).rate_limits;
        const windows = [claudeWindow("session", limits?.five_hour), claudeWindow("weekly", limits?.seven_day)].filter((item): item is UsageWindow => Boolean(item));
        if (windows.length) onWindows(windows);
      }).catch(() => undefined);
    };
    let watcher: ReturnType<typeof watch>;
    try {
      watcher = watch(folder, (_event, file) => {
        if (file !== PAYLOAD) return;
        clearTimeout(timer);
        timer = setTimeout(read, DEBOUNCE_MS);
      });
    } catch { return () => undefined; }
    watcher.on("error", () => undefined);
    return () => { clearTimeout(timer); watcher.close(); };
  }
}
