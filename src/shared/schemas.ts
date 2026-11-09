import { z } from "zod";
import type { PromptCondition } from "./prompt-options";
import { MAX_ATTACHMENT_BYTES } from "./prompt-attachments";

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
  // A bad icon falls back to the folder rather than failing validation, which would discard the whole saved state.
  icon: z.string().max(64 * 1024).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).optional().catch(undefined),
  views: z.array(workbenchViewSchema),
  activeViewId: z.string().optional(),
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
});

export const persistedStateSchema = z.object({
  workspaces: z.array(workspaceSchema).default([]),
  activeWorkspaceId: z.string().optional(),
  personas: z.array(personaSchema).default([]),
  instructionOptions: z.array(storedPromptOptionSchema).default([]),
  layout: layoutStateSchema.default({ leftCollapsed: false, rightCollapsed: false }),
  defaultAgentProviderId: z.string().optional(),
});

const legacyInstructionSchema = z.object({ id: z.string(), workspaceId: z.string(), content: z.string(), enabled: z.boolean() });

/** Converts state written before prompt options existed; unknown shapes pass through to normal validation. */
export function migratePersistedState(input: unknown): unknown {
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
  resume: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("id"), id: z.uuid() }),
    z.object({ kind: z.literal("latest") }),
    z.object({ kind: z.literal("pick") }),
  ]).optional(),
  settings: z.object({ model: z.string().min(1).max(100), effort: z.string().min(1).max(20).optional() }).optional(),
});

export const agentPromptSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1).max(500_000),
  intent: z.enum(["default", "plan"]),
});

export const agentSessionActionSchema = z.object({ sessionId: z.string().min(1) });

export const attachmentSaveSchema = z.object({
  viewId: z.string().min(1).max(200),
  name: z.string().min(1).max(1024),
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= MAX_ATTACHMENT_BYTES, "That file is too large to attach."),
});
export const attachmentLocationSchema = z.object({ viewId: z.string().min(1).max(200), id: z.uuid() });

export const fileLocationSchema = z.object({ root: z.string().min(1), path: z.string().max(4096) });
export const fileFindSchema = z.object({ root: z.string().min(1), query: z.string().max(256) });
export const workspaceRootSchema = z.object({ root: z.string().min(1) });
export const commitSchema = z.object({ root: z.string().min(1), message: z.string().trim().min(1).max(10_000) });
export const generateCommitMessageSchema = z.object({ root: z.string().min(1), providerId: z.string().min(1).max(100).optional() });
export const createWorktreeSchema = z.object({ root: z.string().min(1), branch: z.string().min(1).max(200), base: z.string().min(1).max(500).optional() });
export const baseBranchesSchema = z.object({ root: z.string().min(1), refresh: z.boolean().optional() });
export const checkoutSchema = z.object({ root: z.string().min(1), branch: z.string().min(1).max(200) });
export const fileWriteSchema = z.object({ root: z.string().min(1), path: z.string().min(1).max(4096), content: z.string().max(2 * 1024 * 1024), expectedHash: z.string().max(64).nullable() });
export const fileSearchSchema = z.object({ root: z.string().min(1), query: z.string().min(1).max(256), caseSensitive: z.boolean().optional(), regex: z.boolean().optional(), directory: z.string().max(4096).optional() });
export const fileExistsSchema = z.object({ root: z.string().min(1), paths: z.array(z.string().min(1).max(1024)).max(200) });
export const fileCreateSchema = z.object({ root: z.string().min(1), path: z.string().min(1).max(4096), kind: z.enum(["file", "directory"]) });
export const fileRenameSchema = z.object({ root: z.string().min(1), from: z.string().min(1).max(4096), to: z.string().min(1).max(4096) });
export const fileAtSchema = z.object({ root: z.string().min(1), path: z.string().min(1).max(4096), base: z.enum(["head", "default"]) });

const operationLocation = fileLocationSchema;
export const fileOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), target: operationLocation, entryKind: z.enum(["file", "directory"]) }),
  z.object({ kind: z.literal("rename"), source: operationLocation, target: operationLocation }),
  z.object({ kind: z.literal("transfer"), sources: z.array(operationLocation).min(1).max(5000), destination: operationLocation, move: z.boolean(), collision: z.enum(["error", "keep-both", "skip"]) }),
  z.object({ kind: z.literal("duplicate"), sources: z.array(operationLocation).min(1).max(5000) }),
  z.object({ kind: z.literal("trash"), sources: z.array(operationLocation).min(1).max(5000) }),
  z.object({ kind: z.enum(["undo", "redo", "status"]) }),
]);
