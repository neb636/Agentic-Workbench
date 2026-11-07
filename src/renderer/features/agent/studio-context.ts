import type { Workspace } from "../../../shared/models";
import { crumbFor, currentLink, labOf, useGameLive } from "../game/game-store";
import { useWorkList } from "../work/work-store";

const SITE = "https://neb636.github.io/Kaylee-Gamepack/";

function samePath(a: string, b: string) {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/** The open PR for a piece of work, if the Work list knows one. */
export function pullRequestFor(workspace: Workspace) {
  return useWorkList.getState().list?.items.find((item) => samePath(item.path, workspace.path))?.pr;
}

/** Where the game is on this piece of work's preview (or main, when there is no open PR). */
export function previewLink(workspace: Workspace, hash = currentLink(workspace.id)): string {
  const pr = pullRequestFor(workspace);
  return `${SITE}${pr?.state === "OPEN" ? `pr-preview/pr-${pr.number}/` : ""}${hash}`;
}

/** 📎 this section: the link, its params and names, and the lab snapshot when a lab is on. */
export function sectionContext(workspace: Workspace): { label: string; content: string } {
  const hash = currentLink(workspace.id);
  const live = useGameLive.getState();
  const crumb = crumbFor(hash, live.sections[workspace.path]?.index);
  const names = [crumb.place, crumb.activity, crumb.section].filter(Boolean).join(" ▸ ");
  const lines = [
    `The game section Dad is looking at in Studio: ${hash}`,
    names && `That is ${names}${crumb.params.length ? ` with ${crumb.params.map(([key, value]) => `${key}=${value}`).join(", ")}` : ""}.`,
    crumb.placeId && crumb.activityId && `Its sections are declared in src/world/places/${crumb.placeId}/activities/ (the ${crumb.activityId} sections.ts).`,
    `Locally: ${live.origin[workspace.id] ?? "http://127.0.0.1:5174"}/${hash}. Online: ${previewLink(workspace, hash)}`,
  ].filter(Boolean);
  const snapshot = labOf(hash) ? live.snapshot[workspace.id] : undefined;
  if (snapshot) lines.push(`The ${snapshot.kind} lab is on. Its live state:`, JSON.stringify(snapshot, null, 2));
  return { label: names ? `Game: ${crumb.section ?? names}` : "Game section", content: lines.join("\n") };
}

export interface Starter { id: string; label: string; description: string; text: (workspace: Workspace) => string }

/** Prompt starters that follow AGENTS.md's gates; each names the section on screen. */
export const STARTERS: Starter[] = [
  { id: "plan", label: "Plan", description: "A plan page for the next activity or step, then stop for Dad",
    text: () => "Read AGENTS.md. Write the plan as a plan page (the plan-page skill and planning/around-the-world/ACTIVITY-TEMPLATE.md): the one core verb and how it deepens three times, her choices, things to poke, the touch count, the sections and the state each one carries. Ask me what only I can decide (family facts, temples are out). Stop for me before building anything.\n\nWhat to plan: " },
  { id: "greybox", label: "Greybox", description: "Only the core verb, placeholder shapes, knobs and a ?feel=1 link",
    text: () => "Read AGENTS.md and the plan. Build the next greybox: only the core verb, placeholder shapes (in 3D already in the toon look), no generated art and no voices. Every feel number is a knobs() knob with a ?feel=1 link in the PR, and every section has a deep link. List it under inTheWorks. Run npm run verify, open the PR with the open-pr skill, and stop for me to play it.\n\nWhich step: " },
  { id: "art", label: "Art", description: "The art and characters gate",
    text: () => "Read AGENTS.md, art/STYLE.md and the plan. Do the art and characters gate for this activity: one camera per scene, layered backgrounds, live puppets or rig characters (never flat pictures sliding around), no text in images. Check every cutout with qa-art.mjs, then run full QA (layout-qa, then playtest-qa) on just this activity. Open the PR and stop for me.\n\nActivity: " },
  { id: "full-loop", label: "Full loop", description: "Story, voices, payoff, hints, into the game",
    text: () => "Read AGENTS.md and the plan. Build the full loop: the story beat (1-2 short lines), voices in each character's own voice (lines.ts, cast.json, generate the clips), hints through spendHint, the stamp and sticker, and move it from inTheWorks to activities. Run full QA (layout-qa, then playtest-qa) for this activity, fix what it finds, update the plan page, and open the PR.\n\nActivity: " },
  { id: "fix", label: "Fix", description: "Fix what's wrong in the section on screen",
    text: () => "Read AGENTS.md. Fix this in the game section attached below (open its link to see it). Keep the fix small, screenshot the section before and after, run npm run verify and open the PR with a 🔗 Test this link to exactly this moment.\n\nWhat's wrong: " },
  { id: "bake", label: "Bake lab values", description: "Save the numbers Dad tuned in the lab",
    text: () => "Read AGENTS.md. I tuned the lab values in the attached snapshot. Bake only the values that changed into the matching knob defaults (or the world's shot() and rig.fov for the camera lab), for this round and screen shape only. Leave the knobs and watchers in place, check tap targets stay at 64 px or more, run npm run verify and open the PR.\n\n" },
  { id: "review", label: "Address review", description: "Work through the PR's review comments",
    text: (workspace) => {
      const pr = pullRequestFor(workspace);
      return `Read AGENTS.md and the open-pr skill. Work through the review comments on ${pr ? `PR #${pr.number}` : "this branch's PR"} (gh pr view --comments and the inline comments). Verify each one before changing code: fix the real ones (npm run verify, push, reply "Fixed in <sha>"), 👎 and reply to the nitpicky ones, and leave decisions for me. Then ask @codex to review again.`;
    } },
];
