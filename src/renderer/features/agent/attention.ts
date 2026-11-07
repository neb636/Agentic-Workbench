import { useViewStatuses, type ViewStatus } from "../../core/view-status";
import { useWorkbenchStore } from "../../state/workbench-store";
import type { Workspace } from "../../../shared/models";

export type Attention = "needs-answer" | "done" | "working" | undefined;

/** What a piece of work's agents want: an answer beats a finished job, which beats one still working. */
export function workAttention(workspace: Workspace | undefined, statuses: Record<string, ViewStatus>): Attention {
  const mine = (workspace?.views ?? []).map((view) => statuses[view.id]).filter(Boolean);
  if (mine.some((status) => status.tone === "attention")) return "needs-answer";
  if (mine.some((status) => status.unseen)) return "done";
  if (mine.some((status) => status.tone === "working")) return "working";
  return undefined;
}

/** Two soft notes, so Dad hears an agent finish or ask while he's playing the game. */
function chime(rising: boolean): void {
  try {
    const context = new AudioContext();
    const notes = rising ? [659.25, 987.77] : [987.77, 659.25];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = context.currentTime + index * 0.14;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.55);
    });
    setTimeout(() => void context.close(), 1200);
  } catch { /* no audio device */ }
}

/** The Dock badge counts pieces of work waiting on Dad; a chime marks each new finish or question. */
export function watchAttention(): () => void {
  let previous = new Map<string, Attention>();
  const sync = () => {
    const statuses = useViewStatuses.getState();
    const next = new Map<string, Attention>();
    for (const workspace of useWorkbenchStore.getState().workspaces) next.set(workspace.id, workspaceAttentionFor(workspace, statuses));
    let rang = false;
    for (const [id, attention] of next) {
      const before = previous.get(id);
      if (!rang && attention !== before && (attention === "done" || attention === "needs-answer")) { chime(attention === "done"); rang = true; }
    }
    previous = next;
    const waiting = [...next.values()].filter((value) => value === "done" || value === "needs-answer").length;
    window.workbench.app.badge(waiting);
  };
  const workspaceAttentionFor = workAttention;
  const offStatuses = useViewStatuses.subscribe(sync);
  const offWorkspaces = useWorkbenchStore.subscribe((state, before) => { if (state.workspaces !== before.workspaces) sync(); });
  sync();
  return () => { offStatuses(); offWorkspaces(); };
}
