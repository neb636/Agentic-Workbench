import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { gameOrigin } from '../shared/labs';

export async function validateGameCheckout(root: string): Promise<void> {
  if (!path.isAbsolute(root)) throw new Error('Choose a game checkout folder.');
  await access(path.join(root, 'src/world/labs/workbench.ts'));
  try { await access(path.join(root, 'node_modules/vite/bin/vite.js')); }
  catch { throw new Error('Game dependencies are missing. Open a terminal in this checkout and run npm ci, then reopen the game.'); }
}

/** Own the server: never attach to an unrelated process occupying the lab origin. */
export class GameServer {
  private child?: ChildProcess;
  constructor(readonly port = 5174) {}
  get origin(): string { return gameOrigin(this.port); }
  get running(): boolean { return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null); }
  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
      let timeout: ReturnType<typeof setTimeout>;
      await Promise.race([exited, new Promise<void>(resolve => { timeout = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} resolve(); }, 3000); })]);
      clearTimeout(timeout!);
    }
  }
  async start(repo: string, onFailure: (message: string) => void): Promise<void> {
    // Electron includes a Node runtime, so Finder doesn't need Node on its minimal PATH.
    const node = process.execPath;
    const origin = this.origin;
    let occupied = false;
    try { await fetch(origin, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* no HTTP server */ }
    if (occupied) throw new Error(`${origin} is already in use. Quit the other Studio or game server first.`);
    const child = spawn(node, [path.join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(this.port), '--strictPort'], {
      cwd: repo, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    this.child = child;
    let failure = '';
    let output = '';
    let ready = false;
    const failed = (message: string) => { failure = message; if (ready && this.child === child) onFailure(message); };
    child.stdout?.on('data', data => { output = (output + data).slice(-4000); });
    child.stderr?.on('data', data => { output = (output + data).slice(-4000); });
    child.on('error', error => failed(error.message));
    child.on('exit', code => failed(`Game server exited (${code}). ${output}`));
    try {
      for (let attempt = 0; attempt < 120; attempt++) {
        if (failure) throw new Error(failure);
        try {
          const response = await fetch(`${origin}/@vite/client`, { signal: AbortSignal.timeout(1000) });
          if (response.ok) {
            // Give a port-binding error time to arrive before trusting the origin.
            await new Promise(resolve => setTimeout(resolve, 100));
            if (failure) throw new Error(failure);
            ready = true;
            return;
          }
        } catch { if (failure) throw new Error(failure); }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error(`Could not start the game server. ${output}`);
    } catch (error) { this.stop(); throw error; }
  }
}

interface Served { root: string; server: GameServer; usedAt: number; ready: Promise<string> }

/**
 * One game server per piece of work, the last `keep` kept running (Dad's answer: switching back is instant and
 * compare-with-main works). An `external` server (the one `npm run studio` already started for its own checkout)
 * is used as is and never stopped. Requests are serialized so two switches never race for a port.
 */
export class GameServerPool {
  private readonly served: Served[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private clock = 0;
  constructor(
    private readonly ports: number[],
    private readonly options: {
      keep?: number;
      external?: { root: string; port: number };
      validate?: (root: string) => Promise<void>;
      onFailure?: (root: string, message: string) => void;
      create?: (port: number) => GameServer;
    } = {},
  ) {}

  /** The origin serving `root`, starting a server (and stopping the least recently used one) if needed. */
  origin(root: string): Promise<string> {
    const resolved = path.resolve(root);
    const external = this.options.external;
    if (external && path.resolve(external.root) === resolved) return Promise.resolve(gameOrigin(external.port));
    const next = this.queue.catch(() => {}).then(() => this.ensure(resolved));
    this.queue = next;
    return next;
  }

  /** Roots with a running server, most recently used first (for the status bar and tests). */
  running(): { root: string; origin: string }[] {
    const owned = [...this.served].sort((a, b) => b.usedAt - a.usedAt).map(item => ({ root: item.root, origin: item.server.origin }));
    const external = this.options.external;
    return external ? [{ root: path.resolve(external.root), origin: gameOrigin(external.port) }, ...owned] : owned;
  }

  /** Stop all but the `keep` most recently used owned servers (QA wants the CPU). `root`, on screen, counts as just used. */
  trim(keep: number, root?: string): Promise<void> {
    const next = this.queue.catch(() => {}).then(() => {
      const shown = root ? this.served.find(item => item.root === path.resolve(root)) : undefined;
      if (shown) shown.usedAt = ++this.clock;
      return this.evict(keep);
    });
    this.queue = next;
    return next;
  }

  async stopAll(): Promise<void> {
    await this.queue.catch(() => {});
    await this.evict(0);
  }

  private async ensure(root: string): Promise<string> {
    const existing = this.served.find(item => item.root === root);
    if (existing) {
      if (existing.server.running) { existing.usedAt = ++this.clock; return existing.ready; }
      this.served.splice(this.served.indexOf(existing), 1);
    }
    await (this.options.validate ?? validateGameCheckout)(root);
    const keep = Math.max(1, this.options.keep ?? 2);
    await this.evict(keep - 1);
    const used = new Set(this.served.map(item => item.server.port));
    let lastError: unknown = new Error('No free game server port.');
    for (const port of this.ports.filter(candidate => !used.has(candidate))) {
      const server = (this.options.create ?? (p => new GameServer(p)))(port);
      const item: Served = { root, server, usedAt: ++this.clock, ready: Promise.resolve(server.origin) };
      try {
        await server.start(root, message => {
          const index = this.served.indexOf(item);
          if (index >= 0) this.served.splice(index, 1);
          this.options.onFailure?.(root, message);
        });
      } catch (error) {
        // Another Studio or a game server Dad started himself: try the next port.
        if (/already in use/.test(String(error))) { lastError = error; continue; }
        throw error;
      }
      this.served.push(item);
      return server.origin;
    }
    throw lastError;
  }

  private async evict(keep: number): Promise<void> {
    const byAge = [...this.served].sort((a, b) => b.usedAt - a.usedAt);
    for (const item of byAge.slice(Math.max(0, keep))) {
      this.served.splice(this.served.indexOf(item), 1);
      await item.server.stop();
    }
  }
}
