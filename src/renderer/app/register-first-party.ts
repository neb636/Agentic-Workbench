import { copyPath, terminalAt, revealFile, registerFileActionContributions } from "../features/files/file-actions";
import { services } from "../core/services";
import { useWorkbenchStore } from "../state/workbench-store";
import type { FileViewState } from "../../shared/models";
import { isFilesWorkspace } from "../../shared/files-workspace";
import { AgentView } from "../features/agent/AgentView";
import { AgentViewIcon } from "../features/agent/AgentViewIcon";
import { ClaudeCodeMark, CodexMark } from "../features/agent/harness-marks";
import { cliAgentProvider } from "../features/agent/cli-agent-provider";
import { closeAgentRuntime } from "../core/agent-runtimes";
import { closeTerminalRuntime } from "../core/terminal-runtimes";
import { fileBuffers, isViewDirty, setViewDirty } from "../core/dirty-views";
import { TerminalView } from "../features/terminal/TerminalView";
import { localTerminalProvider } from "../features/terminal/terminal-provider";
import { clearComposerRuntime, registerComposerContributions } from "../features/agent/composer-state";
import { registerSendSelection } from "../features/agent/send-selection";
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
import { CommitFileView } from "../features/source-control/CommitFileView";
import { registerSourceControlCommands } from "../features/source-control/source-control-commands";
import { ActiveViewsPanel } from "../features/views/ActiveViewsPanel";
import { SourceControlBadge, SourceControlPanel, StatusBranch, WorkspaceBranch } from "../features/source-control/SourceControlPanel";
import { SessionSummary } from "../features/status/StatusItems";
import { ResourceManager } from "../features/resources/ResourceManager";
import { SettingsButton } from "../features/settings/SettingsButton";
import { registerAiUsage } from "../features/ai-usage/register-ai-usage";
import { BranchIcon, CommitIcon, FileIcon, FilesIcon, LayersIcon, TerminalIcon } from "../ui/icons";

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
    id: "commit-file",
    label: "Commit file",
    description: "One file as a past commit changed it.",
    icon: CommitIcon,
    component: CommitFileView,
    creatable: false,
    isPreview: () => true,
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
      const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.id === view.workspaceId);
      // A file opened on its own has no workspace folder to show it in; its own folder can become one.
      const inFolder = workspace && !isFilesWorkspace(workspace)
        ? [{ id: "copy-relative-path", label: "Copy Relative Path", run: () => copyPath({ root, path }, true) },
          { id: "reveal", label: "Reveal in files", run: () => revealFile(workspace, { root, path }) }]
        : [{ id: "open-folder", label: "Open Folder as Workspace…", run: () => services.commands.execute("file.openFolderAsWorkspace", { viewId: view.id }) }];
      return [
        ...keep,
        ...inFolder,
        { id: "copy-path", label: "Copy Path", run: () => copyPath({ root, path }) },
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
  registerSendSelection();
  publishAgentStatuses();

  services.widgets.register({ id: "settings", slot: "sidebar.footer", order: 100, component: SettingsButton });
  services.widgets.register({ id: "workspace-branch", slot: "sidebar.workspace.meta", component: WorkspaceBranch });
  services.widgets.register({ id: "sessions", slot: "statusbar.start", order: 10, component: SessionSummary });
  services.widgets.register({ id: "branch", slot: "statusbar.end", order: 10, component: StatusBranch });
  services.widgets.register({ id: "resources", slot: "statusbar.end", order: 20, component: ResourceManager });
  registerAiUsage();

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
  services.contextMenus.register({ id: "workspace.actions", kind: "workspace", items: (context) => context.kind !== "workspace" ? [] : isFilesWorkspace(context.workspace) ? [
    { id: "remove", label: "Close All Files", destructive: true, section: "remove", run: () => services.commands.execute("workspace.remove", context.workspace.id) },
  ] : [
    ...services.views.list().filter((d) => d.creatable !== false).map((d) => ({ id: `new-${d.id}`, label: `New ${d.label}`, section: "create", run: () => services.commands.execute("view.create", { workspaceId: context.workspace.id, viewType: d.id }) })),
    ...[{ id: "reveal", label: "Reveal Folder", command: "workspace.reveal" }, { id: "terminal", label: "Open in Terminal", command: "workspace.terminal" }, { id: "copy", label: "Copy Path", command: "workspace.copyPath" }].map((item) => ({ ...item, section: "workspace", run: () => services.commands.execute(item.command, { workspaceId: context.workspace.id }) })),
    { id: "choose-icon", label: context.workspace.icon ? "Change Custom Icon…" : "Set Custom Icon…", section: "icon", run: () => services.commands.execute("workspace.chooseIcon", { workspaceId: context.workspace.id }) },
    ...(context.workspace.icon ? [{ id: "remove-icon", label: "Remove Custom Icon", section: "icon", run: () => services.commands.execute("workspace.removeIcon", { workspaceId: context.workspace.id }) }] : []),
    { id: "remove", label: "Remove Workspace", destructive: true, section: "remove", run: () => services.commands.execute("workspace.remove", context.workspace.id) },
  ] });
  registerFileActionContributions();
  registerFileCommands();
  registerSourceControlCommands();
  services.commands.register("workspace.add", async () => {
    const path = await window.workbench.workspace.chooseDirectory();
    if (path) useWorkbenchStore.getState().addWorkspace(path);
  });
  // A file opened on its own: its folder (or one above it) becomes a workspace, and the tab moves into it.
  services.commands.register<{ viewId: string }>("file.openFolderAsWorkspace", async ({ viewId }) => {
    const view = useWorkbenchStore.getState().workspaces.flatMap((w) => w.views).find((v) => v.id === viewId);
    const { root, path } = (view?.state ?? {}) as Partial<FileViewState>;
    if (!view || !root || !path) return;
    const folder = await window.workbench.workspace.chooseDirectory(root);
    if (!folder) return;
    const store = useWorkbenchStore.getState();
    const workspaceId = store.addWorkspace(folder);
    const base = folder.replace(/[\\/]+$/, "");
    const absolute = `${root}/${path}`;
    if (absolute.startsWith(`${base}/`)) store.transferView(viewId, workspaceId, { root: base, path: absolute.slice(base.length + 1), preview: false });
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
    const workspace = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId);
    if (workspace && isFilesWorkspace(workspace)) throw new Error("Files opened on their own have no folder for a session. Open the folder as a workspace first.");
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
    closeTerminalRuntime(viewId);
    clearComposerRuntime(viewId);
    useWorkbenchStore.getState().closeView(workspaceId, viewId);
    return true;
  });
}
