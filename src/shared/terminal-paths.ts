// A path in the output, maybe with :line(:col) — `src/renderer/main.tsx:42`, `./AGENTS.md`.
const PATH_PATTERN = /(^|[\s'"`(<[{=])((?:\.{1,2}\/|\/)?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,8})(?::(\d+)(?::(\d+))?)?/g;

/** Candidate file paths in one line of output, relative to the root (absolute ones inside it included). */
export function pathsInLine(text: string, root: string): { path: string; line?: number; start: number; length: number }[] {
  const found: { path: string; line?: number; start: number; length: number }[] = [];
  const base = root.replace(/\/+$/, "") + "/";
  for (const match of text.matchAll(PATH_PATTERN)) {
    let path = match[2];
    if (path.startsWith("/")) { if (!path.startsWith(base)) continue; path = path.slice(base.length); }
    path = path.replace(/^\.\//, "");
    if (!path || path.startsWith("../") || /^\d+(\.\d+)+$/.test(path)) continue;
    const start = (match.index ?? 0) + match[1].length;
    const length = match[0].length - match[1].length;
    found.push({ path, line: match[3] ? Number(match[3]) : undefined, start, length });
  }
  return found;
}
