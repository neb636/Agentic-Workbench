import { z } from "zod";
import type { PromptCondition } from "./prompt-options";

export const workbenchViewSchema = z.object({
  id: z.string(),
  type: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  state: z.unknown().optional(),
});

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  views: z.array(workbenchViewSchema),
  activeViewId: z.string().optional(),
  game: z.object({
    link: z.string().max(4000).optional(),
    frame: z.enum(["fit", "ipad-portrait", "ipad-wide", "iphone-wide", "iphone-tall"]).optional(),
    characterLink: z.string().max(4000).optional(),
    beforeCharacter: z.string().max(4000).optional(),
    draft: z.string().max(20_000).optional(),
    provider: z.enum(["claude", "codex"]).optional(),
  }).optional(),
});

export const personaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  scope: z.enum(["global", "workspace"]),
  workspaceId: z.string().optional(),
});

export const promptConditionSchema: z.ZodType<PromptCondition> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all"), conditions: z.array(promptConditionSchema) }),
  z.object({ kind: z.literal("any"), conditions: z.array(promptConditionSchema) }),
  z.object({ kind: z.literal("not"), condition: promptConditionSchema }),
  z.object({ kind: z.literal("isOn"), option: z.string() }),
  z.object({ kind: z.literal("isChoice"), option: z.string(), choice: z.string() }),
]));

const promptOptionChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  text: z.string(),
  description: z.string().optional(),
});

const optionFieldsSchema = {
  id: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  when: promptConditionSchema.optional(),
  display: z.enum(["list", "segmented", "dropdown"]).optional(),
  resetAfterSend: z.boolean().optional(),
};

export const promptOptionDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ ...optionFieldsSchema, kind: z.literal("toggle"), defaultOn: z.boolean(), text: z.string() }),
  z.object({ ...optionFieldsSchema, kind: z.literal("select"), defaultChoice: z.string(), choices: z.array(promptOptionChoiceSchema) }),
  z.object({ ...optionFieldsSchema, kind: z.literal("multiSelect"), defaultChoices: z.array(z.string()), choices: z.array(promptOptionChoiceSchema) }),
  z.object({ ...optionFieldsSchema, kind: z.literal("text"), placeholder: z.string(), defaultValue: z.string(),
    maxLength: z.number().int().min(1).max(10_000), template: z.string() }),
]);

export const storedPromptOptionSchema = z.object({
  scope: z.enum(["global", "workspace"]),
  workspaceId: z.string().optional(),
  option: promptOptionDefinitionSchema,
});

export const layoutStateSchema = z.object({
  leftSize: z.number().min(0).max(100).optional(),
  rightSize: z.number().min(0).max(100).optional(),
  leftCollapsed: z.boolean().default(false),
  rightCollapsed: z.boolean().default(false),
  rightPanel: z.string().optional(),
  shipCollapsed: z.boolean().optional(),
  explorer: z.object({
    collapsed: z.boolean().optional(),
    size: z.number().min(0).max(100).optional(),
    tab: z.enum(["files", "changes", "sections", "ship"]).optional(),
  }).optional(),
  lastAgentProvider: z.string().max(100).optional(),
});

export const persistedStateSchema = z.object({
  repoRoot: z.string().optional(),
  workspaces: z.array(workspaceSchema).default([]),
  activeWorkspaceId: z.string().optional(),
  personas: z.array(personaSchema).default([]),
  instructionOptions: z.array(storedPromptOptionSchema).default([]),
  layout: layoutStateSchema.default({ leftCollapsed: false, rightCollapsed: false }),
});

const legacyInstructionSchema = z.object({ id: z.string(), workspaceId: z.string(), content: z.string(), enabled: z.boolean() });

const LAB_VIEWS: Record<string, "camera" | "feel" | "character"> = { "camera-lab": "camera", "feel-lab": "feel", "character-lab": "character" };

/**
 * The Camera, Feel and Character labs used to be tabs; now they are switches on each piece of work's game pane.
 * Their tabs go away and their last links move onto the pane (a Feel or Camera link becomes where the game opens).
 */
export function migrateLabViews(input: unknown): unknown {
  if (typeof input !== "object" || input === null || !Array.isArray((input as { workspaces?: unknown }).workspaces)) return input;
  const source = input as { workspaces: unknown[] } & Record<string, unknown>;
  const workspaces = source.workspaces.map((value) => {
    if (typeof value !== "object" || value === null || !Array.isArray((value as { views?: unknown }).views)) return value;
    const workspace = value as { views: { id?: unknown; type?: unknown; state?: unknown }[]; activeViewId?: unknown; game?: Record<string, unknown> };
    const labs = workspace.views.filter((view) => typeof view?.type === "string" && LAB_VIEWS[view.type]);
    if (!labs.length) return value;
    const game: Record<string, unknown> = { ...(workspace.game ?? {}) };
    for (const view of labs) {
      const link = (view.state as { link?: unknown } | undefined)?.link;
      if (typeof link !== "string" || !link.includes("#/world/")) continue;
      const hash = link.slice(link.indexOf("#"));
      if (view.type === "character-lab") game.characterLink ??= hash;
      else game.link ??= hash.replace(/([?&])(cam|feel)=1(&|$)/g, (_, before, _key, after) => (after ? before : "")).replace(/[?&]$/, "");
    }
    const views = workspace.views.filter((view) => !labs.includes(view));
    const activeViewId = labs.some((view) => view.id === workspace.activeViewId) ? views[0]?.id : workspace.activeViewId;
    return { ...workspace, views, activeViewId, game };
  });
  return { ...source, workspaces };
}

const SIDEBAR_VIEWS: Record<string, "files" | "changes"> = { files: "files", "source-control": "changes" };

/**
 * Step 7-8 of the layout plan: the game was a right panel (`game.open`, `game.big`); now it's a tab in the middle, so a
 * piece of work whose panel was open gets a Game tab after its first agent. The Files and Commit changes tabs moved
 * into the explorer on the right: their tabs go, and the explorer opens on the one that was on screen.
 */
export function migrateStudioTabs(input: unknown): unknown {
  if (typeof input !== "object" || input === null || !Array.isArray((input as { workspaces?: unknown }).workspaces)) return input;
  const source = input as { workspaces: unknown[]; layout?: Record<string, unknown> } & Record<string, unknown>;
  let explorerTab: "files" | "changes" | undefined;
  const workspaces = source.workspaces.map((value) => {
    if (typeof value !== "object" || value === null || !Array.isArray((value as { views?: unknown }).views)) return value;
    const workspace = value as { id?: unknown; views: { id?: unknown; type?: unknown; workspaceId?: unknown }[]; activeViewId?: unknown; game?: Record<string, unknown> };
    let views = workspace.views;
    let activeViewId = workspace.activeViewId;
    const moved = views.filter((view) => typeof view?.type === "string" && SIDEBAR_VIEWS[view.type]);
    if (moved.length) {
      const active = moved.find((view) => view.id === activeViewId);
      if (active) explorerTab = SIDEBAR_VIEWS[active.type as string];
      views = views.filter((view) => !moved.includes(view));
      if (active) activeViewId = views[0]?.id;
    }
    let game = workspace.game;
    if (game && ("open" in game || "big" in game)) {
      const open = game.open;
      game = { ...game };
      delete game.open;
      delete game.big;
      if (open === true && !views.some((view) => view.type === "game")) {
        const at = views.findIndex((view) => view.type === "agent");
        const tab = { id: `view-game-${String(workspace.id ?? "work")}`, type: "game", workspaceId: workspace.id, title: "Game", state: {} };
        views = [...views.slice(0, at + 1), tab, ...views.slice(at + 1)];
      }
    }
    if (views === workspace.views && game === workspace.game) return value;
    return { ...workspace, views, activeViewId, game };
  });
  const layout = source.layout && typeof source.layout === "object" ? { ...source.layout } : source.layout;
  if (layout) { delete layout.gameSize; delete layout.gameBigSize; }
  if (explorerTab && layout) layout.explorer = { ...(layout.explorer as object | undefined), tab: explorerTab, collapsed: false };
  return { ...source, workspaces, ...(layout ? { layout } : {}) };
}

/** Converts state written before prompt options existed; unknown shapes pass through to normal validation. */
export function migratePersistedState(input: unknown): unknown {
  input = migrateStudioTabs(migrateLabViews(input));
  if (typeof input !== "object" || input === null) return input;
  const source = input as Record<string, unknown>;
  if (source.instructionOptions !== undefined || !Array.isArray(source.appendedInstructions)) return input;
  const instructionOptions = source.appendedInstructions.flatMap((item) => {
    const legacy = legacyInstructionSchema.safeParse(item);
    if (!legacy.success || !legacy.data.content.trim()) return [];
    const { id, workspaceId, content, enabled } = legacy.data;
    const label = content.trim().split("\n")[0].slice(0, 60);
    return [{ scope: "workspace", workspaceId, option: { id, kind: "toggle", label, category: "Custom", defaultOn: enabled, text: content } }];
  });
  return { ...source, instructionOptions };
}

export const ptyCreateOptionsSchema = z.object({
  cwd: z.string().min(1),
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(1).max(1000),
});

export const ptyInputSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
});

export const ptyResizeSchema = z.object({
  sessionId: z.string(),
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(1).max(1000),
});

export const ptyTerminateSchema = z.object({ sessionId: z.string() });

export const agentSessionCreateOptionsSchema = z.object({
  providerId: z.string().min(1),
  workspacePath: z.string().min(1),
  viewId: z.string().min(1),
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(1).max(1000),
  resume: z.boolean().optional(),
  profile: z.string().min(1).max(64).optional(),
  settings: z.object({ model: z.string().min(1).max(100), effort: z.string().min(1).max(20) }).optional(),
});

export const agentPromptSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1).max(500_000),
  intent: z.enum(["default", "plan"]),
});

export const agentSessionActionSchema = z.object({ sessionId: z.string().min(1) });

export const fileLocationSchema = z.object({ root: z.string().min(1), path: z.string().max(4096) });
export const fileFindSchema = z.object({ root: z.string().min(1), query: z.string().max(256) });
export const fileWriteSchema = z.object({ root: z.string().min(1), path: z.string().min(1).max(4096), content: z.string().max(2 * 1024 * 1024), expectedHash: z.string().max(64).nullable() });
export const fileSearchSchema = z.object({ root: z.string().min(1), query: z.string().min(1).max(256), caseSensitive: z.boolean().optional(), regex: z.boolean().optional() });
export const fileExistsSchema = z.object({ root: z.string().min(1), paths: z.array(z.string().min(1).max(1024)).max(200) });
export const fileCreateSchema = z.object({ root: z.string().min(1), path: z.string().min(1).max(4096), kind: z.enum(["file", "directory"]) });
export const fileRenameSchema = z.object({ root: z.string().min(1), from: z.string().min(1).max(4096), to: z.string().min(1).max(4096) });
export const fileAtSchema = z.object({ root: z.string().min(1), path: z.string().min(1).max(4096), base: z.enum(["head", "main"]) });
export const workspaceRootSchema = z.object({ root: z.string().min(1) });
export const commitSchema = z.object({ root: z.string().min(1), message: z.string().trim().min(1).max(10_000) });
export const createWorktreeSchema = z.object({ root: z.string().min(1), branch: z.string().min(1).max(200) });

const imageIdSchema = z.string().regex(/^[\w-]{1,80}$/);
export const imageViewSchema = z.object({ viewId: imageIdSchema });
export const imageImportSchema = z.object({ viewId: imageIdSchema, name: z.string().max(255), data: z.instanceof(Uint8Array) });
export const imageRunSchema = z.object({ viewId: imageIdSchema, runId: imageIdSchema });
export const imagePrepareRunSchema = imageRunSchema.extend({ attachments: z.array(z.string().max(255)).max(16) });
export const imageFileSchema = z.object({ viewId: imageIdSchema, file: z.string().min(1).max(512) });

export const imageRunManifestSchema = z.object({
  complete: z.boolean(),
  variants: z.array(z.object({
    index: z.number().int().min(1).max(16),
    title: z.string().max(200),
    prompt: z.string().max(20_000),
    sources: z.array(z.string().max(255)).max(16),
    changes: z.string().max(4_000),
    status: z.enum(["pending", "done", "failed"]),
    error: z.string().max(4_000).optional(),
  })).max(16),
});

export const workListSchema = z.object({ root: z.string().min(1), refresh: z.boolean().optional() });
export const workCreateSchema = z.object({ root: z.string().min(1), name: z.string().min(1).max(80) });
export const workRemoveSchema = z.object({ root: z.string().min(1), path: z.string().min(1) });
