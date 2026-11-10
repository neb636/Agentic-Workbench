import { execFile } from "node:child_process";

export interface ProcessSample {
  pid: number;
  ppid: number;
  /** Percent of one core, as `ps` reports it. */
  cpu: number;
  /** Resident bytes. */
  memoryBytes: number;
}

export interface ProcessIndex {
  byPid: Map<number, ProcessSample>;
  childrenOf: Map<number, number[]>;
}

const EMPTY: ProcessIndex = { byPid: new Map(), childrenOf: new Map() };
/** After the hang-up, how long a process tree gets to exit before it is killed. */
const KILL_GRACE_MS = 2000;

/** Every process on the machine with its parent, CPU and memory, from one `ps`. Empty where `ps` isn't available. */
export function sampleProcesses(): Promise<ProcessIndex> {
  if (process.platform === "win32") return Promise.resolve(EMPTY);
  return new Promise((resolve) => {
    // The C locale keeps decimal points as dots, whatever the user's locale.
    execFile("ps", ["-eo", "pid=,ppid=,pcpu=,rss="], { timeout: 5000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: "C", LANG: "C" } }, (error, stdout) => {
      if (error) { resolve(EMPTY); return; }
      resolve(indexProcesses(stdout));
    });
  });
}

function indexProcesses(output: string): ProcessIndex {
  const byPid = new Map<number, ProcessSample>();
  const childrenOf = new Map<number, number[]>();
  for (const line of output.split("\n")) {
    const [pid, ppid, cpu, rss] = line.trim().split(/\s+/);
    const sample = { pid: Number(pid), ppid: Number(ppid), cpu: Number.parseFloat(cpu) || 0, memoryBytes: (Number(rss) || 0) * 1024 };
    if (!Number.isInteger(sample.pid) || sample.pid <= 0) continue;
    byPid.set(sample.pid, sample);
    const siblings = childrenOf.get(sample.ppid);
    if (siblings) siblings.push(sample.pid); else childrenOf.set(sample.ppid, [sample.pid]);
  }
  return { byPid, childrenOf };
}

/** A process and all its descendants, skipping (and then claiming) pids already counted elsewhere. */
export function subtree(index: ProcessIndex, root: number, claimed: Set<number>): ProcessSample[] {
  const found: ProcessSample[] = [];
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop()!;
    if (claimed.has(pid)) continue;
    claimed.add(pid);
    const sample = index.byPid.get(pid);
    if (sample) found.push(sample);
    stack.push(...(index.childrenOf.get(pid) ?? []));
  }
  return found;
}

function signal(pid: number, name: NodeJS.Signals | 0): boolean {
  try { process.kill(pid, name); return true; } catch { return false; }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ends a terminal's process and everything it started, resolving once they are gone. A PTY's child leads its own
 * process group, so the hang-up goes to the whole group (as closing a terminal window would); whatever still runs
 * after the grace period, in that group or below it (a detached server, a CLI that ignores the hang-up), is killed.
 */
export async function endProcessTree(pid: number, fallback: () => void, graceMs = KILL_GRACE_MS): Promise<void> {
  if (process.platform === "win32" || pid <= 0) { fallback(); return; }
  // Take the tree first: once the leader exits, its children are re-parented and can't be found from it.
  const tree = subtree(await sampleProcesses(), pid, new Set()).map((item) => item.pid);
  if (!tree.includes(pid)) tree.push(pid);
  signal(-pid, "SIGHUP");
  signal(pid, "SIGHUP");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await sleep(100);
    if (!tree.some((item) => signal(item, 0))) return;
  }
  signal(-pid, "SIGKILL");
  for (const item of tree) signal(item, "SIGKILL");
}
