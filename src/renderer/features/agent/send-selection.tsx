import { create } from "zustand";
import type { AgentViewState, WorkbenchView, Workspace } from "../../../shared/models";
import type { TextSelection } from "../../core/context-menu-registry";
import { services } from "../../core/services";
import { useViewStatuses, viewStatus } from "../../core/view-status";
import { useWorkbenchStore } from "../../state/workbench-store";
import { NewChatIcon } from "../../ui/icons";
import { useDefaultHarness } from "./agent-models";
import { SessionMark } from "./SessionMark";
import { patchComposer } from "./composer-state";
import { isFilesWorkspace } from "../../../shared/files-workspace";

/** A composer to focus the next time it is drawn, with the caret after its text. */
export const useComposerFocus = create<{ viewId?: string }>(() => ({}));

/** The session code was last sent to: it heads the list, so ⌘L then Enter continues there. */
let lastTarget: string | undefined;

/** A fence longer than any run of backticks in the code, so the code can't close it. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

/**
 * `path:16-20` and the code. The path is relative when the session runs where the file is (or hasn't chosen a folder
 * yet; a new worktree has the same relative paths), otherwise absolute so the agent reads the copy that was selected.
 */
export function selectionReference(selection: TextSelection, cwd: string): string {
  const { root, path } = selection.location;
  const shown = cwd === root ? path : `${root.replace(/[\\/]$/, "")}/${path}`;
  const lines = selection.fromLine === selection.toLine ? `${selection.fromLine}` : `${selection.fromLine}-${selection.toLine}`;
  // A draft that starts with `/` or `!` is refused as a native command, so an absolute path is quoted rather than left bare.
  const location = /^[/!]/.test(shown) ? `\`${shown}:${lines}\`` : `${shown}:${lines}`;
  const code = selection.text.replace(/\s+$/, "");
  const extension = /\.([A-Za-z0-9+-]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  const marks = fence(code);
  return `${location}\n${marks}${extension}\n${code}\n${marks}\n`;
}

/** Adds the selection to a session's composer (a new session's, without `viewId`), then shows that composer ready to type in. */
export async function sendSelection(workspaceId: string, selection: TextSelection, viewId?: string): Promise<void> {
  const id = viewId ?? await services.commands.execute<string>("view.create", { workspaceId, viewType: "agent" });
  const store = useWorkbenchStore.getState();
  const workspace = store.workspaces.find((item) => item.id === workspaceId);
  const view = workspace?.views.find((item) => item.id === id);
  if (!workspace || !view) return;
  const state = (view.state ?? {}) as AgentViewState;
  const reference = selectionReference(selection, state.cwd ?? workspace.path);
  const draft = state.draft?.replace(/\s+$/, "");
  patchComposer({ workspaceId, viewId: id }, { draft: draft ? `${draft}\n\n${reference}` : reference });
  if (state.composerCollapsed) store.updateViewState(workspaceId, id, { composerCollapsed: false });
  lastTarget = id;
  useComposerFocus.setState({ viewId: id });
  await services.commands.execute("view.activate", { workspaceId, viewId: id });
}

function sessionsFor(workspace: Workspace): WorkbenchView[] {
  const sessions = workspace.views.filter((view) => view.type === "agent");
  const last = sessions.findIndex((view) => view.id === lastTarget);
  return last > 0 ? [sessions[last], ...sessions.slice(0, last), ...sessions.slice(last + 1)] : sessions;
}

/** Selected text in a file goes to an agent session's composer: an open one, or a new one. */
export function registerSendSelection(): void {
  services.contextMenus.register({ id: "agent.send-selection", kind: "selection", items: (context) => {
    if (context.kind !== "selection") return [];
    const { workspace, selection } = context;
    // A file opened on its own has no folder for a session to work in.
    if (isFilesWorkspace(workspace)) return [];
    const statuses = useViewStatuses.getState();
    const harness = services.sessions.get(useDefaultHarness.getState().id ?? "")?.label;
    return [
      ...sessionsFor(workspace).map((view) => {
        const status = viewStatus(view, statuses);
        return {
          id: `session:${view.id}`, label: view.title, section: "sessions", icon: <SessionMark view={view} />,
          detail: [view.id === lastTarget ? "Last used" : undefined, status?.label, status?.detail].filter(Boolean).join(" · "),
          run: () => sendSelection(workspace.id, selection, view.id),
        };
      }),
      { id: "new-session", label: "New session", section: "new", icon: <span className="send-target-mark is-new"><NewChatIcon size={15} /></span>,
        detail: harness ? `Start a ${harness} session with this code` : "Start a session with this code",
        run: () => sendSelection(workspace.id, selection) },
    ];
  } });
}
