// Character concepts follow docs/3d-characters.md, one image and one change at a time.
export interface OrchestrationInput {
  dir: string; request: string; count: number; sources: { file: string; name: string }[];
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function codexCommand(dir: string, sourceFlags: string): string {
  return `codex exec --skip-git-repo-check -C ${quote(dir)} -s workspace-write -m gpt-6.1-sol -c 'model_reasoning_effort="low"' ${sourceFlags} -o ${quote(`${dir}/variant-1.log.md`)} "Follow the instructions in variant-1.md"`;
}
export function orchestrationPrompt({ dir, request, sources }: OrchestrationInput): string {
  return `Create ONE character concept for Kaylee's Gamepack, following the concept stage of docs/3d-characters.md. Do not run git or gh; do not commit, push or open PRs. Do not run Tripo or Blender. Do not invent family identities or animal choices.
Run folder: ${dir}
Dad's request:\n${request.trim()}
Attached sources:\n${sources.map(s => `${dir}/${s.file} (${s.name})`).join('\n') || 'None: use the description.'}

Recipe:
- A soft-vinyl designer art toy: smooth matte plastic, puffy rounded shapes, glossy eyes, simple cute face, head about one third of the height, one color per animal.
- Exactly front-facing, symmetrical A-pose, arms about 40 degrees out with visible gaps from the body, legs apart with a gap, eyes forward, gentle smile. Even studio light. No floor, no shadow, no text, letters or numbers.
- A square 1024x1024 PNG WITH A TRANSPARENT BACKGROUND, real alpha channel. This is the input to Tripo Smart Mesh.
- With a prior concept attached, redraw the SAME character. Keep face, outfit, colors and proportions; change ONLY what Dad asks. A family photo is only a narrowly specified color/detail reference, never the main image. Keep all private sources in this local folder.

Steps:
1. Write ${dir}/variant-1.md with the full image prompt, source descriptions, the recipe, Dad's requested change and: "Generate exactly ONE image with your image generation tool. Save it at ${dir}/candidate-1.png as a real alpha PNG, 1024x1024. Do not run git or gh; do not commit, push or open PRs."
2. Write ${dir}/manifest.json: {"complete":false,"variants":[{"index":1,"title":"Character concept","prompt":"the full image prompt","sources":${JSON.stringify(sources.map(s => s.file))},"changes":"Explain only the requested changes; say which sources are detail references.","status":"pending"}]}.
3. Run exactly one plain Bash command, no shell chaining:
${codexCommand(dir, sources.map(s => `-i ${quote(`${dir}/${s.file}`)}`).join(' '))}
4. Check candidate-1.png exists and validate its size and real transparency (alpha must include transparent pixels, not an opaque white background). If validation tools are unavailable say so in the manifest; never claim validation without checking. Set the variant to done or failed with an error. Set complete to true. Do not silently generate extra variants or auto-retry. Dad chooses the next change.
5. Reply with the output path and validation result.`;
}
export function retryPrompt({ dir }: { dir: string; index: number }): string {
  return `Retry the single character concept in ${dir}. Do not run git or gh, commit, push or open PRs. Read variant-1.md and the prior log. Set manifest.complete=false and the first variant pending. Run exactly one codex exec command like before, with each of the manifest's source files attached as a separate quoted -i argument. Keep the same character; do not invent variants. Command form:\n${codexCommand(dir, "-i '<source path from manifest; omit when no sources>'")}\nCheck candidate-1.png and real transparency; update the manifest status and complete=true, or report the error. Never auto-retry.`;
}
