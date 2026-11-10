import { choice, select } from "../../../shared/prompt-options";
import type { PromptMenuDefinition } from "../../core/prompt-menu-registry";
import { useWorkbenchStore } from "../../state/workbench-store";
import { UserIcon } from "../../ui/icons";
import { PersonaManager } from "./PersonaManager";

export const personaMenu: PromptMenuDefinition = {
  id: "persona",
  label: "Persona",
  description: "Applies to your next prompt",
  icon: UserIcon,
  order: 10,
  kind: "persona",
  placement: "prepend",
  resetAfterSend: true,
  subscribe: (listener) => useWorkbenchStore.subscribe((state, previous) => { if (state.personas !== previous.personas) listener(); }),
  options: ({ workspaceId }) => {
    const personas = useWorkbenchStore.getState().personas.filter((p) => p.scope === "global" || p.workspaceId === workspaceId);
    return [select("active-persona", {
      label: "Persona",
      display: "list",
      default: "none",
      choices: [
        choice("none", "No persona", "", "Send the prompt as written."),
        ...personas.map((persona) => choice(persona.id, persona.name, persona.instructions, persona.description || undefined)),
      ],
    })];
  },
  manage: { title: "Manage personas", description: "Create reusable roles that shape how the agent approaches a prompt.", component: PersonaManager },
};
