/** Shared by the game and desktop studio. No Electron, React or Node dependencies. */
export type LabKind = 'camera' | 'feel' | 'character';
export interface LabControl {
  key: string; label: string; value: number; min: number; max: number; step: number;
  note?: string; file?: string; defaultValue?: number;
}
export interface LabSnapshot {
  kind: LabKind; href: string; context: Record<string, unknown>; controls: LabControl[];
}
export interface LabProposal { explanation: string; changes: { key: string; value: number }[]; }
export const LAB_CHANNEL = 'kaylee-studio-v1';
/** The first game server's origin. Each piece of work gets its own server (see GAME_PORTS), so prefer gameOrigin(port). */
export const GAME_ORIGIN = 'http://127.0.0.1:5174';
export const STUDIO_ORIGIN = 'http://127.0.0.1:5175';
/** Game servers, one per piece of work: 5174 first (the one `npm run studio` starts), then every other port above 5175. */
export const GAME_PORTS = [5174, 5176, 5178, 5180];
export function gameOrigin(port: number): string { return `http://127.0.0.1:${port}`; }
/** True for an origin one of the Studio's game servers could be serving. */
export function isGameOrigin(origin: string): boolean { return GAME_PORTS.some(port => gameOrigin(port) === origin); }

/** Reject the whole proposal before changing anything. Never accept invented knobs or non-finite numbers. */
export function validateProposal(snapshot: LabSnapshot, input: unknown): LabProposal {
  const p = input as LabProposal | null;
  if (!p || typeof p.explanation !== 'string' || p.explanation.length > 6000 || !Array.isArray(p.changes) || p.changes.length > 100) throw new Error('Invalid AI response');
  const seen = new Set<string>();
  for (const change of p.changes) {
    if (!change || typeof change.key !== 'string') throw new Error('Invalid control');
    const control = snapshot.controls.find(c => c.key === change.key);
    if (!control || seen.has(change.key) || !Number.isFinite(change.value) || change.value < control.min || change.value > control.max) throw new Error(`Invalid value for ${change.key}`);
    seen.add(change.key);
  }
  return { explanation: p.explanation, changes: p.changes.map(c => ({ key: c.key, value: c.value })) };
}
export function snapshotKey(snapshot: LabSnapshot): string { return JSON.stringify({ kind: snapshot.kind, href: snapshot.href, mode: snapshot.context.mode, frame: snapshot.context.frame, controls: snapshot.controls }); }

/** Undo belongs to one game scene, independent of the outer studio query and live lab values. */
export function undoSceneKey(snapshot: LabSnapshot): string {
  const url = new URL(snapshot.href);
  const [route, query = ''] = url.hash.split('?');
  const state = new URLSearchParams(query);
  for (const key of [...state.keys()]) {
    if (key === 'cam' || key.startsWith('cam.') || key === 'feel' || key.startsWith('feel.')) state.delete(key);
  }
  state.sort();
  return JSON.stringify({ kind: snapshot.kind, origin: url.origin, path: url.pathname, route, state: state.toString(), mode: snapshot.context.mode, frame: snapshot.context.frame });
}

/** A user-initiated handoff from an embedded lab. Text only; never commands or executable paths. */
export interface LabShare { action: 'copy' | 'agent'; text: string; label: string; }
export function validateLabShare(input: unknown): LabShare {
  const value = input as LabShare | null;
  if (!value || !['copy', 'agent'].includes(value.action) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 200_000 || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 200) throw new Error('Invalid lab handoff');
  return { action: value.action, text: value.text, label: value.label };
}
