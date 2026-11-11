import { z } from "zod";

/**
 * AI usage: how much of each agent CLI's subscription plan has been used, read from the sign-in the CLI already has.
 * The whole feature lives in `src/main/ai-usage/` and `src/renderer/features/ai-usage/`; this file is what both sides share.
 */

/** One rate-limit window of a plan, such as the 5-hour session or the weekly limit. */
export interface UsageWindow {
  id: string;
  /** "Session", "Weekly", "Fable". */
  label: string;
  /** "5h", "wk", "Fable": what the status bar shows. */
  shortLabel: string;
  /** 0–100. */
  usedPercent: number;
  /** Epoch milliseconds. */
  resetsAt?: number;
  windowMinutes?: number;
}

/** Spend on top of the plan, in currency units, or a balance of unitless credits when `currency` is absent. */
export interface UsageCredits {
  used?: number;
  limit?: number;
  balance?: number;
  currency?: string;
  unlimited?: boolean;
}

export type ProviderUsageStatus = "loading" | "ok" | "stale" | "error" | "unavailable";

export interface ProviderUsage {
  /** The agent provider's id, such as "claude.cli". */
  providerId: string;
  label: string;
  status: ProviderUsageStatus;
  /** Why the figures are missing or old. Never anything the provider returned verbatim. */
  message?: string;
  plan?: string;
  windows: UsageWindow[];
  credits?: UsageCredits;
  /** When the figures were read, epoch milliseconds. */
  updatedAt?: number;
  /** "live": pushed by a running session rather than read on a schedule. */
  source?: "poll" | "live";
}

export interface UsageSnapshot {
  providers: ProviderUsage[];
}

export const AI_USAGE_IPC = {
  snapshot: "ai-usage:snapshot",
  refresh: "ai-usage:refresh",
  configure: "ai-usage:configure",
  changed: "ai-usage:changed",
} as const;

export const aiUsageConfigureSchema = z.object({ providers: z.array(z.string().max(100)).max(20) });

export interface AiUsageApi {
  snapshot: () => Promise<UsageSnapshot>;
  /** Reads every enabled provider again now, unless one was read moments ago. */
  refresh: () => Promise<UsageSnapshot>;
  /** The providers to read. Empty turns the feature off: nothing is read, spawned or watched. */
  configure: (providers: string[]) => Promise<void>;
  onChanged: (listener: (snapshot: UsageSnapshot) => void) => () => void;
}

/** The tightest window: the one closest to its limit. */
export function tightestWindow(usage: ProviderUsage): UsageWindow | undefined {
  return usage.windows.reduce<UsageWindow | undefined>((tightest, window) => !tightest || window.usedPercent > tightest.usedPercent ? window : tightest, undefined);
}
