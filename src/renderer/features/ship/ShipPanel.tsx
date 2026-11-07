import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import type { AgentViewState, Workspace } from "../../../shared/models";
import type { WidgetProps } from "../../core/widget-registry";
import { useWorkbenchStore } from "../../state/workbench-store";
import { useWorkList } from "../work/work-store";
import { crumbFor, currentLink, useGameLive } from "../game/game-store";
import { patchComposer } from "../agent/composer-state";
import { attachSection } from "../agent/StudioComposerTools";
import { previewLink } from "../agent/studio-context";
import type { TerminalViewState } from "../terminal/TerminalView";
import { ChevronDownIcon, ChevronRightIcon } from "../../ui/icons";

function samePath(a: string, b: string) {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/** Single quotes for the shell, for the one path we put in a command (the main repo's .env). */
function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Runs a fixed command in this piece of work's Ship terminal, so its output stays visible in the agent column. */
export function runInShip(workspace: Workspace, title: string, command: string): void {
  const store = useWorkbenchStore.getState();
  const existing = workspace.views.find((view) => view.type === "terminal" && (view.state as TerminalViewState | undefined)?.ship);
  const id = existing?.id ?? store.createView(workspace.id, "terminal", "Ship", { providerId: "terminal.local", ship: true });
  store.renameView(workspace.id, id, `Ship: ${title}`);
  store.updateViewState(workspace.id, id, { command, commandNonce: Date.now() });
  store.selectView(workspace.id, id);
}

/** The agent to hand a prompt to: the open one, else the first, else a new one. */
function agentFor(workspace: Workspace): string {
  const active = workspace.views.find((view) => view.id === workspace.activeViewId && view.type === "agent");
  return active?.id ?? workspace.views.find((view) => view.type === "agent")?.id
    ?? useWorkbenchStore.getState().createView(workspace.id, "agent", "Open the PR", { autoTitle: false });
}

/** A plan page for the section on screen: its activity's plan, else its country's. */
async function findPlan(root: string, place?: string, activity?: string): Promise<string | undefined> {
  const list = (folder: string) => window.workbench.files.list(root, folder).then((entries) => entries.filter((entry) => entry.kind === "file" && entry.name.endsWith(".html")).map((entry) => entry.path), () => [] as string[]);
  const candidates = [
    ...(place ? await list(`planning/around-the-world/${place}`) : []),
    ...(await list("planning/around-the-world")),
  ];
  const base = (file: string) => file.split("/").at(-1)?.replace(/\.html$/, "");
  return candidates.find((file) => activity && base(file) === activity)
    ?? candidates.find((file) => activity && base(file)?.startsWith(activity.split("-")[0]) && file.includes(`/${place}/`))
    ?? candidates.find((file) => place && base(file) === place);
}

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(text);
    code.make();
    return code.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  }, [text]);
  return <div className="ship-qr" role="img" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Ship: what this repo does before a PR, one button each, for the selected piece of work. Commands run in its Ship
 * terminal (a tab in the middle); Open PR hands the open-pr skill to its agent. It's the explorer's 🚀 Ship tab.
 */
export function ShipPanel({ workspaceId, docked }: WidgetProps & { docked?: boolean }) {
  const workspace = useWorkbenchStore((state) => state.workspaces.find((item) => item.id === workspaceId));
  const repoRoot = useWorkbenchStore((state) => state.repoRoot);
  const open = useWorkbenchStore((state) => docked || !state.layout.shipCollapsed);
  const updateLayout = useWorkbenchStore((state) => state.updateLayout);
  const item = useWorkList((state) => state.list?.items.find((candidate) => workspace && samePath(candidate.path, workspace.path)));
  const href = useGameLive((state) => (workspaceId ? state.href[workspaceId] : undefined));
  const sections = useGameLive((state) => (workspace ? state.sections[workspace.path] : undefined));
  const origin = useGameLive((state) => (workspaceId ? state.origin[workspaceId] : undefined));
  const [plan, setPlan] = useState<string>();
  const [showQr, setShowQr] = useState(false);
  const hash = workspaceId ? currentLink(workspaceId) : "#/world";
  const crumb = crumbFor(href || hash, sections?.index);
  useEffect(() => {
    let active = true;
    if (workspace) void findPlan(workspace.path, crumb.placeId, crumb.activityId).then((found) => { if (active) setPlan(found); });
    return () => { active = false; };
  }, [workspace, crumb.placeId, crumb.activityId]);
  if (!workspace) return null;
  const pr = item?.pr;
  const preview = previewLink(workspace, hash);
  const activity = crumb.activityId && crumb.activityId !== "hub" && crumb.activityId !== "party" ? crumb.activityId : undefined;

  const verify = () => runInShip(workspace, "verify", "npm run verify");
  const screens = async () => {
    if (!activity) return;
    // QA wants the CPU: only this piece of work's game server keeps running.
    await window.workbench.studio.trimServers(1, workspace.path).catch(() => undefined);
    runInShip(workspace, `screens ${activity}`, `npm run build && node scripts/qa-screens.mjs --only=ipad-portrait,ipad-landscape --routes=${activity}`);
  };
  const voices = () => {
    // The OpenAI key lives in the main checkout's .env; worktrees don't have one.
    const env = `${repoRoot ?? workspace.path}/.env`;
    runInShip(workspace, "voices", `set -a && . ${quote(env)} && set +a && node scripts/world-voice-lines.mjs && node scripts/generate-voice.mjs`);
  };
  const openPr = () => {
    const viewId = agentFor(workspace);
    const state = workspace.views.find((view) => view.id === viewId)?.state as AgentViewState | undefined;
    const text = pr?.state === "OPEN"
      ? `Read AGENTS.md. Commit what's changed on this branch and push it to PR #${pr.number}. Update its 🔗 Test this links with the open-pr skill if what to test changed, then start the Codex review watcher.`
      : "Read AGENTS.md. Run npm run verify, then commit this work and open the PR with the open-pr skill (ready for review, assigned to neb636, 🔗 Test this links to exactly the section attached below, the next prompt at the end). Then start the Codex review watcher.";
    patchComposer({ workspaceId: workspace.id, viewId }, { draft: text, quotations: state?.quotations ?? [], intent: state?.intent ?? "default" });
    attachSection(workspace.id, viewId);
    useWorkbenchStore.getState().selectView(workspace.id, viewId);
  };

  return <section className={`ship-panel ${open ? "is-open" : ""} ${docked ? "is-docked" : ""}`} aria-label="Ship">
    <button className="ship-header" aria-expanded={open} disabled={docked} onClick={() => updateLayout({ shipCollapsed: open })}>
      {!docked && (open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />)}
      <strong>{docked ? workspace.name : "Ship"}</strong>
      <span className="ship-summary">
        {pr ? <>PR #{pr.number} {pr.state === "OPEN" ? (pr.isDraft ? "draft" : "open") : pr.state.toLowerCase()}{pr.checks && <span className={`work-ci is-${pr.checks}`}> · CI {pr.checks === "passing" ? "✓" : pr.checks === "failing" ? "✗" : "…"}</span>}</> : item?.main ? "main checkout" : "no PR yet"}
      </span>
    </button>
    {open && <div className="ship-body">
      <div className="ship-buttons">
        <button onClick={verify} title="npm run verify: voice clips, heavy imports, name case, README directory, plans, typecheck, build">✅ Verify</button>
        <button onClick={() => void screens()} disabled={!activity} title={activity ? `Screenshots of ${activity} at iPad portrait and landscape (qa-screens --routes=${activity})` : "Open an activity's section first"}>📸 Screens{activity ? ` · ${activity}` : ""}</button>
        <button onClick={voices} title="world-voice-lines + generate-voice, with the main checkout's .env">🎙️ Voices</button>
        <button onClick={openPr} title="Hands the open-pr skill to this piece of work's agent, with the section on screen">🚀 {pr?.state === "OPEN" ? "Update PR" : "Open PR"}</button>
      </div>
      <div className="ship-links">
        <a href={preview} target="_blank" rel="noreferrer" title={preview}>📱 {pr?.state === "OPEN" ? `Preview #${pr.number}` : "Main build"} ↗</a>
        <button className="ship-link-button" aria-pressed={showQr} onClick={() => setShowQr(!showQr)}>QR</button>
        {pr && <a href={`${pr.url}/checks`} target="_blank" rel="noreferrer">CI ↗</a>}
        {pr && <a href={pr.url} target="_blank" rel="noreferrer">PR ↗</a>}
        {plan && origin && <a href={`${origin}/${plan}`} target="_blank" rel="noreferrer" title={plan}>📋 Plan page ↗</a>}
      </div>
      {showQr && <div className="ship-qr-row"><Qr text={preview} /><small>Scan with the iPad to open this section{pr?.state === "OPEN" ? ` on PR #${pr.number}'s preview` : " on the main build"}.</small></div>}
    </div>}
  </section>;
}
