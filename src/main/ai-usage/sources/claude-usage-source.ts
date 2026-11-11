import { net } from "electron";
import type { UsageWindow } from "../../../shared/ai-usage";
import { readFixture, UsageReadError, withTimeout, type UsageReading, type UsageSource } from "../usage-source";
import { readClaudeLogin } from "./claude-credentials";
import { parseClaudeUsage } from "./claude-usage-parse";
import { ClaudeStatusLine } from "./claude-statusline";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TIMEOUT_MS = 10_000;

interface Response { status: number; retryAfter?: string | null; body?: unknown }

/** Seconds, or an HTTP date. */
function retryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function interpret({ status, retryAfter, body }: Response): UsageReading {
  if (status === 401 || status === 403) throw new UsageReadError("stale-login", "Updates the next time Claude Code runs.");
  if (status === 429) throw new UsageReadError("rate-limited", "Anthropic asked to check less often.", retryAfterMs(retryAfter));
  if (status < 200 || status >= 300) throw new UsageReadError("failed", "Couldn't reach Anthropic.");
  return parseClaudeUsage(body);
}

/**
 * Claude Code plan usage, from Anthropic's OAuth usage endpoint with the login Claude Code saved, plus what running
 * sessions report through their status line.
 */
export class ClaudeUsageSource implements UsageSource {
  readonly pollEveryMs = 15 * 60_000;
  private readonly statusLine: ClaudeStatusLine;

  constructor(readonly providerId: string, readonly label: string, folder: () => string) {
    this.statusLine = new ClaudeStatusLine(folder);
  }

  async read(signal: AbortSignal): Promise<UsageReading> {
    const fixture = await readFixture("claude");
    if (fixture) return interpret(fixture as Response);
    if (signal.aborted) throw new UsageReadError("failed", "Stopped.");
    const login = await readClaudeLogin();
    if (signal.aborted) throw new UsageReadError("failed", "Stopped.");
    if (!login?.accessToken) throw new UsageReadError("unavailable", "Sign in to Claude Code to see plan usage.");
    let response: globalThis.Response;
    try {
      response = await net.fetch(USAGE_URL, {
        headers: { Authorization: `Bearer ${login.accessToken}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json" },
        signal: withTimeout(signal, TIMEOUT_MS),
        credentials: "omit",
      });
    } catch { throw new UsageReadError("failed", "Couldn't reach Anthropic."); }
    const body = response.ok ? await response.json().catch(() => { throw new UsageReadError("failed", "Anthropic sent an unreadable reply."); }) : undefined;
    return interpret({ status: response.status, retryAfter: response.headers.get("retry-after"), body });
  }

  launchArgs(cwd: string): string[] {
    return this.statusLine.launchArgs(cwd);
  }

  watchLive(onWindows: (windows: UsageWindow[]) => void): () => void {
    return this.statusLine.watch(onWindows);
  }
}
