import { killBackgroundProcess } from "../../processes";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { UsageCredits, UsageWindow } from "../../../shared/ai-usage";
import { executablePath } from "../../executables";
import { clampPercent, readFixture, UsageReadError, type UsageReading, type UsageSource } from "../usage-source";

/** A short-lived app-server that can't run tools or ask for approval; plugins stay off so nothing outlives it. */
const APP_SERVER_ARGS = ["-c", "approval_policy=never", "-c", "features.plugins=false", "-s", "read-only", "-a", "never", "app-server"];
const INIT_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 1024 * 1024;

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Raw : undefined;
const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Codex names its windows by length; older builds drift by a minute. */
function codexWindow(value: unknown): UsageWindow | undefined {
  const raw = record(value);
  const used = finite(raw?.usedPercent);
  const minutes = finite(raw?.windowDurationMins);
  if (used === undefined) return undefined;
  const resetsAt = finite(raw?.resetsAt);
  const base = { usedPercent: clampPercent(used), resetsAt: resetsAt && resetsAt > 0 ? resetsAt * 1000 : undefined };
  if (minutes !== undefined && Math.abs(minutes - 300) <= 1) return { id: "session", label: "Session", shortLabel: "5h", windowMinutes: 300, ...base };
  if (minutes !== undefined && Math.abs(minutes - 10_080) <= 1) return { id: "weekly", label: "Weekly", shortLabel: "wk", windowMinutes: 10_080, ...base };
  if (minutes === undefined) return undefined;
  const days = minutes / 1440;
  const short = days >= 1 ? `${Math.round(days)}d` : `${Math.round(minutes / 60)}h`;
  return { id: `window-${minutes}`, label: `${short} window`, shortLabel: short, windowMinutes: minutes, ...base };
}

/** Pay-as-you-go credits: unitless, and left out for accounts that never bought any. */
function codexCredits(value: unknown): UsageCredits | undefined {
  const raw = record(value);
  if (!raw || (raw.hasCredits !== true && raw.unlimited !== true)) return undefined;
  const balance = typeof raw.balance === "string" && raw.balance.trim() !== "" ? Number(raw.balance) : finite(raw.balance);
  if (raw.unlimited === true) return { unlimited: true };
  return balance !== undefined && Number.isFinite(balance) ? { balance: Math.max(0, balance) } : undefined;
}

export function parseCodexRateLimits(result: unknown): UsageReading {
  const limits = record(record(result)?.rateLimits);
  const windows = [codexWindow(limits?.primary), codexWindow(limits?.secondary)].filter((item): item is UsageWindow => Boolean(item))
    .sort((a, b) => (a.windowMinutes ?? 0) - (b.windowMinutes ?? 0));
  const plan = record(result)?.planType;
  return { windows, credits: codexCredits(limits?.credits), plan: typeof plan === "string" ? plan : undefined };
}

/** Error text from the app-server is never shown or logged; only its gist decides the message. */
function rpcFailure(message: unknown): UsageReadError {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (/api key|apikey/.test(text)) return new UsageReadError("unavailable", "Signed in with an API key, which has no plan limits.");
  if (/authentication required|not (signed|logged) in/.test(text)) return new UsageReadError("unavailable", "Sign in to Codex to see plan usage.");
  if (/sign in|log ?in|not authenticated|unauthori[sz]ed|401|refresh/.test(text)) return new UsageReadError("stale-login", "Sign in to Codex again to see plan usage.");
  if (/429|rate.?limit|too many/.test(text)) return new UsageReadError("rate-limited", "OpenAI asked to check less often.");
  return new UsageReadError("failed", "Couldn't read Codex usage.");
}

/** initialize → initialized → account/rateLimits/read over newline-delimited JSON-RPC, then the child is ended. */
function readRateLimits(executable: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new UsageReadError("failed", "Stopped.")); return; }
    const child = spawn(executable, APP_SERVER_ARGS, { cwd: tmpdir(), detached: true, stdio: ["pipe", "pipe", "ignore"] });
    let buffer = "";
    let received = 0;
    let readId: number | undefined;
    let settled = false;
    let timer = setTimeout(() => finish(new UsageReadError("failed", "Codex took too long to answer.")), INIT_TIMEOUT_MS);
    const abort = () => finish(new UsageReadError("failed", "Stopped."));
    const finish = (failure?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      killBackgroundProcess(child);
      if (failure) reject(failure); else resolve(result);
    };
    const send = (message: Raw) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", () => finish(new UsageReadError("failed", "Couldn't start Codex.")));
    child.on("close", () => finish(new UsageReadError("failed", "Codex stopped before answering.")));
    child.stdin.on("error", () => undefined);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      received += chunk.length;
      if (received > MAX_OUTPUT_CHARS) { finish(new UsageReadError("failed", "Couldn't read Codex usage.")); return; }
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        let message: Raw | undefined;
        try { message = record(JSON.parse(line)); } catch { continue; }
        if (message?.id === 1) {
          clearTimeout(timer);
          timer = setTimeout(() => finish(new UsageReadError("failed", "Codex took too long to answer.")), READ_TIMEOUT_MS);
          send({ method: "initialized" });
          readId = 2;
          send({ id: readId, method: "account/rateLimits/read" });
        } else if (readId !== undefined && message?.id === readId) {
          if (message.error) finish(rpcFailure(record(message.error)?.message));
          else finish(undefined, message.result);
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "dimsum", version: "1.0.0" } } });
  });
}

/** Codex plan usage, read from a short-lived `codex app-server`, which renews its own login when it needs to. */
export class CodexUsageSource implements UsageSource {
  readonly pollEveryMs = 10 * 60_000;

  constructor(readonly providerId: string, readonly label: string, private readonly executable: string) {}

  async read(signal: AbortSignal): Promise<UsageReading> {
    const fixture = await readFixture("codex") as { result?: unknown; error?: string } | undefined;
    if (fixture) {
      if (fixture.error) throw rpcFailure(fixture.error);
      return parseCodexRateLimits(fixture.result);
    }
    // Whether there is a login is Codex's to say: it may be in auth.json or in the system's credential store.
    const executable = executablePath(this.executable);
    if (!executable) throw new UsageReadError("unavailable", "Codex isn't installed.");
    // Turned off while the checks above ran: no app-server, which could also renew the login.
    if (signal.aborted) throw new UsageReadError("failed", "Stopped.");
    return parseCodexRateLimits(await readRateLimits(executable, signal));
  }
}
