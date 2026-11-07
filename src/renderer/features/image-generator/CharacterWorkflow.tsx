import type { ImageGeneratorViewState } from '../../../shared/models';
import type { ViewComponentProps } from '../../core/view-registry';
import { useWorkbenchStore } from '../../state/workbench-store';
const STAGES = [
  { title: '1. Concept', task: 'Describe the family member in words. Generate one vinyl A-pose image, inspect real transparency, then iterate only one requested change. Never add family photos to the repo.' },
  { title: '2. Tripo', task: 'Prepare a Tripo handoff checklist for this character: Smart Mesh, Quad, 5000 polycount, 4 untextured meshes, private if the plan allows, no auto-rig. Dad generates/downloads the four GLBs into the private models folder. Do not spend credits or claim a Tripo integration exists. Compare before texturing only the winner at 1k; export GLB.' },
  { title: '3. Compare meshes', task: 'Use Blender MCP if available (otherwise explain setup): import the four untextured GLBs side by side, render front/three-quarter/side/back; count triangles, loose parts and non-manifold edges. Inspect invented backs, limb gaps, horn/ears/braid and silhouette. Present the comparison for Dad to choose. Do not texture or choose a winner silently.' },
  { title: '4. Split & rig', task: 'Use Blender MCP if available to inspect loose parts first. Follow docs/3d-characters.md: cut and cap arms/legs only where needed; rigid pivots, no skeleton. Keep transforms, face +Z in glTF, root at feet, named body/head/eyes/armL/armR/legL/legR/tail pivots. Paint out eyes under domes and mouth for a talking member, add code mouth. Render test poses. Save .blend privately, export selection-only GLB, Y up, no animations, JPEG textures quality 92.' },
  { title: '5. Game & lab QA', task: 'Inspect this character’s rig and integrate its approved GLB lazily in Thailand with the code-built fallback. Use shared toon shading and smoothed ink hulls; map the same Rig. Measure wardrobe, hands/waist/front/spots, fix blink and talking mouth where needed. Add its lab/catalog.ts entry and code-built comparison. Check walk, sit, lie, wave, wai, outfits and trip attachments; capture filmstrips. Do not claim checks you did not run. Run npm run verify.' },
];
export function CharacterWorkflow({ view, workspace }: ViewComponentProps) {
  const state = (view.state ?? {}) as ImageGeneratorViewState & { characterId?: string; workflowStage?: number; workflowNotes?: string };
  const patch = (value: Record<string, unknown>) => useWorkbenchStore.getState().updateViewState(workspace.id, view.id, value);
  const stage = STAGES[state.workflowStage ?? 0] ?? STAGES[0];
  return <div className="character-workflow studio-lab" style={{ height: 'auto' }}>
    <strong>Picture → Tripo → Blender → the game’s existing rig</strong>
    <div className="studio-actions">
      <label>Character ID<input aria-label="Character ID" placeholder="Use the family’s existing ID" value={state.characterId ?? ''} onChange={e => patch({ characterId: e.target.value })} /></label>
      <label>Stage<select aria-label="Character workflow stage" value={state.workflowStage ?? 0} onChange={e => patch({ workflowStage: Number(e.target.value) })}>{STAGES.map((s, i) => <option key={s.title} value={i}>{s.title}</option>)}</select></label>
    </div>
    <p>{stage.task}</p>
    <label>Chosen image / mesh paths and builder notes<input aria-label="Character workflow notes" placeholder="Private source paths, the mesh Dad picked, changes to make…" value={state.workflowNotes ?? ''} onChange={e => patch({ workflowNotes: e.target.value })} /></label>
    <div className="studio-actions"><button disabled={!state.characterId?.trim()} onClick={async () => {
      const chosen = state.runs?.find(run => run.chosen);
      let concept = 'No concept selected in this view. Use only the explicit sources in Dad’s notes.';
      try { if (chosen) concept = `Chosen concept: ${await window.workbench.images.folder(view.id)}/${chosen.id}/candidate-${chosen.chosen}.png`; } catch (error) { patch({ workflowNotes: `${state.workflowNotes ?? ''}\nCould not locate concept: ${error}` }); return; }
      useWorkbenchStore.getState().createView(workspace.id, 'agent', `${state.characterId}: ${stage.title}`, { autoTitle: false, draft: `Read AGENTS.md and docs/3d-characters.md completely first. Work on this checkout and branch. Do not run git or gh; do not commit, push or open PRs.\nCharacter ID supplied by Dad: ${state.characterId}\nPrivate sources live under ~/repos/KayleeGamepack-planning-assets/models/<id>/; family photos stay outside this repo. Do not invent family facts.\n${concept}\nStage: ${stage.title}\n${stage.task}\nDad's notes: ${state.workflowNotes ?? ''}` });
    }}>Prepare stage prompt for Claude or Codex</button></div>
  </div>;
}
