import { activeInstructions, layerInstructions, type LayeredInstruction } from "../../../shared/instruction-layers";
import type { Workspace } from "../../../shared/models";
import type { PromptMenuDefinition } from "../../core/prompt-menu-registry";
import { useWorkbenchStore } from "../../state/workbench-store";
import { ListChecksIcon } from "../../ui/icons";
import { layerCopy } from "./layer-copy";
import { InstructionsManager } from "./InstructionsManager";
import { sharedOptionsOf, useRepoInstructions } from "./repo-instructions";

/** Every instruction for a workspace, with its layer and whether it is on there. */
export function workspaceInstructions(workspaceId: string): LayeredInstruction[] {
  const state = useWorkbenchStore.getState();
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  return layerInstructions({
    stored: state.instructionOptions,
    shared: sharedOptionsOf(workspace?.path),
    workspaceId,
    disabledIds: workspace?.disabledInstructionIds ?? [],
  });
}

export const instructionsMenu: PromptMenuDefinition = {
  id: "instructions",
  label: "Instructions",
  description: "Added to the end of your prompt",
  icon: ListChecksIcon,
  order: 20,
  kind: "instruction",
  placement: "append",
  resetAfterSend: false,
  options: ({ workspaceId }) => activeInstructions(workspaceInstructions(workspaceId)).map((item) => item.option),
  subscribe: (listener) => {
    // Drafts change workspaces on every keystroke; only paths and turned-off ids matter here.
    const layersKey = (workspaces: Workspace[]) => workspaces.map((w) => `${w.id}\0${w.path}\0${(w.disabledInstructionIds ?? []).join()}`).join("\n");
    const offStore = useWorkbenchStore.subscribe((state, previous) => {
      if (state.instructionOptions !== previous.instructionOptions
        || (state.workspaces !== previous.workspaces && layersKey(state.workspaces) !== layersKey(previous.workspaces))) listener();
    });
    const offRepo = useRepoInstructions.subscribe(listener);
    return () => { offStore(); offRepo(); };
  },
  // Everywhere is the usual case, so only the other layers are marked.
  optionTag: (optionId, { workspaceId }) => {
    const item = activeInstructions(workspaceInstructions(workspaceId)).find((entry) => entry.option.id === optionId);
    if (!item || item.layer === "global") return undefined;
    const workspace = useWorkbenchStore.getState().workspaces.find((entry) => entry.id === workspaceId);
    return { label: layerCopy[item.layer].title(workspace?.name ?? "this repo"), icon: layerCopy[item.layer].icon };
  },
  manage: { title: "Manage instructions", description: "Reusable instructions added after your prompt.", component: InstructionsManager },
};
