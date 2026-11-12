import { Worker } from "node:worker_threads";

/** Regex runs away from Electron main and can be terminated even during one pathological match. */
export function regexLines(lines: string[], query: string, caseSensitive = false): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); try {const re=new RegExp(workerData.query,workerData.caseSensitive?'':'i');parentPort.postMessage({matches:workerData.lines.flatMap((line,i)=>re.test(line)?[i]:[]).slice(0,500)});} catch {parentPort.postMessage({error:true});}`, { eval: true, workerData: { lines, query, caseSensitive }, resourceLimits: { maxOldGenerationSizeMb: 32 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("Regular expression search took too long. Simplify the expression.")); }, 1000);
    worker.once("message", (value: { matches?: number[]; error?: boolean }) => { clearTimeout(timer); void worker.terminate(); if (value.error) reject(new Error("Invalid search expression.")); else resolve(value.matches ?? []); });
    worker.once("error", (error) => { clearTimeout(timer); reject(error); });
    worker.once("exit", () => { clearTimeout(timer); reject(new Error("Regular expression search stopped.")); });
  });
}
