import { INSTRUCTION_FILES, type InstructionLayer } from "../../../shared/instruction-layers";
import type { ConfigLayers, ConfigScope } from "../../../shared/dimsum";
import type { StoredPromptOption } from "../../../shared/models";
import type { PromptOptionDefinition } from "../../../shared/prompt-options";
import { layersOf, loadConfig, saveConfig, useConfigLayers } from "../../core/config-layers";
import { useWorkbenchStore } from "../../state/workbench-store";
import { isFilesWorkspace } from "../../../shared/files-workspace";

/** One instructions file as last read from disk. */
export type InstructionsFile =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ok"; options: PromptOptionDefinition[] }
  | { status: "invalid"; error: string };

export interface InstructionFiles {
  global: InstructionsFile;
  shared: InstructionsFile;
  personal: InstructionsFile;
  /** The shared layer still comes from `.workbench/instructions.json`; the next save moves it to `.dimsum/`. */
  legacyShared: boolean;
}

const SCOPES: Record<InstructionLayer, ConfigScope> = { global: "user", shared: "workspace", personal: "local" };

function fileOf(layers: ConfigLayers | undefined, scope: ConfigScope): InstructionsFile {
  if (!layers) return { status: "loading" };
  const document = layers[scope];
  if (!document) return { status: "missing" };
  if (document.status === "invalid") return { status: "invalid", error: document.error };
  return { status: "ok", options: (document.value as { instructions: PromptOptionDefinition[] }).instructions };
}

function filesFrom(layers: ConfigLayers | undefined): InstructionFiles {
  return { global: fileOf(layers, "user"), shared: fileOf(layers, "workspace"), personal: fileOf(layers, "local"), legacyShared: Boolean(layers?.legacyWorkspace) };
}

/** The instruction files that apply to a workspace folder (only the person's own without one). */
export function instructionFilesOf(root: string | undefined): InstructionFiles {
  return filesFrom(layersOf("instructions", root || undefined));
}

export function useInstructionFiles(root: string | undefined): InstructionFiles {
  const key = `instructions\0${root ?? ""}`;
  const layers = useConfigLayers((state) => state[key]);
  if (!layers) layersOf("instructions", root || undefined);
  return filesFrom(layers);
}

const optionsOf = (file: InstructionsFile) => (file.status === "ok" ? file.options : []);

/** The person's own instructions for this workspace (everywhere, then only here), in the shape layering expects. */
export function storedOptionsOf(files: InstructionFiles, workspaceId: string): StoredPromptOption[] {
  return [
    ...optionsOf(files.global).map((option) => ({ scope: "global" as const, option })),
    ...optionsOf(files.personal).map((option) => ({ scope: "workspace" as const, workspaceId, option })),
  ];
}

/** The shared options the composer offers; nothing while the file is missing, loading, or unreadable. */
export function sharedOptionsOf(root: string | undefined): PromptOptionDefinition[] {
  return optionsOf(instructionFilesOf(root).shared);
}

/** Where a layer's instructions are saved, for messages. */
export function instructionsPath(layer: InstructionLayer): string {
  return INSTRUCTION_FILES[layer];
}

/** Rewrites one layer's file with `update` applied to its current options (see `saveConfig`). */
export function saveInstructions(layer: InstructionLayer, root: string, update: (options: PromptOptionDefinition[]) => PromptOptionDefinition[]): Promise<string | undefined> {
  return saveConfig<{ version: 1; instructions: PromptOptionDefinition[] }>("instructions", SCOPES[layer], root || undefined,
    (current) => ({ version: 1, instructions: update(current?.instructions ?? []) }));
}

/** Keeps every workspace's instructions loaded and current, so prompts include them before Manage opens. */
export function startRepoInstructions(): () => void {
  const roots = () => [...new Set(useWorkbenchStore.getState().workspaces.filter((workspace) => !isFilesWorkspace(workspace)).map((workspace) => workspace.path))];
  let last = "";
  const onChange = () => {
    if (!useWorkbenchStore.getState().isHydrated) return;
    const current = roots();
    const key = current.join("\0");
    if (key === last) return;
    last = key;
    void loadConfig("instructions");
    for (const root of current) layersOf("instructions", root);
  };
  onChange();
  return useWorkbenchStore.subscribe(onChange);
}
