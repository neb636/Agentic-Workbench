import { useEffect, useRef, useState } from "react";
import { snapshotKey, undoSceneKey, validateProposal, type LabKind, type LabProposal, type LabSnapshot } from "../../../shared/labs";
import type { Workspace } from "../../../shared/models";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { patchGame, setLabUndo, useGameLive } from "./game-store";

/** The scene without its server's origin: this piece of work may come back on another port after the pool evicts it. */
const sceneKey = (snapshot: LabSnapshot) => undoSceneKey({ ...snapshot, href: snapshot.href.replace(/^https?:\/\/[^/]+/, "http://game") });

export type LabRequest = (action: "snapshot" | "apply", values?: { expected: string; proposal: LabProposal }) => Promise<LabSnapshot>;

/**
 * The tuning panel under the game while a lab is switched on: describe a change, AI previews bounded numbers in the
 * live lab (Undo restores them), and a separate, reviewable agent prompt saves the chosen numbers in the game.
 */
export function LabPanel({ workspace, kind, request, snapshot }: { workspace: Workspace; kind: LabKind; request: LabRequest; snapshot?: LabSnapshot }) {
  const game = workspace.game ?? {};
  const character = kind === "character";
  const [message, setMessage] = useState(character ? "Pick a character and pose in the lab, then describe the change." : "Describe what should feel or look different.");
  const [busy, setBusy] = useState(false);
  // Kept outside the panel, so switching the lab off and on (or to another lab and back) keeps Undo.
  const undoKey = `${workspace.id}:${kind}`;
  const undo = useGameLive((state) => state.undo[undoKey]);
  const setUndo = (value: LabSnapshot | undefined) => setLabUndo(undoKey, value);
  const job = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (job.current) window.workbench.studio.cancel(job.current); };
  }, []);
  const refresh = () => request("snapshot").catch((error) => { if (alive.current) setMessage(String(error)); });

  async function tune() {
    const id = crypto.randomUUID(); job.current = id;
    setBusy(true); setMessage("Reading the live controls…");
    try {
      const before = await request("snapshot");
      if (!alive.current || job.current !== id) return;
      if (!before.controls.length) throw new Error("No controls in this section. Open a scene with knobs or a 3D camera.");
      setMessage(`Asking ${game.provider ?? "claude"}…`);
      const proposal = validateProposal(before, await window.workbench.studio.tune({ id, provider: game.provider ?? "claude", prompt: game.draft ?? "", snapshot: before }));
      if (!alive.current || job.current !== id) return;
      // The game independently checks freshness too. An AI reply cannot overwrite a later scene or manual tweak.
      const now = await request("snapshot");
      if (snapshotKey(before) !== snapshotKey(now)) throw new Error("The scene or controls changed while AI was thinking. Keep this moment still and try again.");
      if (proposal.changes.length) {
        await request("apply", { expected: snapshotKey(before), proposal });
        setUndo(before);
      }
      setMessage(proposal.explanation);
      await refresh();
    } catch (error) { if (alive.current) setMessage(String(error)); }
    finally { if (alive.current) setBusy(false); job.current = undefined; }
  }

  async function restore() {
    if (!undo) return;
    try {
      const now = await request("snapshot");
      if (sceneKey(now) !== sceneKey(undo)) throw new Error("Return to the original scene, mode and frame before undoing.");
      await request("apply", { expected: snapshotKey(now), proposal: { explanation: "Undo AI tuning", changes: undo.controls.map((c) => ({ key: c.key, value: c.value })) } });
      setUndo(undefined); setMessage("Restored the controls from before AI tuning."); await refresh();
    } catch (error) { setMessage(String(error)); }
  }

  async function openAgent() {
    let current: LabSnapshot;
    try { current = await request("snapshot"); } catch (error) { setMessage(String(error)); return; }
    const prompt = `Read AGENTS.md first. Work on this checkout and branch. Do not commit, push or open PRs.\n${character ? "Read docs/3d-characters.md and inspect the current character in the lab." : "Bake only the changed lab values into the matching defaults. Keep other rounds and screen shapes unchanged; leave knobs and watchers in place."}\n${JSON.stringify(current, null, 2)}\nDad’s note: ${game.draft ?? ""}\n${message}`;
    const id = useWorkbenchStore.getState().createView(workspace.id, "agent", character ? "Character builder" : "Bake lab changes", { autoTitle: false });
    // Prefill only: Dad reviews and sends in the existing CLI composer.
    useWorkbenchStore.getState().updateViewState(workspace.id, id, { draft: prompt });
  }

  return <div className="studio-composer lab-panel" aria-label={`${kind} lab panel`}>
    <label>{character ? "Character builder note" : "What should feel or look different?"}
      <textarea aria-label="Lab prompt" value={game.draft ?? ""} placeholder={character ? "Describe the character or rig change. The builder will use docs/3d-characters.md…" : "The car is too twitchy when I make a small turn. Make it gentler…"}
        onChange={(event) => patchGame(workspace.id, { draft: event.target.value })} />
    </label>
    <div className="studio-actions">
      {!character && <>
        <select aria-label="AI provider" value={game.provider ?? "claude"} onChange={(event) => patchGame(workspace.id, { provider: event.target.value as "claude" | "codex" })}><option value="claude">Claude Code</option><option value="codex">Codex CLI</option></select>
        <button disabled={busy || !game.draft?.trim()} onClick={() => void tune()}>Ask AI & preview controls</button>
        <button disabled={!busy} onClick={() => { if (job.current) window.workbench.studio.cancel(job.current); job.current = undefined; setMessage("Cancelled"); }}>Cancel</button>
        <button disabled={busy || !undo} onClick={() => void restore()}>Undo AI change</button>
        <button disabled={busy} onClick={() => void refresh()}>Read controls</button>
      </>}
      <button disabled={busy || (!character && !snapshot)} onClick={() => void openAgent()}>{character ? "Prepare character builder prompt" : "Prepare prompt to save in game"}</button>
      {character && <button onClick={() => void services.commands.execute("view.create", { workspaceId: workspace.id, viewType: "image-generator" })}>Create character concept</button>}
    </div>
    <p role="status">{message}</p>
    {snapshot && <details><summary>{character ? "Current character and pose" : `${snapshot.controls.length} live controls · source stays unchanged until you send the save prompt`}</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details>}
  </div>;
}
