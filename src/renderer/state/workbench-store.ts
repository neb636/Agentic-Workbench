import { create } from "zustand";
import type {
  LayoutState,
  PersistedState,
  Persona,
  StoredPromptOption,
  WorkbenchView,
  Workspace,
} from "../../shared/models";
import { createId } from "../core/id";

interface WorkbenchStore extends PersistedState {
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setRepoRoot: (path: string | undefined) => void;
  /** Opens (or selects) the views for one piece of work. The main checkout opens on its game. */
  addWorkspace: (path: string, options?: { name?: string; views?: "all" | "agent" }) => string;
  removeWorkspace: (workspaceId: string) => void;
  selectWorkspace: (workspaceId: string) => void;
  createView: (workspaceId: string, type: string, title: string, state?: unknown) => string;
  selectView: (workspaceId: string, viewId: string) => void;
  closeView: (workspaceId: string, viewId: string) => void;
  renameView: (workspaceId: string, viewId: string, title: string) => void;
  /** Moves a tab to just before another (or to the end). */
  moveView: (workspaceId: string, viewId: string, beforeViewId: string | undefined) => void;
  updateViewState: (workspaceId: string, viewId: string, patch: Record<string, unknown>) => void;
  upsertPersona: (persona: Persona) => void;
  deletePersona: (personaId: string) => void;
  upsertInstructionOption: (option: StoredPromptOption) => void;
  deleteInstructionOption: (optionId: string) => void;
  updateLayout: (patch: Partial<LayoutState>) => void;
}

const initialState: PersistedState = {
  workspaces: [],
  personas: [],
  instructionOptions: [],
  layout: { leftCollapsed: false, rightCollapsed: false },
};

function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function mapWorkspace(workspaces: Workspace[], workspaceId: string, update: (workspace: Workspace) => Workspace): Workspace[] {
  return workspaces.map((workspace) => (workspace.id === workspaceId ? update(workspace) : workspace));
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  ...initialState,
  isHydrated: false,
  hydrate: async () => {
    const persisted = await window.workbench.persistence.load();
    set({ ...persisted, isHydrated: true });
    // Source-run Studio opens its own checkout; the app reopens the repo it opened last time.
    const launched = await window.workbench.studio.repoRoot();
    const candidate = launched ?? persisted.repoRoot ?? persisted.workspaces[0]?.path;
    if (!candidate) return;
    try {
      const { repoRoot } = await window.workbench.work.list(candidate);
      get().setRepoRoot(repoRoot);
      const active = get().workspaces.find((workspace) => workspace.id === get().activeWorkspaceId);
      // Source-run Studio serves only the checkout it was launched from (maybe a worktree), so open that one.
      const initial = launched ?? repoRoot;
      if (!active) get().addWorkspace(initial, { name: initial === repoRoot ? "main" : workspaceName(initial), views: "all" });
    } catch (error) {
      // A moved or deleted checkout: forget it so the sidebar offers the repo chooser again.
      console.warn("Could not open the Gamepack repo", String(error));
      set({ repoRoot: undefined });
    }
  },
  setRepoRoot: (repoRoot) => set({ repoRoot }),
  addWorkspace: (path, options = {}) => {
    const existing = get().workspaces.find((workspace) => workspace.path === path);
    if (existing) {
      set({ activeWorkspaceId: existing.id });
      return existing.id;
    }
    const labs = (options.views ?? "all") === "all";
    const workspaceId = createId("workspace");
    const initialView: WorkbenchView = {
      id: createId("view"),
      type: "agent",
      workspaceId,
      title: "Untitled",
      // Its CLI starts as soon as it's shown: opening a piece of work is ready to type.
      state: { autoTitle: true, autoStart: true },
    };
    const workspace: Workspace = {
      id: workspaceId,
      name: options.name ?? workspaceName(path),
      path,
      // The labs are switches on the game pane now; the main checkout also gets Character concepts.
      views: [initialView, ...(labs ? [{ id: createId("view"), type: "image-generator", title: "Character concepts", workspaceId, state: { count: 1, autoTitle: false } }] : [])],
      activeViewId: initialView.id,
    };
    set((state) => ({
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: workspaceId,
    }));
    return workspaceId;
  },
  removeWorkspace: (workspaceId) =>
    set((state) => {
      const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
      return {
        workspaces,
        activeWorkspaceId: state.activeWorkspaceId === workspaceId ? workspaces[0]?.id : state.activeWorkspaceId,
      };
    }),
  selectWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),
  updateViewState: (workspaceId, viewId, patch) => set((state) => ({
    workspaces: mapWorkspace(state.workspaces, workspaceId, (workspace) => ({
      ...workspace, views: workspace.views.map((view) => view.id !== viewId ? view : {
        ...view, state: { ...(typeof view.state === "object" && view.state !== null ? view.state : {}), ...patch },
      }),
    })),
  })),
  createView: (workspaceId, type, title, viewState) => {
    const viewId = createId("view");
    set((state) => ({
      workspaces: mapWorkspace(state.workspaces, workspaceId, (workspace) => ({
        ...workspace,
        views: [...workspace.views, { id: viewId, type, workspaceId, title, state: viewState }],
        activeViewId: viewId,
      })),
    }));
    return viewId;
  },
  selectView: (workspaceId, viewId) =>
    set((state) => ({
      activeWorkspaceId: workspaceId,
      workspaces: mapWorkspace(state.workspaces, workspaceId, (workspace) => ({ ...workspace, activeViewId: viewId })),
    })),
  closeView: (workspaceId, viewId) =>
    set((state) => ({
      workspaces: mapWorkspace(state.workspaces, workspaceId, (workspace) => {
        const index = workspace.views.findIndex((view) => view.id === viewId);
        const views = workspace.views.filter((view) => view.id !== viewId);
        const replacement = views[Math.min(Math.max(index, 0), views.length - 1)];
        return {
          ...workspace,
          views,
          activeViewId: workspace.activeViewId === viewId ? replacement?.id : workspace.activeViewId,
        };
      }),
    })),
  moveView: (workspaceId, viewId, beforeViewId) =>
    set((state) => ({
      workspaces: mapWorkspace(state.workspaces, workspaceId, (workspace) => {
        const moving = workspace.views.find((view) => view.id === viewId);
        if (!moving || viewId === beforeViewId) return workspace;
        const rest = workspace.views.filter((view) => view.id !== viewId);
        const at = beforeViewId ? rest.findIndex((view) => view.id === beforeViewId) : -1;
        return { ...workspace, views: at < 0 ? [...rest, moving] : [...rest.slice(0, at), moving, ...rest.slice(at)] };
      }),
    })),
  renameView: (workspaceId, viewId, title) =>
    set((state) => ({
      workspaces: mapWorkspace(state.workspaces, workspaceId, (workspace) => ({
        ...workspace, views: workspace.views.map((view) => (view.id === viewId ? { ...view, title } : view)),
      })),
    })),
  upsertPersona: (persona) =>
    set((state) => {
      const exists = state.personas.some((item) => item.id === persona.id);
      return { personas: exists ? state.personas.map((item) => (item.id === persona.id ? persona : item)) : [...state.personas, persona] };
    }),
  deletePersona: (personaId) =>
    set((state) => ({ personas: state.personas.filter((persona) => persona.id !== personaId) })),
  upsertInstructionOption: (stored) =>
    set((state) => {
      const exists = state.instructionOptions.some((item) => item.option.id === stored.option.id);
      return {
        instructionOptions: exists
          ? state.instructionOptions.map((item) => (item.option.id === stored.option.id ? stored : item))
          : [...state.instructionOptions, stored],
      };
    }),
  deleteInstructionOption: (optionId) =>
    set((state) => ({ instructionOptions: state.instructionOptions.filter((item) => item.option.id !== optionId) })),
  updateLayout: (patch) => set((state) => ({ layout: { ...state.layout, ...patch } })),
}));

function persistedSnapshot(state: WorkbenchStore): PersistedState {
  return {
    repoRoot: state.repoRoot,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    personas: state.personas,
    instructionOptions: state.instructionOptions,
    layout: state.layout,
  };
}

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
useWorkbenchStore.subscribe((state) => {
  if (!state.isHydrated) return;
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    void window.workbench.persistence.save(persistedSnapshot(useWorkbenchStore.getState()));
  }, 180);
});
