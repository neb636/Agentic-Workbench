import { copyPath, terminalAt, revealFile, registerFileActionContributions } from "../features/files/file-actions";
import { services } from "../core/services";
import { useWorkbenchStore } from "../state/workbench-store";
import type { FileViewState } from "../../shared/models";
import { AgentView } from "../features/agent/AgentView";
import { AgentViewIcon } from "../features/agent/AgentViewIcon";
import { ClaudeCodeMark, CodexMark } from "../features/agent/harness-marks";
import { cliAgentProvider } from "../features/agent/cli-agent-provider";
import { closeAgentRuntime } from "../core/agent-runtimes";
import { fileBuffers, isViewDirty, setViewDirty } from "../core/dirty-views";
import { TerminalView } from "../features/terminal/TerminalView";
import { localTerminalProvider } from "../features/terminal/terminal-provider";
import { clearComposerRuntime, registerComposerContributions } from "../features/agent/composer-state";
import { agentIdleStatus, publishAgentStatuses } from "../features/agent/session-status";
import { agentCloseConfirmation } from "../features/agent/close-confirmation";
import { confirmDestructive } from "../ui/confirm";
import { workspaceRemoveConfirmation } from "../features/views/workspace-confirmation";
import { personaMenu } from "../features/personas/persona-menu";
import { instructionsMenu } from "../features/instructions/instructions-menu";
import { startRepoInstructions } from "../features/instructions/repo-instructions";
import { FileView } from "../features/files/FileView";
import { FilesPanel } from "../features/files/FilesPanel";
import { registerFileCommands } from "../features/files/file-commands";
import { ActiveViewsPanel } from "../features/views/ActiveViewsPanel";
import { SourceControlBadge, SourceControlPanel, StatusBranch, WorkspaceBranch } from "../features/source-control/SourceControlPanel";
import { MemoryUsage, SessionSummary, TerminalCount } from "../features/status/StatusItems";
import { SettingsButton } from "../features/settings/SettingsButton";
import { BranchIcon, FileIcon, FilesIcon, LayersIcon, TerminalIcon } from "../ui/icons";

let registered = false;

export function registerFirstPartyContributions(): void {
  if (registered) return;
  registered = true;

  services.views.register({
    id: "agent",
    label: "Agent session",
    description: "A native coding CLI with a prompt composer below it.",
    icon: AgentViewIcon,
    component: AgentView,
    defaultTitle: "Untitled",
    listInSidebar: true,
    idleStatus: agentIdleStatus,
    confirmClose: agentCloseConfirmation,
    onActivate: (view) => void services.commands.execute("agent.session.resume", { workspaceId: view.workspaceId, viewId: view.id }),
    createState: () => ({ autoTitle: true }),
  });
  services.views.register({
    id: "terminal",
    label: "Terminal",
    description: "A local PTY-backed terminal session.",
    icon: TerminalIcon,
    component: TerminalView,
    createState: () => ({ providerId: "terminal.local" }),
  });
  services.views.register({
    id: "file",
    label: "File",
    description: "A file from the workspace.",
    icon: FileIcon,
    component: FileView,
    creatable: false,
    isPreview: (view) => Boolean((view.state as FileViewState | undefined)?.preview),
    tabMenu: (view) => {
      const { root, path, preview } = (view.state ?? {}) as FileViewState;
      const keep = preview ? [{ id: "keep", label: "Keep open", run: () => useWorkbenchStore.getState().updateViewState(view.workspaceId, view.id, { preview: false }) }] : [];
      return [
        ...keep,
        { id: "copy-relative-path", label: "Copy Relative Path", run: () => copyPath({ root, path }, true) },
        { id: "copy-path", label: "Copy Path", run: () => copyPath({ root, path }) },
        { id: "reveal", label: "Reveal in files", run: () => { const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.id === view.workspaceId); if (workspace) revealFile(workspace, { root, path }); } },
        { id: "reveal-system", label: "Reveal in system file manager", run: () => window.workbench.files.reveal(root, path) },
      ];
    },
  });

  services.sessions.register(cliAgentProvider("claude.cli", "Claude Code", "Anthropic", ClaudeCodeMark));
  services.sessions.register(cliAgentProvider("codex.cli", "Codex", "OpenAI", CodexMark));
  services.sessions.register(localTerminalProvider);

  services.panels.register({ id: "views", label: "Active views", icon: LayersIcon, order: 10, component: ActiveViewsPanel });
  services.panels.register({ id: "files", label: "Files", icon: FilesIcon, order: 20, component: FilesPanel });
  services.panels.register({ id: "source-control", label: "Source control", icon: BranchIcon, order: 30, component: SourceControlPanel, badge: SourceControlBadge });

  services.promptMenus.register(personaMenu);
  services.promptMenus.register(instructionsMenu);
  startRepoInstructions();
  registerComposerContributions();
  publishAgentStatuses();

  services.widgets.register({ id: "settings", slot: "sidebar.footer", order: 100, component: SettingsButton });
  services.widgets.register({ id: "workspace-branch", slot: "sidebar.workspace.meta", component: WorkspaceBranch });
  services.widgets.register({ id: "sessions", slot: "statusbar.start", order: 10, component: SessionSummary });
  services.widgets.register({ id: "branch", slot: "statusbar.end", order: 10, component: StatusBranch });
  services.widgets.register({ id: "terminals", slot: "statusbar.end", order: 20, component: TerminalCount });
  services.widgets.register({ id: "memory", slot: "statusbar.end", order: 30, component: MemoryUsage });

  services.commands.register<{ workspaceId: string }>("workspace.reveal", ({ workspaceId }) => {
    const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.id === workspaceId);
    if (workspace) window.workbench.files.reveal(workspace.path, "");
  });
  services.commands.register<{ workspaceId: string }>("workspace.copyPath", async ({ workspaceId }) => {
    const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.id === workspaceId);
    if (workspace) await copyPath({ root: workspace.path, path: "" });
  });
  services.commands.register<{ workspaceId: string }>("workspace.terminal", async ({ workspaceId }) => {
    const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.id === workspaceId);
    if (workspace) await terminalAt(workspace, { root: workspace.path, path: "" });
  });
  services.commands.register<{ workspaceId: string }>("workspace.chooseIcon", async ({ workspaceId }) => {
    const icon = await window.workbench.workspace.chooseIcon();
    if (icon) useWorkbenchStore.getState().setWorkspaceIcon(workspaceId, icon);
  });
  services.commands.register<{ workspaceId: string }>("workspace.removeIcon", ({ workspaceId }) => {
    useWorkbenchStore.getState().setWorkspaceIcon(workspaceId, undefined);
  });
  services.contextMenus.register({ id: "workspace.actions", kind: "workspace", items: (context) => context.kind !== "workspace" ? [] : [
    ...services.views.list().filter((d) => d.creatable !== false).map((d) => ({ id: `new-${d.id}`, label: `New ${d.label}`, section: "create", run: () => services.commands.execute("view.create", { workspaceId: context.workspace.id, viewType: d.id }) })),
    ...[{ id: "reveal", label: "Reveal Folder", command: "workspace.reveal" }, { id: "terminal", label: "Open in Terminal", command: "workspace.terminal" }, { id: "copy", label: "Copy Path", command: "workspace.copyPath" }].map((item) => ({ ...item, section: "workspace", run: () => services.commands.execute(item.command, { workspaceId: context.workspace.id }) })),
    { id: "choose-icon", label: context.workspace.icon ? "Change Custom Icon…" : "Set Custom Icon…", section: "icon", run: () => services.commands.execute("workspace.chooseIcon", { workspaceId: context.workspace.id }) },
    ...(context.workspace.icon ? [{ id: "remove-icon", label: "Remove Custom Icon", section: "icon", run: () => services.commands.execute("workspace.removeIcon", { workspaceId: context.workspace.id }) }] : []),
    { id: "remove", label: "Remove Workspace", destructive: true, section: "remove", run: () => services.commands.execute("workspace.remove", context.workspace.id) },
  ] });
  registerFileActionContributions();
  registerFileCommands();
  services.commands.register("workspace.add", async () => {
    const path = await window.workbench.workspace.chooseDirectory();
    if (path) useWorkbenchStore.getState().addWorkspace(path);
  });
  services.commands.register<string>("workspace.select", (workspaceId) => {
    useWorkbenchStore.getState().selectWorkspace(workspaceId);
  });
  services.commands.register<string>("workspace.remove", async (workspaceId) => {
    const workspace = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId);
    if (!workspace || !await confirmDestructive(workspaceRemoveConfirmation(workspace))) return;
    for (const view of workspace.views) {
      // Already confirmed for the whole workspace; a tab kept open (unsaved edits the person chose not to lose) keeps the workspace too.
      if (!await services.commands.execute<boolean>("view.close", { workspaceId, viewId: view.id, confirmed: true })) return;
    }
    useWorkbenchStore.getState().removeWorkspace(workspaceId);
  });
  services.commands.register<{ workspaceId: string; viewType: string }>("view.create", ({ workspaceId, viewType }) => {
    const definition = services.views.get(viewType);
    if (!definition) throw new Error(`Unknown view type: ${viewType}`);
    return useWorkbenchStore.getState().createView(workspaceId, definition.id, definition.defaultTitle ?? definition.label, definition.createState?.());
  });
  services.commands.register<{ workspaceId: string; viewId: string }>("view.activate", ({ workspaceId, viewId }) => {
    useWorkbenchStore.getState().selectView(workspaceId, viewId);
    const view = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId)?.views.find((item) => item.id === viewId);
    if (view) services.views.get(view.type)?.onActivate?.(view);
  });
  /** `confirmed`: the person already agreed to lose this view (removing its workspace), so its own question is skipped. */
  services.commands.register<{ workspaceId: string; viewId: string; confirmed?: boolean }>("view.close", async ({ workspaceId, viewId, confirmed }) => {
    const view = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId)?.views.find((item) => item.id === viewId);
    const confirmation = !confirmed && view ? services.views.get(view.type)?.confirmClose?.(view) : undefined;
    if (confirmation && !await confirmDestructive(confirmation)) return false;
    if (isViewDirty(viewId) && !window.confirm(`${view?.title ?? "This tab"} has unsaved changes. Close it and lose them?`)) return false;
    setViewDirty(viewId, false);
    fileBuffers.delete(viewId);
    closeAgentRuntime(viewId);
    clearComposerRuntime(viewId);
    useWorkbenchStore.getState().closeView(workspaceId, viewId);
    return true;
  });
}
