import type { WebContents } from "electron";
import * as pty from "node-pty";
import { randomUUID } from "node:crypto";
import type { IDisposable, IPty } from "node-pty";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { PtyCreateOptions, PtySnapshot, SessionResource } from "../shared/models";
import { IPC } from "../shared/ipc";
import { endProcessTree } from "./processes";

interface ManagedPty {
  id: string;
  process: IPty;
  owner: WebContents;
  viewId?: string;
  cwd: string;
  /** Keeps the screen while no window shows it, so switching back to the terminal finds it as it was left. */
  terminal: Terminal;
  serialize: SerializeAddon;
  sequence: number;
  exitCode?: number;
  pendingData: string;
  dataTimer?: ReturnType<typeof setTimeout>;
  listeners: IDisposable[];
  disposed: boolean;
}

/** Output reaches the window in one message per frame, not one per chunk: a noisy command would flood both processes. */
const DATA_BATCH_MS = 16;

/** The resource manager's view of a running session, before its processes are measured. */
export type ListedSession = Pick<SessionResource, "sessionId" | "kind" | "viewId" | "label" | "pid" | "cwd" | "exited"> & { owner: WebContents };

export function spawnTerminal(command: string, args: string[], cwd: string, cols: number, rows: number): IPty {
  return pty.spawn(command, args, { name: "xterm-256color", cwd, cols, rows,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } });
}

export class PtyManager {
  private readonly sessions = new Map<string, ManagedPty>();
  /** Sessions already closed whose processes are still being ended; quitting waits for them too. */
  private readonly ending = new Set<Promise<void>>();

  create(options: PtyCreateOptions, owner: WebContents): string {
    if ([...this.sessions.values()].filter((s) => s.owner === owner).length >= 256) throw new Error("Close unused terminal sessions before starting more.");
    const shell = process.platform === "win32"
      ? process.env.COMSPEC ?? "powershell.exe"
      : process.env.SHELL ?? "/bin/zsh";
    const terminal = new Terminal({ cols: options.cols, rows: options.rows, scrollback: 2000, allowProposedApi: true });
    const serialize = new SerializeAddon();
    terminal.loadAddon(serialize);
    let processInstance: IPty;
    try { processInstance = spawnTerminal(shell, [], options.cwd, options.cols, options.rows); }
    catch (error) { terminal.dispose(); throw error; }
    const session: ManagedPty = { id: randomUUID(), process: processInstance, owner, viewId: options.viewId, cwd: options.cwd,
      terminal, serialize, sequence: 0, pendingData: "", listeners: [], disposed: false };
    this.sessions.set(session.id, session);
    let queuedBytes = 0;
    session.listeners.push(
      // The window's terminal answers protocol queries while it is attached; the headless one only keeps the screen.
      processInstance.onData((data) => {
        if (session.disposed) return;
        // Queued for the window only once parsed: an attach snapshot's sequence must cover only what its screen shows.
        queuedBytes += Buffer.byteLength(data);
        if (queuedBytes > 4 * 1024 * 1024) processInstance.pause();
        terminal.write(data, () => {
          queuedBytes -= Buffer.byteLength(data);
          if (queuedBytes < 1024 * 1024 && !session.disposed) processInstance.resume();
          if (session.disposed) return;
          session.pendingData += data;
          session.dataTimer ??= setTimeout(() => this.emitPending(session), DATA_BATCH_MS);
        });
      }),
      processInstance.onExit(({ exitCode }) => {
        if (session.disposed) return;
        this.emitPending(session);
        session.exitCode = exitCode;
        if (!owner.isDestroyed()) owner.send(IPC.ptyExit, { sessionId: session.id, sequence: ++session.sequence, exitCode });
      }),
    );
    return session.id;
  }

  /** The screen as it is now; output after it carries a higher sequence. */
  attach(sessionId: string, owner: WebContents): Promise<PtySnapshot> {
    const session = this.owned(sessionId, owner);
    return new Promise((resolve) => session.terminal.write("", () => {
      this.emitPending(session);
      resolve({ sessionId, sequence: session.sequence, screen: session.serialize.serialize(), cols: session.terminal.cols,
        rows: session.terminal.rows, exitCode: session.exitCode });
    }));
  }

  input(sessionId: string, data: string, owner: WebContents): void {
    const session = this.owned(sessionId, owner);
    if (session.exitCode === undefined) session.process.write(data);
  }

  resize(sessionId: string, cols: number, rows: number, owner: WebContents): void {
    const session = this.owned(sessionId, owner);
    session.terminal.resize(cols, rows);
    if (session.exitCode === undefined) session.process.resize(cols, rows);
  }

  /** Ends the shell and everything it started; resolves once they are gone. */
  terminate(sessionId: string, owner?: WebContents, graceMs?: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || (owner && session.owner !== owner)) return Promise.resolve();
    session.disposed = true;
    clearTimeout(session.dataTimer);
    this.sessions.delete(sessionId);
    session.listeners.forEach((listener) => listener.dispose());
    session.terminal.dispose();
    if (session.exitCode !== undefined) return Promise.resolve();
    const ended = endProcessTree(session.process.pid, () => session.process.kill(), graceMs).finally(() => this.ending.delete(ended));
    this.ending.add(ended);
    return ended;
  }

  terminateForOwner(owner: WebContents): void {
    for (const session of [...this.sessions.values()]) if (session.owner === owner) void this.terminate(session.id);
  }

  /** Ends every session, and resolves once those already ending are gone too. */
  terminateAll(graceMs?: number): Promise<void> {
    for (const id of [...this.sessions.keys()]) void this.terminate(id, undefined, graceMs);
    return Promise.allSettled([...this.ending]).then(() => undefined);
  }

  has(sessionId: string, owner: WebContents): boolean {
    return this.sessions.get(sessionId)?.owner === owner;
  }

  list(): ListedSession[] {
    return [...this.sessions.values()].map((session) => ({ sessionId: session.id, kind: "terminal", viewId: session.viewId, label: "Terminal",
      pid: session.process.pid, cwd: session.cwd, exited: session.exitCode !== undefined, owner: session.owner }));
  }

  private emitPending(session: ManagedPty): void {
    clearTimeout(session.dataTimer);
    session.dataTimer = undefined;
    if (!session.pendingData || session.disposed) return;
    const data = session.pendingData;
    session.pendingData = "";
    if (!session.owner.isDestroyed()) session.owner.send(IPC.ptyData, { sessionId: session.id, sequence: ++session.sequence, data });
  }

  private owned(id: string, owner: WebContents): ManagedPty {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new Error("Unknown terminal session.");
    return session;
  }
}
