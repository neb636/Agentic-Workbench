import { useEffect, useRef, useState } from "react";
import { LAB_CHANNEL, type LabSnapshot } from "../../../shared/labs";
import type { GameFrame, WorkbenchView, Workspace } from "../../../shared/models";
import { RefreshIcon } from "../../ui/icons";
import { crumbFor, FRAMES, hashOf, labOf, labOfView, loadSections, patchGame, tabLink, useGameLive } from "./game-store";
import { LabPanel, type LabRequest } from "./LabPanel";
import { useWorkList } from "../work/work-store";
import { useWorkbenchStore } from "../../state/workbench-store";
import { KnownIssuesList, useKnownIssues } from "./KnownIssues";
import { handleLabShare } from "./lab-share";
import { useElementWidth } from "../../ui/use-element-width";

const SERVER_GRACE_MS = 3 * 60_000;

/** Fits a device-sized frame into the pane, never larger than real size. */
function useStageScale(frame: GameFrame, columns = 1) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const device = FRAMES.find((item) => item.id === frame);
  if (!device?.width || !device.height || !size.width) return { ref, device: undefined, scale: 1 };
  const width = (size.width - 24 - (columns - 1) * 16) / columns;
  return { ref, device: { width: device.width, height: device.height }, scale: Math.min(1, width / device.width, (size.height - 48) / device.height) };
}

/** Beside the frame when the tab is at least this wide; under it when narrower. */
const PANEL_BESIDE_WIDTH = 1100;

/**
 * The one game of a piece of work, shown by its game tabs (Game, Camera, Feel, Character): its own loopback server, a
 * breadcrumb of the section on screen, device frames, reload, and the lab's tuning panel beside or under the frame.
 * It stays mounted while another tab is on screen; going to another game tab opens that tab's link in the same frame.
 */
export function GamePane({ workspace, view, visible }: { workspace: Workspace; view: WorkbenchView; visible: boolean }) {
  const game = workspace.game ?? {};
  const tabLab = labOfView(view);
  const origin = useGameLive((state) => state.origin[workspace.id]);
  const href = useGameLive((state) => state.href[workspace.id]);
  const snapshot = useGameLive((state) => state.snapshot[workspace.id]);
  const go = useGameLive((state) => state.go[workspace.id]);
  const sections = useGameLive((state) => state.sections[workspace.path]);
  const [target, setTarget] = useState(() => ({ hash: hashOf(tabLink(game, tabLab)), nonce: 0 }));
  const [error, setError] = useState<string>();
  const [shareStatus, setShareStatus] = useState("");
  const [editing, setEditing] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const repoRoot = useWorkbenchStore((state) => state.repoRoot);
  const isMain = !repoRoot || repoRoot.replace(/\/+$/, "") === workspace.path.replace(/\/+$/, "");
  // Compare with main: main's own game server beside this one, at the same section and params.
  const [compare, setCompare] = useState(false);
  const [mainOrigin, setMainOrigin] = useState<string>();
  const [mainTarget, setMainTarget] = useState<{ hash: string; nonce: number }>();
  const [showIssues, setShowIssues] = useState(false);
  const paneRef = useRef<HTMLElement>(null);
  const beside = useElementWidth(paneRef) >= PANEL_BESIDE_WIDTH;
  // A new piece of work is still running npm ci: start its game once that finishes.
  const installing = useWorkList((state) => state.list?.items.find((item) => item.path.replace(/\/+$/, "") === workspace.path.replace(/\/+$/, ""))?.install === "installing");
  const frame = useRef<HTMLIFrameElement>(null);
  const mainFrame = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<string, { resolve: (s: LabSnapshot) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const current = hashOf(href || target.hash);
  const lab = labOf(current);
  const frameId: GameFrame = lab === "camera" ? "fit" : game.frame ?? "fit";
  const comparing = compare && !isMain;
  const stage = useStageScale(frameId, comparing ? 2 : 1);
  const crumb = crumbFor(current, sections?.index);
  const issues = useKnownIssues(workspace, crumb.placeId, crumb.activityId);

  useEffect(() => {
    if (!comparing || !repoRoot) return;
    let active = true;
    window.workbench.studio.useCheckout(repoRoot).then((value) => { if (active) setMainOrigin(value); }).catch((caught) => { if (active) setError(`Main's game can't start: ${String(caught).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, "")}`); });
    return () => { active = false; setMainOrigin(undefined); };
  }, [comparing, repoRoot]);
  // Main follows every navigation made here (a section, a pasted link, a lab switch, reload).
  useEffect(() => { if (comparing) setMainTarget((before) => before && before.nonce === target.nonce ? before : { hash: target.hash, nonce: target.nonce || Date.now() }); }, [comparing, target]);

  // Not while npm ci is still writing node_modules: the sections script would fail halfway (and stay failed).
  useEffect(() => { if (!installing) void loadSections(workspace.path); }, [workspace.path, installing]);

  // The game slows to a crawl while Studio is behind other apps or its tab is hidden (the game's studio-pace.ts).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    for (const [element, target] of [[frame.current, origin], [mainFrame.current, mainOrigin]] as const) {
      if (element?.contentWindow && target) element.contentWindow.postMessage({ channel: LAB_CHANNEL, studioFocused: visible && document.hasFocus() }, target);
    }
  }, [visible, origin, mainOrigin]);
  useEffect(() => {
    if (!origin) return;
    const tell = () => {
      // A hidden tab's game runs at the background pace too.
      const focused = visibleRef.current && document.visibilityState === "visible" && document.hasFocus();
      for (const [element, target] of [[frame.current, origin], [mainFrame.current, mainOrigin]] as const) {
        if (element?.contentWindow && target) element.contentWindow.postMessage({ channel: LAB_CHANNEL, studioFocused: focused }, target);
      }
    };
    // Focus moving into the game frame blurs this window too: hasFocus() is still true then, so check after it settles.
    const soon = () => setTimeout(tell, 0);
    addEventListener("focus", soon);
    addEventListener("blur", soon);
    document.addEventListener("visibilitychange", soon);
    // A frame that just (re)loaded hears it within a couple of seconds.
    const timer = setInterval(tell, 2000);
    return () => { removeEventListener("focus", soon); removeEventListener("blur", soon); document.removeEventListener("visibilitychange", soon); clearInterval(timer); };
  }, [origin, mainOrigin]);

  // One game server at a time on an 8 GB Mac: after a few minutes on this piece of work, stop the one before it
  // (switching back restarts it in a few seconds). Compare with main needs both, so not while comparing.
  useEffect(() => {
    if (!origin || comparing) return;
    const timer = setTimeout(() => void window.workbench.studio.trimServers(1, workspace.path).catch(() => undefined), SERVER_GRACE_MS);
    return () => clearTimeout(timer);
  }, [origin, comparing, workspace.path]);

  useEffect(() => {
    let active = true;
    setError(undefined);
    // A remembered origin may be stale (that server was evicted and its port reused): wait for this checkout's server.
    useGameLive.setState((state) => ({ origin: { ...state.origin, [workspace.id]: "" } }));
    window.workbench.studio.useCheckout(workspace.path)
      .then((value) => { if (active) useGameLive.setState((state) => ({ origin: { ...state.origin, [workspace.id]: value } })); })
      .catch((caught) => { if (active) setError(String(caught).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, "")); });
    return () => { active = false; };
  }, [workspace.id, workspace.path, installing, attempt]);

  const forget = () => useGameLive.setState((state) => ({ href: { ...state.href, [workspace.id]: "" }, snapshot: { ...state.snapshot, [workspace.id]: undefined } }));
  // Only requests made while this pane is mounted: an old Sections click must not replay when switching back.
  const seen = useRef(go?.nonce);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (go && go.nonce !== seen.current) { seen.current = go.nonce; forget(); setTarget(go); } }, [go]);

  useEffect(() => {
    if (!origin) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || event.data?.channel !== LAB_CHANNEL) return;
      if (typeof event.data.shareId === "string" && event.data.share) {
        const source = frame.current!.contentWindow!;
        const shareId = event.data.shareId;
        void handleLabShare(workspace, event.data.share).then(() => {
          if (frame.current?.contentWindow === source) source.postMessage({ channel: LAB_CHANNEL, shareId }, origin);
          setShareStatus(event.data.share.action === "agent" ? "Added to agent composer — review and send" : "Copied to clipboard");
        }).catch((error) => {
          if (frame.current?.contentWindow === source) source.postMessage({ channel: LAB_CHANNEL, shareId, error: String(error) }, origin);
          setShareStatus(String(error));
        });
        return;
      }
      if (typeof event.data.location === "string") {
        const location = event.data.location as string;
        useGameLive.setState((state) => ({ href: { ...state.href, [workspace.id]: location } }));
        const hash = hashOf(location);
        patchGame(workspace.id, labOf(hash) === "character" ? { characterLink: hash } : { link: hash });
        return;
      }
      if (event.data.snapshot) useGameLive.setState((state) => ({ snapshot: { ...state.snapshot, [workspace.id]: event.data.snapshot } }));
      if (event.data.ready) return;
      const waiting = pending.current.get(event.data.id);
      if (!waiting) return;
      clearTimeout(waiting.timer); pending.current.delete(event.data.id);
      if (event.data.error) waiting.reject(new Error(event.data.error));
      else waiting.resolve(event.data.snapshot);
    };
    addEventListener("message", receive);
    const waiting = pending.current;
    return () => {
      removeEventListener("message", receive);
      for (const p of waiting.values()) { clearTimeout(p.timer); p.reject(new Error("Game closed")); }
      waiting.clear();
    };
  }, [origin, workspace.id]);

  const request: LabRequest = (action, values) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.current.delete(id); reject(new Error("No response from this lab. Wait for the game to load.")); }, 5000);
    pending.current.set(id, { resolve, reject, timer });
    if (!origin) { clearTimeout(timer); pending.current.delete(id); reject(new Error("The game is still starting.")); return; }
    frame.current?.contentWindow?.postMessage({ channel: LAB_CHANNEL, id, action, ...values }, origin);
  });

  const navigate = (hash: string) => {
    forget();
    setTarget({ hash: hashOf(hash), nonce: Date.now() });
  };
  // Another game tab took the frame: open its lab at the section on screen (one game runs; a second or two to reload).
  const shownTab = useRef(view.id);
  useEffect(() => {
    if (shownTab.current === view.id) return;
    shownTab.current = view.id;
    navigate(tabLink(useWorkbenchStore.getState().workspaces.find((item) => item.id === workspace.id)?.game, tabLab));
    // Only when another tab takes the frame: the rest is read fresh from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.id]);

  const src = origin ? `${origin}/?studio=1${target.nonce ? `&v=${target.nonce}` : ""}${target.hash}` : undefined;
  return <section ref={paneRef} className={`game-pane ${lab && beside ? "has-panel-beside" : ""}`} aria-label="Game">
    <div className="game-toolbar">
      {editing !== undefined ? <form className="game-goto" onSubmit={(event) => {
        event.preventDefault();
        const value = editing.trim();
        setEditing(undefined);
        // A PR preview or main build link works too: only its #/ part matters here.
        if (value.includes("#/")) navigate(value.slice(value.indexOf("#/")));
      }}>
        <input autoFocus aria-label="Game link" value={editing} placeholder="Paste a #/world/… link or a preview link" onChange={(event) => setEditing(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") setEditing(undefined); }} onBlur={() => setEditing(undefined)} />
      </form> : <button className="game-crumbs" aria-label="Current section" title={`${current}\nClick to open another link`} onClick={() => setEditing(current)}>
        {crumb.place ? <>
          <span>{crumb.place}</span>
          {crumb.activity && <><span className="crumb-sep">▸</span><span>{crumb.activity}</span></>}
          {crumb.section && <><span className="crumb-sep">▸</span><strong>{crumb.section}</strong></>}
        </> : <strong>{lab === "character" ? "🦄 Character lab" : current.startsWith("#/world") ? "🌍 World" : current}</strong>}
        {crumb.params.map(([key, value]) => <code key={key} className="crumb-param">{key}={value}</code>)}
        {lab === "camera" && <code className="crumb-param is-lab">?cam=1</code>}
        {lab === "feel" && <code className="crumb-param is-lab">?feel=1</code>}
      </button>}
      <div className="game-tools">
        <select aria-label="Device frame" value={frameId} disabled={lab === "camera"} title={lab === "camera" ? "The camera lab has its own iPad and iPhone frames" : "Device frame"}
          onChange={(event) => patchGame(workspace.id, { frame: event.target.value as GameFrame })}>
          {FRAMES.map((item) => <option key={item.id} value={item.id}>{item.label}{item.width ? ` · ${item.width}×${item.height}` : ""}</option>)}
        </select>
        <button className="game-tool" aria-label="Reload the game" title="Reload this section" onClick={() => navigate(current)}><RefreshIcon size={14} /></button>
        {!isMain && <button className={`lab-toggle ${comparing ? "is-on" : ""}`} aria-pressed={comparing} title="This branch beside main, at the same section" onClick={() => setCompare(!compare)}>⇆ Main</button>}
        {comparing && <button className="game-tool" title="Open the section on screen in main too" onClick={() => setMainTarget({ hash: current, nonce: Date.now() })}>Sync main</button>}
        {issues.length > 0 && <button className={`lab-toggle ${showIssues ? "is-on" : ""}`} aria-pressed={showIssues} title="Known issues for this activity (known-issues.md)" onClick={() => setShowIssues(!showIssues)}>🐞 {issues.length}</button>}
        <button className="game-tool" disabled={!origin} title="Copy a link to the current section and settings" onClick={() => {
          void handleLabShare(workspace, { action: "copy", label: "Link", text: `${origin}/${current}` }).then(() => setShareStatus("Link copied")).catch(error => setShareStatus(String(error)));
        }}>Copy link</button>
        <button className="game-tool" disabled={!origin} title="Attach the current section and settings to the agent composer for review" onClick={() => {
          void handleLabShare(workspace, { action: "agent", label: "Game section", text: `Game section: ${origin}/${current}${snapshot ? `\n${JSON.stringify(snapshot, null, 2)}` : ""}` }).then(() => setShareStatus("Added to agent composer — review and send")).catch(error => setShareStatus(String(error)));
        }}>→ Agent</button>
      </div>
    </div>
    {shareStatus && <p role="status" style={{ margin: "4px 12px", fontSize: 12 }}>{shareStatus}</p>}
    <div className="game-body">
    <div className="game-stage" ref={stage.ref}>
      {installing ? <div className="game-message"><p>Installing the game's dependencies for {workspace.name} (npm ci)… The game starts when it's done.</p></div>
        : error ? <div className="game-message" role="alert"><strong>The game can't start here</strong><p>{error}</p><button className="game-tool" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>
        : !src ? <div className="game-message"><p>Starting the game for {workspace.name}…</p></div>
        : <div className={`game-compare ${comparing ? "is-split" : ""}`}>
          <figure className="game-column-view">
            {comparing && <figcaption>{workspace.name}</figcaption>}
            <div className={`game-device ${stage.device ? "is-framed" : ""}`} style={stage.device ? { width: stage.device.width * stage.scale, height: stage.device.height * stage.scale } : undefined}>
              <iframe ref={frame} title={`Game: ${workspace.name}`} src={src} allow="autoplay"
                style={stage.device ? { width: stage.device.width, height: stage.device.height, transform: `scale(${stage.scale})` } : undefined} />
            </div>
          </figure>
          {comparing && <figure className="game-column-view">
            <figcaption>main</figcaption>
            {mainOrigin && mainTarget ? <div className={`game-device ${stage.device ? "is-framed" : ""}`} style={stage.device ? { width: stage.device.width * stage.scale, height: stage.device.height * stage.scale } : undefined}>
              {/* Main's frame is only looked at: its messages never reach this pane (another origin and source). */}
              <iframe ref={mainFrame} title="Game: main" src={`${mainOrigin}/?studio=1&v=${mainTarget.nonce}${mainTarget.hash}`} allow="autoplay"
                style={stage.device ? { width: stage.device.width, height: stage.device.height, transform: `scale(${stage.scale})` } : undefined} />
            </div> : <div className="game-message"><p>Starting main's game…</p></div>}
          </figure>}
        </div>}
      {showIssues && <KnownIssuesList workspace={workspace} issues={issues} onClose={() => setShowIssues(false)} />}
    </div>
    {lab && src && <LabPanel key={lab} workspace={workspace} kind={lab} request={request} snapshot={snapshot} />}
    </div>
  </section>;
}
