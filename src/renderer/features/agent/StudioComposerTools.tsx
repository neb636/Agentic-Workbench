import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import type { AgentViewState } from "../../../shared/models";
import type { WidgetProps } from "../../core/widget-registry";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { ChevronDownIcon, PaperclipIcon } from "../../ui/icons";
import { patchComposer } from "./composer-state";
import { sectionContext, STARTERS } from "./studio-context";

/** Attaches the game section on screen (link, params, lab snapshot) to this agent's next prompt. */
export function attachSection(workspaceId: string, viewId: string): void {
  const workspace = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return;
  void services.commands.execute("agent.composer.attach", { workspaceId, viewId, ...sectionContext(workspace) });
}

/** 📎 this section and the prompt starters, in the composer toolbar of every agent. */
export function StudioComposerTools({ workspaceId, viewId }: WidgetProps) {
  if (!workspaceId || !viewId) return null;
  const start = (id: string) => {
    const workspace = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId);
    const starter = STARTERS.find((item) => item.id === id);
    if (!workspace || !starter) return;
    const state = workspace.views.find((view) => view.id === viewId)?.state as AgentViewState | undefined;
    const draft = state?.draft?.trim();
    patchComposer({ workspaceId, viewId }, { draft: `${starter.text(workspace)}${draft ? `${draft}` : ""}`, quotations: state?.quotations ?? [], intent: state?.intent ?? "default" });
    // A fix or a bake is about the moment on screen.
    if (id === "fix" || id === "bake") attachSection(workspaceId, viewId);
  };
  return <>
    <AriaButton className="composer-chip" aria-label="Attach this game section" onPress={() => attachSection(workspaceId, viewId)}>
      <PaperclipIcon size={13} />Section
    </AriaButton>
    <MenuTrigger>
      <AriaButton className="composer-chip" aria-label="Prompt starters">Starters<ChevronDownIcon size={12} /></AriaButton>
      <Popover className="wb-popover" placement="top end">
        <Menu aria-label="Prompt starters" onAction={(key) => start(String(key))}>
          {STARTERS.map((starter) => <MenuItem key={starter.id} id={starter.id} textValue={starter.label}>
            <div><span>{starter.label}</span><small>{starter.description}</small></div>
          </MenuItem>)}
        </Menu>
      </Popover>
    </MenuTrigger>
  </>;
}
