import { create } from "zustand";
import type { GameFrame, GameLab, GameState, GameViewState, SectionEntry, SectionsIndex, WorkbenchView, Workspace } from "../../../shared/models";
import type { LabKind, LabSnapshot } from "../../../shared/labs";
import { useWorkbenchStore } from "../../state/workbench-store";

export const DEFAULT_LINK = "#/world";
export const DEFAULT_CHARACTER = "#/world/characters/nick";

/** The game tabs: one `game` view type, its lab in the tab's state. */
export const GAME_TABS: { lab?: GameLab; title: string; label: string; emoji: string; description: string }[] = [
  { title: "Game", label: "Game", emoji: "🎮", description: "The real game for this piece of work (⌘G)." },
  { lab: "camera", title: "Camera lab", label: "Camera lab", emoji: "🎥", description: "Nudge or lock the 3D camera of the section on screen (?cam=1)." },
  { lab: "feel", title: "Feel lab", label: "Feel lab", emoji: "🎛️", description: "Sliders for every knob of the section on screen (?feel=1)." },
  { lab: "character", title: "Character lab", label: "Character lab", emoji: "🦄", description: "The 3D character lab (#/world/characters)." },
];

export function gameTabFor(lab?: GameLab) {
  return GAME_TABS.find((tab) => tab.lab === lab) ?? GAME_TABS[0];
}

export function labOfView(view: WorkbenchView): GameLab | undefined {
  return (view.state as GameViewState | undefined)?.lab;
}

export const FRAMES: { id: GameFrame; label: string; width?: number; height?: number }[] = [
  { id: "fit", label: "Fill the pane" },
  { id: "ipad-wide", label: "iPad wide", width: 1180, height: 820 },
  { id: "ipad-portrait", label: "iPad portrait", width: 820, height: 1180 },
  { id: "iphone-wide", label: "iPhone wide", width: 844, height: 390 },
  { id: "iphone-tall", label: "iPhone tall", width: 390, height: 844 },
];

/** Live, unpersisted state of each piece of work's game pane. */
interface GameLive {
  /** What the game last reported (full URL) and its lab snapshot, by workspace id. */
  href: Record<string, string>;
  snapshot: Record<string, LabSnapshot | undefined>;
  /** The origin serving each workspace's game. */
  origin: Record<string, string>;
  /** A navigation request for a workspace's pane (the nonce reloads even the same link). */
  go: Record<string, { hash: string; nonce: number }>;
  sections: Record<string, { index?: SectionsIndex; error?: string; loading?: boolean }>;
  /** The controls before the last AI preview, by `<workspace id>:<lab>`, so Undo survives switching a lab off and on. */
  undo: Record<string, LabSnapshot | undefined>;
  /**
   * The game tab that owns each piece of work's one running game: the game tab on screen, else the last one shown
   * (it stays loaded, hidden, while Dad looks at the agent or a file). Unset until a game tab is first shown.
   */
  liveView: Record<string, string | undefined>;
}

export const useGameLive = create<GameLive>(() => ({ href: {}, snapshot: {}, origin: {}, go: {}, sections: {}, undo: {}, liveView: {} }));

export function setLiveView(workspaceId: string, viewId: string | undefined): void {
  if (useGameLive.getState().liveView[workspaceId] === viewId) return;
  useGameLive.setState((state) => ({ liveView: { ...state.liveView, [workspaceId]: viewId } }));
}

export function setLabUndo(key: string, snapshot: LabSnapshot | undefined): void {
  useGameLive.setState((state) => ({ undo: { ...state.undo, [key]: snapshot } }));
}

let nonce = 0;

/** The hash part of a game URL or link. */
export function hashOf(link: string): string {
  const at = link.indexOf("#");
  return at < 0 ? DEFAULT_LINK : link.slice(at);
}

/** The lab a link opens: `?cam=1`, `?feel=1` or the character lab's own route. */
export function labOf(link: string): LabKind | undefined {
  const hash = hashOf(link);
  if (hash.startsWith("#/world/characters")) return "character";
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  if (params.get("cam") === "1") return "camera";
  if (params.get("feel") === "1") return "feel";
  return undefined;
}

/** The same section with the camera or feel lab switched on or off (their tuned `cam.*` / `feel.*` values stay). */
export function withLab(link: string, lab: "camera" | "feel" | undefined): string {
  const [route, query = ""] = hashOf(link).split("?");
  const params = new URLSearchParams(query);
  params.delete("cam");
  params.delete("feel");
  if (lab === "camera") params.set("cam", "1");
  if (lab === "feel") params.set("feel", "1");
  const rest = params.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  return rest ? `${route}?${rest}` : route;
}

export interface Crumb { place?: string; activity?: string; section?: string; params: [string, string][]; entry?: SectionEntry; activityId?: string; placeId?: string }

/** Names for the current section from the sections index, plus its params (without the lab switches). */
export function crumbFor(link: string, index?: SectionsIndex): Crumb {
  const [route, query = ""] = hashOf(link).split("?");
  const [, world, placeId, activityId, sectionId] = route.split("/");
  const params = [...new URLSearchParams(query)].filter(([key]) => !["cam", "feel", "studio"].includes(key) && !key.startsWith("cam.") && !key.startsWith("feel."));
  if (world !== "world" || !placeId) return { params };
  const place = index?.places.find((item) => item.id === placeId);
  const activity = place?.activities.find((item) => item.id === activityId);
  const entry = activity?.sections.find((item) => item.id === sectionId);
  return {
    placeId, activityId,
    place: place ? `${place.emoji} ${place.name}` : decodeURIComponent(placeId),
    activity: activity?.name ?? (activityId ? decodeURIComponent(activityId) : undefined),
    section: entry?.name ?? (sectionId ? decodeURIComponent(sectionId) : undefined),
    params, entry,
  };
}

export function patchGame(workspaceId: string, patch: Partial<GameState>): void {
  useWorkbenchStore.setState((state) => ({
    workspaces: state.workspaces.map((workspace) => workspace.id === workspaceId ? { ...workspace, game: { ...workspace.game, ...patch } } : workspace),
  }));
}

/** Where a game tab opens: the section on screen with its lab switched on (the Character lab keeps its own link). */
export function tabLink(game: GameState | undefined, lab: GameLab | undefined): string {
  if (lab === "character") return game?.characterLink ?? DEFAULT_CHARACTER;
  return withLab(game?.link ?? DEFAULT_LINK, lab);
}

function workspaceById(workspaceId: string): Workspace | undefined {
  return useWorkbenchStore.getState().workspaces.find((candidate) => candidate.id === workspaceId);
}

/** Brings the game tab for a lab (or the plain Game tab) forward, opening one if there isn't one. Returns its id. */
export function openGameTab(workspaceId: string, lab?: GameLab): string | undefined {
  const workspace = workspaceById(workspaceId);
  if (!workspace) return undefined;
  const store = useWorkbenchStore.getState();
  const existing = workspace.views.find((view) => view.type === "game" && labOfView(view) === lab);
  if (existing) { store.selectView(workspaceId, existing.id); return existing.id; }
  const tab = gameTabFor(lab);
  return store.createView(workspaceId, "game", tab.title, { ...(lab ? { lab } : {}) } satisfies GameViewState);
}

/** ⌘G: the game tab on screen stays; else the one that's loaded, else the first, else a new Game tab. */
export function focusGame(workspaceId: string): void {
  const workspace = workspaceById(workspaceId);
  if (!workspace) return;
  const active = workspace.views.find((view) => view.id === workspace.activeViewId);
  if (active?.type === "game") return;
  const live = useGameLive.getState().liveView[workspaceId];
  const target = workspace.views.find((view) => view.id === live && view.type === "game") ?? workspace.views.find((view) => view.type === "game");
  if (target) useWorkbenchStore.getState().selectView(workspaceId, target.id);
  else openGameTab(workspaceId);
}

/** Opens a link in a piece of work's game: in the game tab that's loaded, else in a game tab for that link's lab. */
export function openInGame(workspaceId: string, hash: string): void {
  const workspace = workspaceById(workspaceId);
  if (!workspace) return;
  const target = hashOf(hash);
  const live = useGameLive.getState().liveView[workspaceId];
  const loaded = workspace.views.find((view) => view.id === live && view.type === "game");
  if (loaded) {
    useGameLive.setState((state) => ({ go: { ...state.go, [workspaceId]: { hash: target, nonce: ++nonce } } }));
    useWorkbenchStore.getState().selectView(workspaceId, loaded.id);
    return;
  }
  // No game loaded yet: the tab mounts fresh and opens at its saved link.
  const lab = labOf(target);
  patchGame(workspaceId, lab === "character" ? { characterLink: target } : { link: withLab(target, undefined) });
  openGameTab(workspaceId, lab);
}

/** The game's current link for a workspace: what it last reported, else where it was left. */
export function currentLink(workspaceId: string): string {
  const live = useGameLive.getState().href[workspaceId];
  if (live) return hashOf(live);
  return useWorkbenchStore.getState().workspaces.find((workspace) => workspace.id === workspaceId)?.game?.link ?? DEFAULT_LINK;
}

/** The sections of one checkout (cached in main for a few minutes; `refresh` reads them again). */
export async function loadSections(root: string, refresh = false): Promise<void> {
  const current = useGameLive.getState().sections[root];
  if (current?.loading || (current?.index && !refresh)) return;
  const set = (value: GameLive["sections"][string]) => useGameLive.setState((state) => ({ sections: { ...state.sections, [root]: value } }));
  set({ ...current, loading: true });
  try { set({ index: await window.workbench.studio.sections(root, refresh) }); }
  catch (error) { set({ error: String(error).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, "") }); }
}
