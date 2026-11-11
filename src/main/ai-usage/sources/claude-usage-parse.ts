import type { UsageCredits, UsageWindow } from "../../../shared/ai-usage";
import { clampPercent, type UsageReading } from "../usage-source";

/** The windows Claude reports, under the ids both the OAuth read and the status line payload use. */
const WINDOWS = {
  session: { label: "Session", shortLabel: "5h", windowMinutes: 300 },
  weekly: { label: "Weekly", shortLabel: "wk", windowMinutes: 10_080 },
  fable: { label: "Fable", shortLabel: "Fable", windowMinutes: 10_080 },
} as const;

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Raw : undefined;
const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Epoch seconds, epoch milliseconds (1e10 tells them apart) or an ISO date. */
export function resetTime(value: unknown): number | undefined {
  const number = typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : finite(value);
  if (number !== undefined) return number > 10_000_000_000 ? number : number * 1000;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** `{ utilization | used_percentage, resets_at }` as one of Claude's windows. */
export function claudeWindow(id: keyof typeof WINDOWS, value: unknown): UsageWindow | undefined {
  const raw = record(value);
  const used = finite(raw?.utilization) ?? finite(raw?.used_percentage);
  if (used === undefined) return undefined;
  return { id, ...WINDOWS[id], usedPercent: clampPercent(used), resetsAt: resetTime(raw?.resets_at) };
}

/** The Fable weekly limit: a model-scoped entry of `limits`, or one of the fields older responses used. */
function fableWindow(data: Raw): UsageWindow | undefined {
  const scoped = Array.isArray(data.limits) ? data.limits.map(record).find((limit) =>
    limit?.kind === "weekly_scoped" && finite(limit.percent) !== undefined
    && String(record(record(limit.scope)?.model)?.display_name ?? "").trim().toLowerCase() === "fable") : undefined;
  return claudeWindow("fable", scoped ? { used_percentage: scoped.percent, resets_at: scoped.resets_at } : undefined)
    ?? claudeWindow("fable", data.fable_weekly) ?? claudeWindow("fable", data.fable_seven_day) ?? claudeWindow("fable", data.seven_day_fable);
}

/** Minor units with the reported exponent: 3000 at exponent 2 is 30.00. A bare number is already major units. */
function money(value: unknown, exponentFallback = 2): number | undefined {
  if (typeof value === "number") return finite(value);
  const raw = record(value);
  const minor = finite(raw?.amount_minor);
  const exponent = finite(raw?.exponent) ?? exponentFallback;
  if (minor === undefined || !Number.isInteger(exponent) || exponent < 0 || exponent > 6) return undefined;
  return minor / 10 ** exponent;
}

/** Usage credits: `spend`, or the `extra_usage` older responses carry; absent when the plan has no spend limit or balance. */
function credits(data: Raw): UsageCredits | undefined {
  const spend = record(data.spend);
  if (spend) {
    const limit = money(spend.limit) ?? money(record(spend.cap)?.money);
    const balance = money(spend.balance);
    const currency = [spend.used, spend.limit, record(spend.cap)?.money, spend.balance].map((item) => record(item)?.currency).find((item) => typeof item === "string");
    if (limit !== undefined || balance !== undefined) {
      return { used: money(spend.used) ?? 0, limit, balance, currency: typeof currency === "string" ? currency : "USD" };
    }
  }
  const extra = record(data.extra_usage);
  if (extra) {
    const places = finite(extra.decimal_places) ?? 2;
    const limit = money({ amount_minor: extra.monthly_limit, exponent: places });
    if (limit !== undefined) {
      const currency = typeof extra.currency === "string" && extra.currency.trim() ? extra.currency.trim() : "USD";
      return { used: money({ amount_minor: extra.used_credits, exponent: places }) ?? 0, limit, currency };
    }
  }
  return undefined;
}

/** The response of GET /api/oauth/usage. */
export function parseClaudeUsage(body: unknown): UsageReading {
  const data = record(body) ?? {};
  const windows = [claudeWindow("session", data.five_hour), claudeWindow("weekly", data.seven_day), fableWindow(data)]
    .filter((item): item is UsageWindow => Boolean(item));
  return { windows, credits: credits(data) };
}
