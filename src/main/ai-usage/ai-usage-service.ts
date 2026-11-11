import type { ProviderUsage, UsageSnapshot, UsageWindow } from "../../shared/ai-usage";
import { UsageReadError, type UsageSource } from "./usage-source";

const TICK_MS = 60_000;
/** Focusing the app reads again once this much time has passed. */
const FOCUS_REFRESH_MS = 5 * 60_000;
/** Pressing refresh twice in quick succession reads once. */
const MANUAL_FLOOR_MS = 30_000;
const BACKOFF_FIRST_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;
/** How long figures from before a failed read stay up, marked as old. */
const KEEP_STALE_MS = 30 * 60_000;
/** ...when the failure is the provider asking to slow down, or a login only the CLI can renew. */
const KEEP_STALE_LONG_MS = 24 * 60 * 60_000;
/** A scheduled read still runs this often while sessions report live figures, for what only it carries. */
const POLL_DESPITE_LIVE_MS = 60 * 60_000;

interface Entry {
  source: UsageSource;
  usage: ProviderUsage;
  lastAttemptAt: number;
  lastPollAt: number;
  lastLiveAt: number;
  /** The provider asked not to be asked again before this. */
  retryAt: number;
  /** Scheduled reads wait until this after failures. */
  backoffUntil: number;
  failures: number;
  reading?: Promise<void>;
  abort?: AbortController;
  stopLive?: () => void;
}

/**
 * Keeps each enabled provider's plan usage: read on a schedule while a window is focused, on focus, on request, and
 * as running sessions report it. Nothing is read, spawned or watched for a provider until `configure` enables it.
 */
export class AiUsageService {
  private readonly entries = new Map<string, Entry>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly sources: UsageSource[],
    private readonly isFocused: () => boolean,
    private readonly broadcast: (snapshot: UsageSnapshot) => void,
  ) {}

  /** The providers to read; the rest stop and forget what they had. */
  configure(providerIds: string[]): void {
    const wanted = new Set(providerIds);
    for (const [id, entry] of this.entries) {
      if (wanted.has(id)) continue;
      entry.abort?.abort();
      entry.stopLive?.();
      this.entries.delete(id);
    }
    for (const source of this.sources) {
      if (!wanted.has(source.providerId) || this.entries.has(source.providerId)) continue;
      const entry: Entry = { source, usage: { providerId: source.providerId, label: source.label, status: "loading", windows: [] },
        lastAttemptAt: 0, lastPollAt: 0, lastLiveAt: 0, retryAt: 0, backoffUntil: 0, failures: 0 };
      this.entries.set(source.providerId, entry);
      entry.stopLive = source.watchLive?.((windows) => this.live(entry, windows));
      void this.read(entry, false);
    }
    if (this.entries.size && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!this.entries.size) { clearInterval(this.timer); this.timer = undefined; }
    this.publish();
  }

  stop(): void {
    this.configure([]);
  }

  snapshot(): UsageSnapshot {
    this.expireWindows();
    return { providers: this.sources.flatMap((source) => {
      const entry = this.entries.get(source.providerId);
      return entry ? [entry.usage] : [];
    }) };
  }

  /** A window past its reset has started over; until the next read says otherwise, it is empty. True when one did. */
  private expireWindows(): boolean {
    const now = Date.now();
    let changed = false;
    for (const entry of this.entries.values()) {
      if (!entry.usage.windows.some((window) => window.resetsAt && window.resetsAt <= now)) continue;
      changed = true;
      entry.usage = { ...entry.usage, windows: entry.usage.windows.map((window) => window.resetsAt && window.resetsAt <= now ? { ...window, usedPercent: 0, resetsAt: undefined } : window) };
    }
    return changed;
  }

  async refresh(): Promise<UsageSnapshot> {
    await Promise.all([...this.entries.values()].map((entry) => this.read(entry, true)));
    return this.snapshot();
  }

  /** Launch arguments a new agent session gets from its provider's source, while that provider is enabled. */
  readonly launchArgs = (providerId: string, cwd: string): string[] => {
    const entry = this.entries.get(providerId);
    try { return entry?.source.launchArgs?.(cwd) ?? []; } catch { return []; }
  };

  /** A window took focus: read whatever hasn't been read for a while. */
  focused(): void {
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (now - entry.lastAttemptAt >= FOCUS_REFRESH_MS && now >= entry.backoffUntil) void this.read(entry, false);
    }
  }

  private tick(): void {
    // Windows shown in the status bar reset on their own schedule, focused or not.
    if (this.expireWindows()) this.publish();
    if (!this.isFocused()) return;
    const now = Date.now();
    for (const entry of this.entries.values()) {
      const every = entry.source.pollEveryMs;
      const liveCovers = now - entry.lastLiveAt < every && now - entry.lastPollAt < POLL_DESPITE_LIVE_MS;
      if (now - entry.lastPollAt >= every && !liveCovers && now >= entry.backoffUntil) void this.read(entry, false);
    }
  }

  private read(entry: Entry, manual: boolean): Promise<void> {
    if (entry.reading) return entry.reading;
    const now = Date.now();
    if (now < entry.retryAt || (manual && now - entry.lastAttemptAt < MANUAL_FLOOR_MS)) return Promise.resolve();
    entry.lastAttemptAt = now;
    const abort = new AbortController();
    entry.abort = abort;
    const base = { providerId: entry.source.providerId, label: entry.source.label };
    entry.reading = entry.source.read(abort.signal).then((reading) => {
      if (abort.signal.aborted) return;
      entry.failures = 0;
      entry.backoffUntil = 0;
      entry.lastPollAt = Date.now();
      entry.usage = { ...base, status: "ok", windows: reading.windows, credits: reading.credits, plan: reading.plan, updatedAt: entry.lastPollAt, source: "poll",
        message: reading.windows.length ? undefined : "No plan limits reported." };
    }, (error: unknown) => {
      if (abort.signal.aborted) return;
      const failure = error instanceof UsageReadError ? error : new UsageReadError("failed", "Couldn't read usage.");
      const failedAt = Date.now();
      entry.failures++;
      entry.backoffUntil = failedAt + Math.min(BACKOFF_FIRST_MS * 2 ** (entry.failures - 1), BACKOFF_MAX_MS);
      if (failure.retryAfterMs !== undefined) entry.retryAt = failedAt + failure.retryAfterMs;
      if (failure.kind === "unavailable") { entry.usage = { ...base, status: "unavailable", windows: [], message: failure.message }; return; }
      const keep = failure.kind === "rate-limited" || failure.kind === "stale-login" ? KEEP_STALE_LONG_MS : KEEP_STALE_MS;
      const previous = entry.usage;
      entry.usage = previous.updatedAt && previous.windows.length && failedAt - previous.updatedAt < keep
        ? { ...previous, status: "stale", message: failure.message }
        : { ...base, status: "error", windows: [], message: failure.message };
    }).finally(() => {
      entry.reading = undefined;
      if (this.entries.get(entry.source.providerId) === entry) this.publish();
    });
    return entry.reading;
  }

  /** Figures a running session reported replace the windows it covers; the rest stay as last read. */
  private live(entry: Entry, windows: UsageWindow[]): void {
    if (this.entries.get(entry.source.providerId) !== entry) return;
    entry.lastLiveAt = Date.now();
    const reported = new Map(windows.map((window) => [window.id, window]));
    const kept = entry.usage.windows.filter((window) => !reported.has(window.id));
    const order = (window: UsageWindow) => { const index = entry.usage.windows.findIndex((item) => item.id === window.id); return index < 0 ? -1 : index; };
    entry.usage = { ...entry.usage, status: "ok", message: undefined, updatedAt: entry.lastLiveAt, source: "live",
      windows: [...windows, ...kept].sort((a, b) => order(a) - order(b)) };
    this.publish();
  }

  private publish(): void {
    this.broadcast(this.snapshot());
  }
}
