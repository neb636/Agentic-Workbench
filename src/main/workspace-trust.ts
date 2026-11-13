import { app, dialog } from "electron";
import { promises as fs, realpathSync, statSync } from "node:fs";
import path from "node:path";

const trusted = new Map<string, string>();
const pending = new Map<string, Promise<void>>();
let loaded: Promise<void> | undefined;
let saves: Promise<void> = Promise.resolve();
let generation = 0;
const file = () => path.join(app.getPath("userData"), "execution-trust.json");
const identity = (root: string) => { const stat = statSync(root); return `${stat.dev}:${stat.ino}`; };
export function isWorkspaceTrusted(root: string): boolean {
  try { const resolved = realpathSync(root); return [...trusted].some(([entry, id]) => {
    try { return identity(entry) === id && (resolved === entry || resolved.startsWith(entry + "-worktrees" + path.sep)); }
    catch { return false; }
  }); }
  catch { return false; }
}
export async function loadExecutionTrust(): Promise<void> {
  loaded ??= fs.readFile(file(), "utf8").then((text) => {
    const data: unknown = JSON.parse(text);
    if (Array.isArray(data)) for (const entry of data) {
      try {
        if (typeof entry === "string" && path.isAbsolute(entry)) trusted.set(entry, identity(entry));
        else if (entry && typeof entry.path === "string" && typeof entry.identity === "string" && path.isAbsolute(entry.path)) trusted.set(entry.path, entry.identity);
      } catch { /* A missing root must be trusted again after it returns. */ }
    }
  }).catch(() => undefined);
  await loaded;
}
/** Browsing is allowed without this grant; source-control execution is a remembered user decision. */
export async function authorizeWorkspaceExecution(root: string): Promise<void> {
  await loadExecutionTrust();
  const canonical = await fs.realpath(root);
  if (isWorkspaceTrusted(canonical)) return;
  const existing = pending.get(canonical);
  if (existing) return existing;
  const version = generation;
  const request = (async () => {
    const result = await dialog.showMessageBox({ type: "question", title: "Trust workspace?", message: "Allow this workspace's programs and extensions?", detail: `${canonical}\n\nSource-control actions and AI change preparation can run repository hooks, filters, and configured helpers with your account's permissions. Extensions in the workspace's .dimsum/extensions folder run inside this app with the same access it has. Only trust repositories you know. This choice is remembered. Agent CLIs keep their own approval prompts.`, buttons: ["Cancel", "Trust workspace"], defaultId: 0, cancelId: 0, noLink: true });
    if (result.response !== 1 || version !== generation) throw new Error("Workspace execution was not approved.");
    trusted.set(canonical, identity(canonical));
    saves = saves.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(file()), { recursive: true, mode: 0o700 });
      await fs.writeFile(file(), JSON.stringify([...trusted].map(([path, identity]) => ({ path, identity }))), { mode: 0o600 });
    });
    await saves;
  })().finally(() => pending.delete(canonical));
  pending.set(canonical, request);
  return request;
}

export async function revokeExecutionTrust(): Promise<void> {
  await loadExecutionTrust();
  generation++;
  trusted.clear();
  saves = saves.catch(() => undefined).then(() => fs.writeFile(file(), "[]", { mode: 0o600 }));
  await saves;
}
