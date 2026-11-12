import { Worker } from "node:worker_threads";

/** One worker per search: repeated files share startup cost, with a deadline for each match batch. */
export class RegexSearch {
  private readonly worker: Worker;
  private closed = false;
  private pending?: { resolve: (matches: number[]) => void; reject: (error: Error) => void };
  private timer?: ReturnType<typeof setTimeout>;

  constructor(query: string, caseSensitive = false) {
    this.worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      parentPort.on('message', lines => { try {
        const re=new RegExp(workerData.query,workerData.caseSensitive?'':'i'); const matches=[];
        for(let i=0;i<lines.length && matches.length<500;i++) if(re.test(lines[i])) matches.push(i);
        parentPort.postMessage({matches});
      } catch {parentPort.postMessage({error:true});} });`, { eval: true, workerData: { query, caseSensitive }, resourceLimits: { maxOldGenerationSizeMb: 32 } });
    this.worker.on("message", (value: { matches?: number[]; error?: boolean }) => {
      clearTimeout(this.timer);
      const pending = this.pending; this.pending = undefined;
      if (value.error) pending?.reject(new Error("Invalid search expression."));
      else pending?.resolve(value.matches ?? []);
    });
    this.worker.on("error", (error) => this.stop(error));
    this.worker.on("exit", () => this.stop(new Error("Regular expression search stopped.")));
  }

  lines(lines: string[]): Promise<number[]> {
    if (this.closed) return Promise.reject(new Error("Regular expression search stopped."));
    if (this.pending) return Promise.reject(new Error("Search batch is already running."));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timer = setTimeout(() => this.stop(new Error("Regular expression search took too long. Simplify the expression.")), 1000);
      this.worker.postMessage(lines);
    });
  }

  dispose(): void { this.stop(new Error("Regular expression search stopped.")); }
  private stop(error: Error): void {
    clearTimeout(this.timer);
    this.pending?.reject(error); this.pending = undefined;
    if (!this.closed) { this.closed = true; void this.worker.terminate(); }
  }
}
