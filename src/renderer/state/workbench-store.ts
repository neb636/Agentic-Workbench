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
  addWorkspace: (path: string) => string;
  removeWorkspace: (workspaceId: string) => void;
  selectWorkspace: (workspaceId: string) => void;
  createView: (workspaceId: string, type: string, title: string, state?: unknown) => string;
  selectView: (workspaceId: string, viewId: string) => void;
  closeView: (workspaceId: string, viewId: string) => void;
  /** Moves a tab before another one (or to the end). */
  moveView: (workspaceId: string, viewId: string, beforeViewId: string | undefined) => void;
  renameView: (workspaceId: string, viewId: string, title: string) => void;
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
  },
  addWorkspace: (path) => {
    const existing = get().workspaces.find((workspace) => workspace.path === path);
    if (existing) {
      set({ activeWorkspaceId: existing.id });
      return existing.id;
    }
    const workspaceId = createId("workspace");
    const initialView: WorkbenchView = {
      id: createId("view"),
      type: "agent",
      workspaceId,
      title: "Untitled",
      state: { autoTitle: true },
    };
    const workspace: Workspace = {
      id: workspaceId,
      name: workspaceName(path),
      path,
      views: [initialView],
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
