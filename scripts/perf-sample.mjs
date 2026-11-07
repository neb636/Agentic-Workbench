// Samples CPU and memory of the running Studio and everything it started, grouped by role.
//   node workbench/scripts/perf-sample.mjs [seconds=60] [label]
// Run it while Studio is open, doing one thing (idle on #/world, an agent working, alt-tabbing back...).
// CPU is measured from each process's CPU time between samples (100% = one full core), so short bursts count.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers';

const seconds = Number(process.argv[2]) || 60;
const label = process.argv[3] || 'run';

/** ps cputime "[[dd-]hh:]mm:ss.cc" → seconds */
function cpuSeconds(text) {
  let days = 0;
  if (text.includes('-')) { const [d, rest] = text.split('-'); days = Number(d); text = rest; }
  const parts = text.split(':').map(Number);
  let total = 0;
  for (const part of parts) total = total * 60 + part;
  return days * 86400 + total;
}

function snapshot() {
  const out = execFileSync('ps', ['-Ao', 'pid=,ppid=,time=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rows = new Map();
  for (const line of out.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (match) rows.set(Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]), cpu: cpuSeconds(match[3]), rss: Number(match[4]) * 1024, command: match[5] });
  }
  return rows;
}

function role(command) {
  if (/vite\/bin\/vite\.js/.test(command)) return `vite ${command.match(/--port\s+(\d+)/)?.[1] ?? ''}`.trim();
  if (/--type=renderer|Helper \(Renderer\)/.test(command)) return 'renderer';
  if (/--type=gpu-process|Helper \(GPU\)/.test(command)) return 'gpu';
  if (/--type=utility/.test(command)) return 'utility';
  if (/Helper/.test(command)) return 'helper';
  if (/Kaylee Gamepack Studio\.app\/Contents\/MacOS\//.test(command) || /electron(\.app)?\/.*Electron\s+\./i.test(command)) return 'main';
  if (/(^|\/)git(\s|$)/.test(command)) return 'git';
  if (/(^|\/)gh(\s|$)/.test(command)) return 'gh';
  if (/claude/.test(command)) return 'claude cli';
  if (/codex/.test(command)) return 'codex cli';
  if (/sections-index\.mjs/.test(command)) return 'sections';
  if (/npm/.test(command)) return 'npm';
  if (/zsh|bash/.test(command)) return 'shell';
  return 'other';
}

function studioTree(rows) {
  const roots = [...rows.values()].filter((row) => /Kaylee Gamepack Studio\.app\/Contents\/MacOS\//.test(row.command) || (/Electron/.test(row.command) && /workbench/.test(row.command)));
  const mains = roots.filter((row) => !roots.some((other) => other.pid === row.ppid));
  const children = new Map();
  for (const row of rows.values()) { if (!children.has(row.ppid)) children.set(row.ppid, []); children.get(row.ppid).push(row); }
  const tree = new Map();
  const queue = mains.map((row) => row.pid);
  while (queue.length) {
    const pid = queue.shift();
    if (tree.has(pid) || !rows.has(pid)) continue;
    tree.set(pid, rows.get(pid));
    for (const child of children.get(pid) ?? []) queue.push(child.pid);
  }
  return tree;
}

const stats = new Map(); // role → { cpu: number[], rss: number[], spawned: Set }
const stat = (name) => { if (!stats.has(name)) stats.set(name, { cpu: [], rss: [], spawned: new Set() }); return stats.get(name); };

let previous = studioTree(snapshot());
if (!previous.size) { console.error('Studio is not running. Open Kaylee Gamepack Studio first.'); process.exit(1); }
console.log(`Sampling Studio (${previous.size} processes) for ${seconds}s as "${label}"...`);
let previousAt = performance.now();
const totals = [];
for (let tick = 0; tick < seconds; tick++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const now = performance.now();
  const elapsed = (now - previousAt) / 1000;
  const current = studioTree(snapshot());
  const cpu = new Map(), rss = new Map();
  for (const row of current.values()) {
    const name = role(row.command);
    const before = previous.get(row.pid);
    if (!before) stat(name).spawned.add(row.pid);
    const used = Math.max(0, row.cpu - (before?.cpu ?? 0));
    cpu.set(name, (cpu.get(name) ?? 0) + used / elapsed * 100);
    rss.set(name, (rss.get(name) ?? 0) + row.rss);
  }
  let total = 0;
  for (const name of new Set([...cpu.keys(), ...stats.keys()])) {
    stat(name).cpu.push(cpu.get(name) ?? 0);
    stat(name).rss.push(rss.get(name) ?? 0);
    total += cpu.get(name) ?? 0;
  }
  totals.push(total);
  process.stdout.write(`\r${tick + 1}/${seconds}s  total ${total.toFixed(0)}% CPU  `);
  previous = current;
  previousAt = now;
}

const avg = (list) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
const mb = (bytes) => `${Math.round(bytes / 1024 ** 2)} MB`;
const table = [...stats.entries()].map(([name, s]) => ({
  role: name, 'avg CPU %': avg(s.cpu).toFixed(1), 'peak CPU %': Math.max(...s.cpu).toFixed(0),
  'avg memory': mb(avg(s.rss)), 'new processes': s.spawned.size,
})).sort((a, b) => Number(b['avg CPU %']) - Number(a['avg CPU %']));
console.log(`\n\nStudio, "${label}": avg ${avg(totals).toFixed(0)}% CPU, peak ${Math.max(...totals).toFixed(0)}% (100% = one core)`);
console.table(table);
const dir = path.resolve('qa-output/perf');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ label, seconds, totals, roles: table }, null, 2));
console.log(`Saved ${file}`);
