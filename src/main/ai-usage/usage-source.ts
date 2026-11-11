import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UsageCredits, UsageWindow } from "../../shared/ai-usage";

/** What one read of a provider's plan usage found. */
export interface UsageReading {
  windows: UsageWindow[];
  credits?: UsageCredits;
  plan?: string;
}

/**
 * Why a read found nothing. `message` is shown as is, so it is always one of the source's own sentences, never
 * text the provider returned (that can include account details).
 * - unavailable: nothing to read here (not signed in, or an API-key login with no plan limits). Clears the figures.
 * - stale-login: the saved sign-in no longer works; the CLI renews it the next time it runs.
 * - rate-limited: asked too often; `retryAfterMs` says when to ask again.
 * - failed: anything else, likely passing.
 */
export class UsageReadError extends Error {
  constructor(readonly kind: "unavailable" | "stale-login" | "rate-limited" | "failed", message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

/** One provider's way of reading plan usage: the feature's adapter seam. Everything provider-specific stays behind it. */
export interface UsageSource {
  /** The agent provider this reads for, such as "claude.cli". */
  readonly providerId: string;
  readonly label: string;
  /** How often a scheduled read runs while a window is focused. */
  readonly pollEveryMs: number;
  read(signal: AbortSignal): Promise<UsageReading>;
  /** Extra arguments for a new session of this provider, such as a hook that reports usage while it runs. */
  launchArgs?(cwd: string): string[];
  /** Starts listening for figures a running session reports; returns the function that stops it. */
  watchLive?(onWindows: (windows: UsageWindow[]) => void): () => void;
}

export const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/**
 * QA only: with WORKBENCH_AI_USAGE_FIXTURES set, a source reads `<dir>/<name>.json`, when it exists, instead of the
 * sign-in and the network. The file is read on every call, so a QA script can change what the next read finds.
 */
export async function readFixture(name: string): Promise<unknown | undefined> {
  const directory = process.env.WORKBENCH_AI_USAGE_FIXTURES;
  if (!directory) return undefined;
  const text = await readFile(join(directory, `${name}.json`), "utf8").catch(() => undefined);
  return text === undefined ? undefined : JSON.parse(text);
}

/** Aborts when `signal` does or after `ms`, whichever comes first. */
export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}
