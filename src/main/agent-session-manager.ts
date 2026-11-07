import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { IPty } from "node-pty";
import type { AgentDeliveryResult, AgentPromptRequest, AgentProviderInfo, AgentSessionCreateOptions, AgentSessionEvent, AgentSessionSnapshot, AgentSessionStatus } from "../shared/models";
import { IPC } from "../shared/ipc";
import type { AgentProviderAdapter, ScreenObservation } from "./agent-provider";
import { resolveLaunchProfile, type AgentLaunchProfile } from "./agent-launch-profiles";
import { executablePath } from "./executables";
import { spawnTerminal } from "./pty-manager";
import { footer, isProtocolInput } from "./providers/cli-screen";

interface Session {
  id: string;
  viewId: string;
  owner: WebContents;
  provider: AgentProviderAdapter;
  process: IPty;
  terminal: Terminal;
  serialize: SerializeAddon;
  sequence: number;
  status: AgentSessionStatus;
  interrupted: boolean;
  working: boolean;
  sending: boolean;
  disposed: boolean;
  inputWasEdited: boolean;
  lastOutputAt: number;
  settled: boolean;
  createdAt: number;
  /** The window's terminal has given its real size; until then the CLI may redraw for it. */
  resized: boolean;
  /** Codex says idle or working (OSC 7501); the window title spins while it starts up. */
  reportedState?: "idle" | "working";
  title: string;
  /** The footer's mode when the CLI first took prompts; leaving Plan returns to it. */
  homeMode?: string;
  settleTimer?: ReturnType<typeof setTimeout>;
  /** Output parsed but not yet sent to the window, sent in one message per frame. */
  pendingData: string;
  dataTimer?: ReturnType<typeof setTimeout>;
  detectTimer?: ReturnType<typeof setTimeout>;
}

// A CLI's spinner alone writes about ten chunks a second. Sending each one to the window, and reading the whole
// screen again after each, kept Electron's main thread busy: one message per frame, one status read per 100 ms.
const DATA_BATCH_MS = 16;
const DETECT_EVERY_MS = 100;
/** A first prompt needs this much quiet after the CLI's last output (adapters can ask for more). */
const FIRST_QUIET_MS = 300;
/** ...and the window's terminal at its real size, or this long since launch. */
const ATTACH_GRACE_MS = 3000;
/** A startup spinner in the window title holds the first prompt, but never longer than this. */
const TITLE_BUSY_LIMIT_MS = 15_000;
const PASTE_CHUNK_PAUSE_MS = 4;
const PASTE_SETTLE_MS = 150;
const COMMAND_SETTLE_MS = 150;
const MODE_CYCLE_ATTEMPTS = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AgentSessionManager {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly providers: AgentProviderAdapter[], private readonly spawn = spawnTerminal, private readonly profiles: AgentLaunchProfile[] = []) {}

  discover(): AgentProviderInfo[] {
    return this.providers.map((provider) => ({ id: provider.id, label: provider.label, capabilities: provider.capabilities, available: Boolean(executablePath(provider.executable)), resume: true,
      reason: executablePath(provider.executable) ? undefined : `Install ${provider.label}, or configure its WORKBENCH executable path before starting the app.` }));
  }

  create(options: AgentSessionCreateOptions, owner: WebContents): string {
    const existing = [...this.sessions.values()].find((s) => s.viewId === options.viewId && s.owner === owner);
    if (existing) return existing.id;
    const provider = this.providers.find((p) => p.id === options.providerId);
    if (!provider) throw new Error("Unknown agent provider.");
    const executable = executablePath(provider.executable);
    if (!executable) throw new Error(`${provider.label} executable was not found. Install it or configure its executable path.`);
    const args = provider.args(Boolean(options.resume));
    // Model and effort are launch arguments of a new conversation; a resumed one keeps what it was saved with.
    if (options.settings && !options.resume) {
      if (!provider.modelArgs) throw new Error(`${provider.label} does not take a model setting.`);
      args.push(...provider.modelArgs(options.settings));
    }
    if (options.profile) {
      if (!provider.profileArgs) throw new Error(`${provider.label} does not support launch profiles.`);
      args.push(...provider.profileArgs(resolveLaunchProfile(this.profiles, options.profile, options.workspacePath)));
    }
    const terminal = new Terminal({ cols: options.cols, rows: options.rows, scrollback: 2000, allowProposedApi: true });
    const serialize = new SerializeAddon();
    terminal.loadAddon(serialize);
    let processInstance: IPty;
    try { processInstance = this.spawn(executable, args, options.workspacePath, options.cols, options.rows); }
    catch (error) { terminal.dispose(); throw error; }
    const session: Session = {
      id: randomUUID(), viewId: options.viewId, owner, provider, process: processInstance, terminal, serialize,
      sequence: 0, interrupted: false, working: false, sending: false, disposed: false, inputWasEdited: false,
      lastOutputAt: Date.now(), settled: false, pendingData: "", createdAt: Date.now(), resized: false, title: "",
      status: { lifecycle: "starting", activity: "unknown", canSubmit: false, inputState: "unavailable", reason: "Starting CLI…", rule: "startup", observedAt: Date.now(), completed: 0 },
    };
    this.sessions.set(session.id, session);
    // Codex reports state=idle, working, or done when a turn finishes; only "working" means busy.
    terminal.parser.registerOscHandler(7501, (data) => {
      const state = /(?:^|;)state=([a-z-]+)/.exec(data)?.[1];
      if (state) session.reportedState = state === "working" ? "working" : "idle";
      return true;
    });
    terminal.onTitleChange((title) => { session.title = title; });
    // Headless parsing owns terminal replies, including when no renderer is attached.
    terminal.onData((data) => { if (!session.disposed && session.status.lifecycle !== "exited") processInstance.write(data); });
    processInstance.onData((data) => { session.lastOutputAt = Date.now(); terminal.write(data, () => {
      if (session.disposed) return;
      session.pendingData += data;
      session.dataTimer ??= setTimeout(() => this.emitPending(session), DATA_BATCH_MS);
      session.detectTimer ??= setTimeout(() => { session.detectTimer = undefined; this.detect(session); }, DETECT_EVERY_MS);
    }); });
    processInstance.onExit(({ exitCode }) => {
      if (session.disposed) return;
      this.emitPending(session);
      session.status = { ...session.status, lifecycle: exitCode === 0 ? "exited" : "failed", activity: "unknown", canSubmit: false, inputState: "unavailable",
        reason: `CLI exited with code ${exitCode}.`, rule: "process.exit", observedAt: Date.now(), exitCode };
      this.emit(session, { type: "status", status: session.status });
    });
    return session.id;
  }

  async attach(id: string, owner: WebContents): Promise<AgentSessionSnapshot> {
    const s = this.owned(id, owner);
    await this.flush(s);
    // The snapshot below already shows this output: send it first so its sequence is one the window skips.
    this.emitPending(s);
    // And a status read that was waiting: the snapshot's status is never older than its screen.
    if (s.detectTimer) { clearTimeout(s.detectTimer); s.detectTimer = undefined; this.detect(s); }
    return { sessionId: id, sequence: s.sequence, screen: s.serialize.serialize(), cols: s.terminal.cols, rows: s.terminal.rows, status: s.status };
  }

  async sendPrompt(id: string, request: AgentPromptRequest, owner: WebContents): Promise<AgentDeliveryResult> {
    const s = this.owned(id, owner);
    if (s.sending) return { outcome: "not-sent", stage: "none", message: "A prompt is already being delivered." };
    if (request.intent === "plan" && !(s.provider.capabilities?.planning && s.provider.mode && s.provider.enterPlan)) {
      return { outcome: "not-sent", stage: "none", message: "This provider does not support planning submissions." };
    }
    let stage: AgentDeliveryResult["stage"] = "none";
    s.sending = true;
    try {
      const submission = s.provider.submit(request);
      await this.flush(s);
      this.detect(s);
      if (!s.status.canSubmit || s.disposed) throw new Error(s.status.reason);
      // The composer's mode is the truth: Plan enters the CLI's Plan mode, Code leaves it. Read from the footer, never remembered.
      const plan = request.intent === "plan";
      // Planning needs a ready CLI even when it is already in Plan mode: a paste into a working turn would be left behind.
      if (plan && s.status.activity !== "ready") throw new Error("Wait until the CLI is ready before sending for planning.");
      if (s.provider.mode && (s.provider.mode(this.observe(s)) === "plan") !== plan) {
        if (s.status.activity !== "ready") throw new Error(plan ? "Wait until the CLI is ready before sending for planning." : "Wait until the CLI finishes before leaving Plan mode.");
        stage = "mode";
        await this.switchMode(s, plan);
      }
      stage = "paste";
      for (const [index, chunk] of submission.paste.entries()) {
        s.process.write(chunk);
        // Pace the body; the bracketed-paste markers need no pause.
        if (index > 0 && index < submission.paste.length - 1) await sleep(PASTE_CHUNK_PAUSE_MS);
      }
      // Wait for the native input editor to acknowledge a draft, not just a delay.
      const pasted = await this.waitFor(s, () => s.status.inputState === "draft", 2000);
      if (!pasted) throw new Error("Prompt may be pasted. Inspect the terminal before sending again.");
      // Let the editor finish taking the paste before Enter.
      await this.settle(s, PASTE_SETTLE_MS);
      this.detect(s);
      if (s.status.lifecycle !== "alive" || s.status.activity === "waiting-for-input" || s.status.inputState !== "draft") {
        throw new Error("Prompt may be pasted. Inspect the terminal before sending again.");
      }
      stage = "enter";
      s.process.write("\r");
      s.inputWasEdited = false;
      s.interrupted = false;
      // A CLI that is still busy, such as finishing startup, may hold the submitted draft until it can accept it.
      const submittedDeadline = Date.now() + 2000;
      const heldDeadline = Date.now() + 30_000;
      let current: AgentSessionStatus | undefined;
      do {
        await sleep(50);
        await this.flush(s);
        current = this.sessions.get(id)?.status;
        if (current?.lifecycle === "alive" && current.activity !== "waiting-for-input" && current.inputState === "empty") {
          return { outcome: "submitted", stage, message: plan ? "Planning request handed to the CLI in its Plan mode." : "Prompt handed to the CLI." };
        }
        if (current?.lifecycle !== "alive" || current.activity === "waiting-for-input") break;
      } while (Date.now() < (current?.activity === "working" ? heldDeadline : submittedDeadline));
      throw new Error("Enter was delivered, but submission could not be confirmed. Inspect the terminal before retrying.");
    } catch (error) {
      // A failed mode switch stops before the prompt is pasted: nothing was sent, though the CLI's mode may have moved.
      return { outcome: stage === "none" || stage === "mode" ? "not-sent" : "uncertain", stage, message: error instanceof Error ? error.message : String(error) };
    } finally { s.sending = false; }
  }

  input(id: string, data: string, owner: WebContents): void {
    const s = this.owned(id, owner);
    if (s.sending || s.status.lifecycle === "exited" || s.status.lifecycle === "failed") return;
    if (data === "\x1b" || data === "\x03") s.interrupted = true;
    // Mouse moves, focus and terminal replies are not typing: counting them made Codex's placeholder look like a draft.
    else if (!isProtocolInput(data)) {
      s.inputWasEdited = !data.includes("\r");
      if (data.includes("\r")) s.interrupted = false;
    }
    s.process.write(data);
  }
  resize(id: string, cols: number, rows: number, owner: WebContents): void {
    const s = this.owned(id, owner);
    s.terminal.resize(cols, rows);
    s.resized = true;
    if (s.status.lifecycle === "alive" || s.status.lifecycle === "starting") s.process.resize(cols, rows);
  }
  interrupt(id: string, owner: WebContents): void {
    const s = this.owned(id, owner);
    if (s.sending) return;
    s.interrupted = true;
    if (s.status.lifecycle === "alive") s.process.write(s.provider.interrupt);
  }
  terminate(id: string, owner?: WebContents): void {
    const s = owner ? this.owned(id, owner) : this.sessions.get(id);
    if (!s) return;
    s.disposed = true;
    clearTimeout(s.settleTimer);
    clearTimeout(s.dataTimer);
    clearTimeout(s.detectTimer);
    this.sessions.delete(id);
    if (s.status.lifecycle !== "exited" && s.status.lifecycle !== "failed") s.process.kill();
    s.terminal.dispose();
  }
  terminateForOwner(owner: WebContents): void { for (const s of this.sessions.values()) if (s.owner === owner) this.terminate(s.id); }
  terminateAll(): void { for (const id of this.sessions.keys()) this.terminate(id); }

  /**
   * Into or out of the CLI's Plan mode, checked on the footer after every step. Leaving Plan returns to the mode the
   * session started in (Claude's auto, manual, accept edits...), never to bypass permissions by accident.
   */
  private async switchMode(s: Session, plan: boolean): Promise<void> {
    const strategy = plan ? s.provider.enterPlan : s.provider.leavePlan;
    const mode = () => s.provider.mode!(this.observe(s));
    const arrived = () => {
      const current = mode();
      if (plan) return current === "plan";
      return current !== "plan" && (s.homeMode ? current === s.homeMode : !/bypass/i.test(current));
    };
    const failed = plan ? "Plan mode could not be confirmed. The prompt was not sent; inspect the terminal before retrying."
      : "Could not leave Plan mode. The prompt was not sent; switch to Code in the terminal, or send for planning.";
    if (!strategy) throw new Error(failed);
    if ("command" in strategy) {
      s.inputWasEdited = true;
      s.process.write(strategy.command);
      // Let the slash picker take the command, and check it is the command in the editor before Enter selects it.
      await this.settle(s, COMMAND_SETTLE_MS);
      if (s.provider.commandTyped && !s.provider.commandTyped(this.observe(s), strategy.command)) {
        throw new Error("The Plan command could not be confirmed in the native editor. Inspect the terminal before retrying.");
      }
      s.process.write("\r");
      s.inputWasEdited = false;
      // The footer can redraw late: look again after a quiet moment instead of sending the command twice.
      let ok = await this.waitFor(s, arrived, 10_000);
      if (!ok) { await this.settle(s, 300); ok = await this.waitFor(s, arrived, 4000); }
      if (!ok) throw new Error(failed);
    } else {
      for (let attempt = 0; attempt < MODE_CYCLE_ATTEMPTS && !arrived(); attempt++) {
        const before = footer(this.observe(s));
        s.process.write(strategy.cycle);
        await this.waitFor(s, () => footer(this.observe(s)) !== before, 4000);
        await this.settle(s, COMMAND_SETTLE_MS);
        if (s.status.lifecycle !== "alive" || s.status.activity === "waiting-for-input") throw new Error(failed);
      }
      // Out of Plan in a safe mode, even if not the one it started in, is good enough to send.
      if (!arrived() && (plan || mode() === "plan" || /bypass/i.test(mode()))) throw new Error(failed);
    }
    await this.settle(s, COMMAND_SETTLE_MS);
    await this.flush(s);
    this.detect(s);
    if (!s.status.canSubmit) throw new Error(s.status.reason);
  }

  /** Polls the screen every 50 ms until `check` holds; false on timeout, exit, or a question the person must answer. */
  private async waitFor(s: Session, check: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      await sleep(50);
      await this.flush(s);
      this.detect(s);
      if (s.status.lifecycle !== "alive" || s.status.activity === "waiting-for-input") return false;
      if (check()) return true;
    } while (Date.now() < deadline);
    return false;
  }

  /** Waits until the CLI has written nothing for `quietMs` (counted from now and from its last output), at most `capMs`. */
  private async settle(s: Session, quietMs: number, capMs = 2000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < capMs) {
      await sleep(25);
      await this.flush(s);
      if (Date.now() - Math.max(start, s.lastOutputAt) >= quietMs) return;
    }
  }

  private flush(s: Session): Promise<void> {
    if (s.disposed) return Promise.reject(new Error("Session was closed."));
    return new Promise((resolve) => s.terminal.write("", resolve));
  }
  private owned(id: string, owner: WebContents): Session {
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner) throw new Error("Unknown agent session.");
    return s;
  }
  private detect(s: Session): void {
    if (s.disposed || s.status.lifecycle === "exited" || s.status.lifecycle === "failed") return;
    let detection = s.provider.detect(this.observe(s));
    let lifecycle: AgentSessionStatus["lifecycle"] = "alive";
    if (!s.settled && detection.canSubmit) {
      // The first prompt waits for a quiet, idle CLI at its real size: a paste that lands mid-redraw gets lost.
      const now = Date.now();
      const titleBusy = /^[\u2800-\u28ff]/.test(s.title.trim()) && now - s.createdAt < TITLE_BUSY_LIMIT_MS;
      const wait = detection.activity !== "ready" || s.reportedState === "working" || titleBusy ? DETECT_EVERY_MS : Math.max(
        s.lastOutputAt + Math.max(s.provider.startupSettleMs ?? 0, FIRST_QUIET_MS) - now,
        s.resized ? 0 : s.createdAt + ATTACH_GRACE_MS - now);
      if (wait > 0) {
        clearTimeout(s.settleTimer);
        s.settleTimer = setTimeout(() => this.detect(s), wait);
        lifecycle = "starting";
        detection = { ...detection, canSubmit: false, rule: "startup", reason: "Waiting for the CLI to finish starting…" };
      } else {
        s.settled = true;
        const home = s.provider.mode?.(this.observe(s));
        s.homeMode = home && home !== "plan" ? home : undefined;
      }
    }
    if (detection.inputState === "empty") s.inputWasEdited = false;
    let completed = s.status.completed;
    // Startup work (Codex says "working" while it loads) is not a finished turn.
    if (detection.activity === "working" && s.settled) s.working = true;
    if (detection.activity === "ready" && s.working) {
      if (!s.interrupted) completed++;
      s.working = false;
    }
    const next: AgentSessionStatus = { ...detection, lifecycle, completed, observedAt: Date.now() };
    const previous = s.status;
    s.status = next;
    if (previous.activity !== next.activity || previous.canSubmit !== next.canSubmit || previous.lifecycle !== next.lifecycle || previous.rule !== next.rule || previous.completed !== completed) this.emit(s, { type: "status", status: next });
  }
  private observe(s: Session): ScreenObservation {
    const buffer = s.terminal.buffer.active;
    const lines = Array.from({ length: s.terminal.rows }, (_, i) => buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? "");
    return { lines, cursorLine: lines[buffer.cursorY] ?? "", cursorX: buffer.cursorX, cursorY: buffer.cursorY,
      cursorCellDim: Boolean(buffer.getLine(buffer.baseY + buffer.cursorY)?.getCell(buffer.cursorX)?.isDim()),
      inputWasEdited: s.inputWasEdited, bracketedPaste: s.terminal.modes.bracketedPasteMode, reportedState: s.reportedState };
  }
  private emitPending(s: Session): void {
    clearTimeout(s.dataTimer);
    s.dataTimer = undefined;
    if (!s.pendingData || s.disposed) return;
    const data = s.pendingData;
    s.pendingData = "";
    this.emit(s, { type: "data", data });
  }
  private emit(s: Session, event: { type: "data"; data: string } | { type: "status"; status: AgentSessionStatus }): void {
    const payload: AgentSessionEvent = { ...event, sessionId: s.id, sequence: ++s.sequence };
    if (!s.owner.isDestroyed()) s.owner.send(IPC.agentEvent, payload);
  }
}
