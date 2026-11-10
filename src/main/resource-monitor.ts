import { app, type WebContents } from "electron";
import type { ResourceSnapshot, ResourceSummary, ResourceUsage, SessionResource } from "../shared/models";
import type { ListedSession } from "./pty-manager";
import { sampleProcesses, subtree, type ProcessIndex } from "./processes";

/** At the resource manager's 2 s refresh, about two minutes of memory. */
const HISTORY_SAMPLES = 60;
/** A history no snapshot has touched for this long belongs to a session that is gone. */
const HISTORY_IDLE_MS = 10 * 60_000;
const APP_KEY = "__app__";

export interface SessionSource {
  list(): ListedSession[];
  has(sessionId: string, owner: WebContents): boolean;
  terminate(sessionId: string, owner?: WebContents): Promise<void>;
}

const sum = (items: ResourceUsage[]): ResourceUsage =>
  items.reduce((total, item) => ({ cpu: total.cpu + item.cpu, memoryBytes: total.memoryBytes + item.memoryBytes }), { cpu: 0, memoryBytes: 0 });

/**
 * Measures the app and every session's process tree when asked; it runs no timer of its own, so it costs nothing while
 * the resource manager is closed. Only a window's own sessions are shown to it or can be ended by it.
 */
export class ResourceMonitor {
  private readonly histories = new Map<string, { samples: number[]; touchedAt: number }>();
  private sampling?: Promise<ProcessIndex>;

  constructor(private readonly sources: SessionSource[]) {}

  async snapshot(owner: WebContents): Promise<ResourceSnapshot> {
    const index = await this.sample();
    const claimed = new Set<number>();
    const appUsage = this.appUsage(index, claimed);
    const sessions: SessionResource[] = this.sessions(owner).map((session) => {
      const usage = sum(subtree(index, session.pid, claimed));
      return { sessionId: session.sessionId, kind: session.kind, viewId: session.viewId, label: session.label, pid: session.pid, cwd: session.cwd,
        exited: session.exited, ...usage, history: this.record(session.sessionId, usage.memoryBytes) };
    });
    this.sweep();
    return {
      app: { ...appUsage, history: this.record(APP_KEY, appUsage.memoryBytes) },
      sessions,
      total: sum([appUsage, ...sessions]),
      collectedAt: Date.now(),
    };
  }

  async summary(owner: WebContents): Promise<ResourceSummary> {
    const index = await this.sample();
    const claimed = new Set<number>();
    const sessions = this.sessions(owner);
    const memory = this.appUsage(index, claimed).memoryBytes
      + sessions.reduce((total, session) => total + sum(subtree(index, session.pid, claimed)).memoryBytes, 0);
    return { memoryBytes: memory, sessions: sessions.filter((session) => !session.exited).length };
  }

  /** Ends one of this window's sessions; nothing happens for a session it doesn't own. */
  async end(owner: WebContents, sessionId: string): Promise<void> {
    const source = this.sources.find((item) => item.has(sessionId, owner));
    await source?.terminate(sessionId, owner);
    this.histories.delete(sessionId);
  }

  private sessions(owner: WebContents): ListedSession[] {
    return this.sources.flatMap((source) => source.list()).filter((session) => session.owner === owner);
  }

  /** Callers at the same moment share one process listing. */
  private sample(): Promise<ProcessIndex> {
    this.sampling ??= sampleProcesses().finally(() => { this.sampling = undefined; });
    return this.sampling;
  }

  /** Electron's own processes, by kind. Memory comes from the process listing when it has the pid, as sessions' does. */
  private appUsage(index: ProcessIndex, claimed: Set<number>): Omit<ResourceSnapshot["app"], "history"> {
    const buckets = { main: [] as ResourceUsage[], renderer: [] as ResourceUsage[], other: [] as ResourceUsage[] };
    for (const metric of app.getAppMetrics()) {
      claimed.add(metric.pid);
      const usage = { cpu: metric.cpu.percentCPUUsage, memoryBytes: index.byPid.get(metric.pid)?.memoryBytes ?? metric.memory.workingSetSize * 1024 };
      (metric.type === "Browser" ? buckets.main : metric.type === "Tab" ? buckets.renderer : buckets.other).push(usage);
    }
    const main = sum(buckets.main);
    const renderer = sum(buckets.renderer);
    const other = sum(buckets.other);
    return { ...sum([main, renderer, other]), main, renderer, other };
  }

  private record(key: string, memoryBytes: number): number[] {
    const entry = this.histories.get(key) ?? { samples: [], touchedAt: 0 };
    entry.samples.push(memoryBytes);
    if (entry.samples.length > HISTORY_SAMPLES) entry.samples.splice(0, entry.samples.length - HISTORY_SAMPLES);
    entry.touchedAt = Date.now();
    this.histories.set(key, entry);
    return [...entry.samples];
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.histories) if (now - entry.touchedAt > HISTORY_IDLE_MS) this.histories.delete(key);
  }
}
