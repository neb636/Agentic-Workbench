import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { AgentProviderAdapter } from "../agent-provider";
import { executablePath } from "../executables";

const TIMEOUT_MS = 60_000;
const OUTPUT_LIMIT = 256 * 1024;
const MINUTE = 60_000;

/** The most times a request may be sent. In-flight duplicates share one send and aren't counted. */
export const IDENTICAL_REQUEST_LIMIT = { sends: 3, windowMs: 5 * MINUTE };
/** Catches a loop whose prompt differs slightly each time. */
export const OVERALL_REQUEST_LIMIT = { sends: 10, windowMs: MINUTE };

export interface OneShotCommand {
  executable: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
}
export interface RunningOneShot {
  result: Promise<string>;
  cancel: () => void;
}
export type OneShotRunner = (command: OneShotCommand) => RunningOneShot;

export interface InternalAiRequest {
  /** What the request is for: part of its identity, and of what the guard counts. */
  purpose: string;
  /** The CLI the user chose; omitted when they haven't chosen one. */
  providerId?: string;
  prompt: string;
}

/**
 * The only way the app itself uses AI (agent sessions are the user's own and run elsewhere). Each request is one run
 * of the CLI, and the guard here stops a hook or loop from spending the user's tokens on repeats.
 */
export class InternalAiService {
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly identicalSends = new Map<string, number[]>();
  private overallSends: number[] = [];
  private readonly running = new Set<RunningOneShot>();
  private closed = false;

  constructor(
    private readonly providers: AgentProviderAdapter[],
    private readonly workingDirectory: () => string,
    private readonly runner: OneShotRunner = runOneShot,
    private readonly now: () => number = Date.now,
    private readonly findExecutable: (command: string) => string | undefined = executablePath,
  ) {}

  /** Everything up to registering the request is synchronous, so two calls in one tick can't both send. */
  async run(request: InternalAiRequest): Promise<string> {
    if (this.closed) throw new Error("The app is closing.");
    const { provider, executable, oneShot } = this.resolve(request.providerId);
    const model = oneShot.quickTaskModel;
    const key = createHash("sha256").update(JSON.stringify([request.purpose, provider.id, model, request.prompt])).digest("hex");
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    this.admit(key);
    const running = this.runner({
      executable,
      args: [...oneShot.args(), ...(provider.modelArgs?.(model) ?? [])],
      cwd: this.workingDirectory(),
      prompt: request.prompt,
      timeoutMs: TIMEOUT_MS,
    });
    this.running.add(running);
    const result = running.result.then(
      (output) => {
        const answer = output.trim();
        if (!answer) throw new Error(`${provider.label} returned an empty response.`);
        return answer;
      },
      (error: unknown) => { throw new Error(`${provider.label}: ${error instanceof Error ? error.message : String(error)}`); },
    ).finally(() => { this.running.delete(running); this.inFlight.delete(key); });
    this.inFlight.set(key, result);
    return result;
  }

  terminateAll(): void {
    this.closed = true;
    for (const running of this.running) running.cancel();
  }

  /** A chosen CLI is used or the request fails: a diff never goes to a vendor the user didn't pick. */
  private resolve(providerId: string | undefined) {
    const candidates = this.providers.filter((provider) => provider.oneShot);
    if (providerId) {
      const provider = candidates.find((item) => item.id === providerId);
      if (!provider?.oneShot) throw new Error("The Default CLI can't run built-in AI actions. Choose another in Settings.");
      const executable = this.findExecutable(provider.executable);
      if (!executable) throw new Error(`${provider.label} isn't installed. Choose another Default CLI in Settings.`);
      return { provider, executable, oneShot: provider.oneShot };
    }
    for (const provider of candidates) {
      const executable = this.findExecutable(provider.executable);
      if (executable && provider.oneShot) return { provider, executable, oneShot: provider.oneShot };
    }
    throw new Error(`Install ${candidates.map((provider) => provider.label).join(" or ")} to use built-in AI actions.`);
  }

  /** Counts a send, or refuses it. Failed runs count too: a loop retrying a failure still spends tokens. */
  private admit(key: string): void {
    const at = this.now();
    const inWindow = (times: number[], windowMs: number) => times.filter((time) => at - time < windowMs);
    this.overallSends = inWindow(this.overallSends, OVERALL_REQUEST_LIMIT.windowMs);
    for (const [other, times] of this.identicalSends) {
      const recent = inWindow(times, IDENTICAL_REQUEST_LIMIT.windowMs);
      if (recent.length) this.identicalSends.set(other, recent); else this.identicalSends.delete(other);
    }
    const identical = this.identicalSends.get(key) ?? [];
    const retry = (oldest: number, windowMs: number) => `Try again in ${describeWait(oldest + windowMs - at)}.`;
    if (identical.length >= IDENTICAL_REQUEST_LIMIT.sends) {
      throw new Error(`This same AI request was already sent ${identical.length} times in the last ${IDENTICAL_REQUEST_LIMIT.windowMs / MINUTE} minutes, so it wasn't sent again. ${retry(identical[0], IDENTICAL_REQUEST_LIMIT.windowMs)}`);
    }
    if (this.overallSends.length >= OVERALL_REQUEST_LIMIT.sends) {
      throw new Error(`Too many AI requests were sent in the last minute, so this one wasn't sent. ${retry(this.overallSends[0], OVERALL_REQUEST_LIMIT.windowMs)}`);
    }
    this.identicalSends.set(key, [...identical, at]);
    this.overallSends.push(at);
  }
}

function describeWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** Runs in its own process group: a CLI can be a wrapper around the real binary, and both must stop together. */
export function runOneShot(command: OneShotCommand): RunningOneShot {
  let child: ChildProcess | undefined;
  let stop: ((reason: Error) => void) | undefined;
  let cancelled = false;
  const killGroup = () => {
    if (!child?.pid) return;
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  };
  const start = async () => {
    await mkdir(command.cwd, { recursive: true });
    if (cancelled) throw new Error("Stopped because the app is closing.");
    return new Promise<string>((resolve, reject) => {
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderr = "";
      const timer = setTimeout(() => stop?.(new Error(`No answer after ${command.timeoutMs / 1000} seconds.`)), command.timeoutMs);
      stop = (reason) => { clearTimeout(timer); killGroup(); reject(reason); };
      child = spawn(command.executable, command.args, { cwd: command.cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      // A CLI that exits before reading its prompt must not crash the app with EPIPE; its exit code reports the failure.
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(command.prompt);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
        stdoutBytes += chunk.length;
        if (stdoutBytes > OUTPUT_LIMIT) stop?.(new Error("The answer was too long."));
      });
      child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        const output = Buffer.concat(stdout).toString("utf8");
        if (code === 0) resolve(output);
        else reject(new Error((stderr.trim() || output.trim() || `Stopped by ${signal ?? "an unknown signal"}.`).slice(-500)));
      });
    });
  };
  return {
    result: start(),
    cancel: () => { cancelled = true; stop?.(new Error("Stopped because the app is closing.")); },
  };
}
