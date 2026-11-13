import { create } from "zustand";
import type {
  LayoutState,
  PersistedState,
  Persona,
  WorkbenchView,
  Workspace,
} from "../../shared/models";
import { FILES_WORKSPACE_ID, isFilesWorkspace } from "../../shared/files-workspace";
import { createId } from "../core/id";

interface WorkbenchStore extends PersistedState {
  isHydrated: boolean;
  persistenceError?: string;
  hydrate: () => Promise<void>;
  addWorkspace: (path: string) => string;
  /** The built-in Files workspace (files opened from outside every workspace), created the first time it's needed. */
  ensureFilesWorkspace: () => string;
  /** Moves a view to another workspace, as its active tab. */
  transferView: (viewId: string, toWorkspaceId: string, patch?: Record<string, unknown>) => void;
  removeWorkspace: (workspaceId: string) => void;
  selectWorkspace: (workspaceId: string) => void;
  setWorkspaceIcon: (workspaceId: string, icon: string | undefined) => void;
  createView: (workspaceId: string, type: string, title: string, state?: unknown) => string;
  selectView: (workspaceId: string, viewId: string) => void;
  closeView: (workspaceId: string, viewId: string) => void;
  /** Moves a tab before another one (or to the end). */
  moveView: (workspaceId: string, viewId: string, beforeViewId: string | undefined) => void;
  renameView: (workspaceId: string, viewId: string, title: string) => void;
  updateViewState: (workspaceId: string, viewId: string, patch: Record<string, unknown>) => void;
  upsertPersona: (persona: Persona) => void;
  deletePersona: (personaId: string) => void;
  /** The instruction is gone: forget every workspace where it was turned off. */
  forgetInstructionSettings: (optionId: string) => void;
  /** Turns a global or shared instruction off (or back on) in one workspace only. */
  setInstructionDisabled: (workspaceId: string, optionId: string, disabled: boolean) => void;
  updateLayout: (patch: Partial<LayoutState>) => void;
  setDefaultAgentProvider: (providerId: string) => void;
  /** Replaces one feature's settings; the feature owns their shape. */
  setFeatureSettings: (featureId: string, settings: unknown) => void;
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

/** The Files workspace exists only while it holds a file: closing its last tab removes it from the sidebar. */
function dropEmptyFiles(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((workspace) => !isFilesWorkspace(workspace) || workspace.views.length > 0);
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
    const existing = get().workspaces.find((workspace) => !isFilesWorkspace(workspace) && workspace.path === path);
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
  ensureFilesWorkspace: () => {
    if (get().workspaces.some((workspace) => workspace.id === FILES_WORKSPACE_ID)) return FILES_WORKSPACE_ID;
    const workspace: Workspace = { id: FILES_WORKSPACE_ID, kind: "files", name: "Files", path: "", views: [] };
    set((state) => ({ workspaces: [...state.workspaces, workspace] }));
    return FILES_WORKSPACE_ID;
  },
  transferView: (viewId, toWorkspaceId, patch) =>
    set((state) => {
      const from = state.workspaces.find((workspace) => workspace.views.some((view) => view.id === viewId));
      const moving = from?.views.find((view) => view.id === viewId);
      if (!from || !moving || from.id === toWorkspaceId) return {};
      const moved: WorkbenchView = { ...moving, workspaceId: toWorkspaceId, state: patch ? { ...(moving.state as object | undefined), ...patch } : moving.state };
      const workspaces = state.workspaces.map((workspace) => {
        if (workspace.id === from.id) {
          const views = workspace.views.filter((view) => view.id !== viewId);
          return { ...workspace, views, activeViewId: workspace.activeViewId === viewId ? views.at(-1)?.id : workspace.activeViewId };
        }
        return workspace.id === toWorkspaceId ? { ...workspace, views: [...workspace.views, moved], activeViewId: viewId } : workspace;
      });
      return { workspaces: dropEmptyFiles(workspaces), activeWorkspaceId: toWorkspaceId };
    }),
  removeWorkspace: (workspaceId) =>
    set((state) => {
      const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
      return {
        workspaces,
        activeWorkspaceId: state.activeWorkspaceId === workspaceId ? workspaces[0]?.id : state.activeWorkspaceId,
      };
    }),
  selectWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),
  setWorkspaceIcon: (workspaceId, icon) => set((state) => ({
    workspaces: mapWorkspace(state.workspaces, workspaceId, (workspace) => ({ ...workspace, icon })),
  })),
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
    set((state) => {
      const workspaces = dropEmptyFiles(mapWorkspace(state.workspaces, workspaceId, (workspace) => {
        const index = workspace.views.findIndex((view) => view.id === viewId);
        const views = workspace.views.filter((view) => view.id !== viewId);
        const replacement = views[Math.min(Math.max(index, 0), views.length - 1)];
        return {
          ...workspace,
          views,
          activeViewId: workspace.activeViewId === viewId ? replacement?.id : workspace.activeViewId,
        };
      }));
      const active = workspaces.some((workspace) => workspace.id === state.activeWorkspaceId) ? state.activeWorkspaceId : workspaces[0]?.id;
      return { workspaces, activeWorkspaceId: active };
    }),
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
  forgetInstructionSettings: (optionId) =>
    set((state) => ({
      workspaces: state.workspaces.map((workspace) => workspace.disabledInstructionIds?.includes(optionId)
        ? { ...workspace, disabledInstructionIds: workspace.disabledInstructionIds.filter((id) => id !== optionId) }
        : workspace),
    })),
  setInstructionDisabled: (workspaceId, optionId, disabled) =>
    set((state) => ({
      workspaces: mapWorkspace(state.workspaces, workspaceId, (workspace) => {
        const rest = (workspace.disabledInstructionIds ?? []).filter((id) => id !== optionId);
        return { ...workspace, disabledInstructionIds: disabled ? [...rest, optionId] : rest };
      }),
    })),
  updateLayout: (patch) => set((state) => ({ layout: { ...state.layout, ...patch } })),
  setDefaultAgentProvider: (providerId) => set({ defaultAgentProviderId: providerId }),
  setFeatureSettings: (featureId, settings) => set((state) => ({ featureSettings: { ...state.featureSettings, [featureId]: settings } })),
}));

function persistedSnapshot(state: WorkbenchStore): PersistedState {
  return {
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    personas: state.personas,
    instructionOptions: state.instructionOptions,
    seededInstructionIds: state.seededInstructionIds,
    layout: state.layout,
    defaultAgentProviderId: state.defaultAgentProviderId,
    featureSettings: state.featureSettings,
  };
}

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
useWorkbenchStore.subscribe((state, previous) => {
  if (!state.isHydrated) return;
  // Only a change to what is saved schedules a save; the store also holds state that never reaches disk.
  const next = persistedSnapshot(state);
  const before = persistedSnapshot(previous);
  if (previous.isHydrated && (Object.keys(next) as (keyof PersistedState)[]).every((key) => next[key] === before[key])) return;
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = undefined;
    void window.workbench.persistence.save(persistedSnapshot(useWorkbenchStore.getState())).then(
      () => useWorkbenchStore.setState({ persistenceError: undefined }),
      (error: unknown) => useWorkbenchStore.setState({ persistenceError: error instanceof Error ? error.message : String(error) }),
    );
  }, 180);
});
// The last few keystrokes before the app closes belong in the saved draft too.
window.addEventListener("beforeunload", () => {
  if (persistenceTimer === undefined) return;
  clearTimeout(persistenceTimer);
  persistenceTimer = undefined;
  window.workbench.persistence.saveNow(persistedSnapshot(useWorkbenchStore.getState()));
});
