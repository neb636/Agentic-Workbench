import { services } from "../core/services";
import { useWorkbenchStore } from "../state/workbench-store";
import { AgentView } from "../features/agent/AgentView";
import { cliAgentProvider } from "../features/agent/cli-agent-provider";
import { closeAgentRuntime } from "../core/agent-runtimes";
import { TerminalView } from "../features/terminal/TerminalView";
import { localTerminalProvider } from "../features/terminal/terminal-provider";
import { clearComposerRuntime, registerComposerContributions } from "../features/agent/composer-state";
import { agentIdleStatus, publishAgentStatuses } from "../features/agent/session-status";
import { instructionsMenu } from "../features/instructions/instructions-menu";
import { FileView } from "../features/files/FileView";
import { ImageGeneratorView } from "../features/image-generator/ImageGeneratorView";
import { clearImageRuntime, DEFAULT_COUNT, DEFAULT_PROVIDER, registerImageGeneratorCommands } from "../features/image-generator/image-generator-state";
import { registerFileCommands } from "../features/files/file-commands";
import { StatusBranch } from "../features/source-control/SourceControlPanel";
import { currentLink, GAME_TABS, openGameTab } from "../features/game/game-store";
import { openExplorer } from "../features/explorer/explorer-store";
import { fileBuffers, isViewDirty, setViewDirty } from "../core/dirty-views";
import type { AgentViewState, FileViewState } from "../../shared/models";
import { MemoryUsage, SessionSummary, TerminalCount } from "../features/status/StatusItems";
import { SettingsButton } from "../features/settings/SettingsButton";
import { AgentIcon, FileIcon, GameIcon, ImageIcon, TerminalIcon } from "../ui/icons";
import { useWorkList } from "../features/work/work-store";
import { newAgent } from "../features/agent/new-agent";
import { StudioComposerTools } from "../features/agent/StudioComposerTools";
import { watchAttention } from "../features/agent/attention";

let registered = false;


export function registerFirstPartyContributions(): void {
  if (registered) return;
  registered = true;

  services.views.register({
    id: "agent",
    label: "Agent session",
    description: "A native coding CLI with a prompt composer below it.",
    icon: AgentIcon,
    component: AgentView,
    defaultTitle: "Untitled",
    listInSidebar: true,
    idleStatus: agentIdleStatus,
    createState: () => ({ autoTitle: true, autoStart: true }),
    // New agent tabs start their CLI at once; resuming an older session is here too.
    menuItems: [
      { id: "claude", label: "Claude Code", description: "A new Claude Code session, ready to type.", open: (workspaceId) => newAgent(workspaceId, "claude.cli") },
      { id: "codex", label: "Codex", description: "A new Codex session, ready to type.", open: (workspaceId) => newAgent(workspaceId, "codex.cli") },
      { id: "resume", label: "Resume a previous session…", description: "The last-used CLI's own list of earlier sessions here.", open: (workspaceId) => newAgent(workspaceId, undefined, true) },
    ],
    tabMenu: (view) => ["claude.cli", "codex.cli"].filter((id) => (view.state as AgentViewState | undefined)?.providerId !== id).map((id) => ({
      id: `restart-${id}`, label: `Switch to ${services.sessions.get(id)?.label ?? id}`,
      run: () => {
        if (!window.confirm(`Stop this session and start ${services.sessions.get(id)?.label ?? id} in its place?`)) return;
        void services.commands.execute("agent.session.reset", { workspaceId: view.workspaceId, viewId: view.id });
        useWorkbenchStore.getState().updateViewState(view.workspaceId, view.id, { providerId: id, autoStart: true });
      },
    })),
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
    id: "image-generator",
    label: "Character concepts",
    description: "One vinyl character concept at a time, ready for the Tripo and Blender workflow.",
    icon: ImageIcon,
    component: ImageGeneratorView,
    defaultTitle: "Character concepts",
    listInSidebar: true,
    idleStatus: () => ({ label: "Idle", tone: "idle", detail: "Images" }),
    createState: () => ({ providerId: DEFAULT_PROVIDER, count: DEFAULT_COUNT, autoTitle: true }),
  });
  services.views.register({
    id: "file",
    label: "File",
    description: "A file from this checkout, to read, edit and diff.",
    icon: FileIcon,
    component: FileView,
    creatable: false,
    isPreview: (view) => Boolean((view.state as FileViewState | undefined)?.preview),
    tabMenu: (view) => {
      const state = view.state as FileViewState | undefined;
      if (!state) return [];
      return [
        { id: "copy-path", label: "Copy path", run: () => void window.workbench.studio.copyText(state.path) },
        { id: "reveal", label: "Reveal in Finder", run: () => window.workbench.files.reveal(state.root, state.path) },
        { id: "show", label: "Show in Files", run: () => openExplorer("files") },
      ];
    },
  });
  // The game and its labs: one tab type, one running game per piece of work, a + menu entry for each.
  services.views.register({
    id: "game",
    label: "Game",
    description: "The real game for this piece of work.",
    icon: GameIcon,
    component: () => null,
    defaultTitle: "Game",
    menuItems: GAME_TABS.map((tab) => ({ id: tab.lab ?? "play", label: `${tab.emoji} ${tab.label}`, description: tab.description, open: (workspaceId: string) => void openGameTab(workspaceId, tab.lab) })),
    tabMenu: (view) => [{ id: "copy-link", label: "Copy game link", run: () => void window.workbench.studio.copyText(currentLink(view.workspaceId)) }],
  });

  services.sessions.register(cliAgentProvider("claude.cli", "Claude Code", "Anthropic"));
  services.sessions.register(cliAgentProvider("codex.cli", "Codex", "OpenAI"));
  services.sessions.register(localTerminalProvider);

  // Files, Changes, Sections and Ship live in the explorer on the right.
  services.widgets.register({ id: "studio-tools", slot: "agent.composer.toolbar", order: 10, component: StudioComposerTools });
  watchAttention();

  services.promptMenus.register(instructionsMenu);
  registerComposerContributions();
  registerImageGeneratorCommands();
  publishAgentStatuses();

  services.widgets.register({ id: "settings", slot: "sidebar.footer", order: 100, component: SettingsButton });
  services.widgets.register({ id: "sessions", slot: "statusbar.start", order: 10, component: SessionSummary });
  services.widgets.register({ id: "branch", slot: "statusbar.end", order: 10, component: StatusBranch });
  services.widgets.register({ id: "terminals", slot: "statusbar.end", order: 20, component: TerminalCount });
  services.widgets.register({ id: "memory", slot: "statusbar.end", order: 30, component: MemoryUsage });

  registerFileCommands();
  // One repo: Studio finds its worktrees itself (the packaged app asks for the checkout once).
  services.commands.register("repo.open", async () => {
    const path = await window.workbench.workspace.chooseDirectory();
    if (!path) return;
    const { repoRoot } = await window.workbench.work.list(path);
    useWorkbenchStore.getState().setRepoRoot(repoRoot);
    useWorkbenchStore.getState().addWorkspace(repoRoot, { name: "main", views: "all" });
    await useWorkList.getState().refresh(true);
  });
  services.commands.register<string>("workspace.select", (workspaceId) => {
    useWorkbenchStore.getState().selectWorkspace(workspaceId);
  });
  services.commands.register<string>("workspace.remove", async (workspaceId) => {
    const workspace = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId);
    for (const view of workspace?.views ?? []) await services.commands.execute("view.close", { workspaceId, viewId: view.id });
    useWorkbenchStore.getState().removeWorkspace(workspaceId);
  });
  services.commands.register<{ workspaceId: string; viewType: string }>("view.create", ({ workspaceId, viewType }) => {
    const definition = services.views.get(viewType);
    if (!definition) throw new Error(`Unknown view type: ${viewType}`);
    // One Game tab per lab: bring the one that's there forward.
    if (viewType === "game") return openGameTab(workspaceId);
    return useWorkbenchStore.getState().createView(workspaceId, definition.id, definition.defaultTitle ?? definition.label, definition.createState?.());
  });
  services.commands.register<{ workspaceId: string; viewId: string }>("view.select", ({ workspaceId, viewId }) => {
    useWorkbenchStore.getState().selectView(workspaceId, viewId);
  });
  services.commands.register<{ workspaceId: string; viewId: string }>("view.close", ({ workspaceId, viewId }) => {
    const view = useWorkbenchStore.getState().workspaces.find((item) => item.id === workspaceId)?.views.find((item) => item.id === viewId);
    if (view && isViewDirty(viewId) && !window.confirm(`${view.title} has unsaved changes. Close it and lose them?`)) return;
    setViewDirty(viewId, false);
    fileBuffers.delete(viewId);
    closeAgentRuntime(viewId);
    clearComposerRuntime(viewId);
    clearImageRuntime(viewId);
    useWorkbenchStore.getState().closeView(workspaceId, viewId);
  });
}
