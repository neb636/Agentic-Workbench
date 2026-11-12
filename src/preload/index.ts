import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import { AI_USAGE_IPC, type UsageSnapshot } from "../shared/ai-usage";
import type {
  AgentProviderInfo,
  AgentSessionCreateOptions,
  AgentSessionEvent,
  FilesChangedEvent,
  MenuCommand,
  PersistedState,
  PtyCreateOptions,
  PtyDataEvent,
  PtyExitEvent,
  WorkbenchApi,
} from "../shared/models";

const api: WorkbenchApi = {
  platform: process.platform,
  aiUsage: {
    snapshot: () => ipcRenderer.invoke(AI_USAGE_IPC.snapshot),
    refresh: () => ipcRenderer.invoke(AI_USAGE_IPC.refresh),
    configure: (providers) => ipcRenderer.invoke(AI_USAGE_IPC.configure, { providers }),
    onChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: UsageSnapshot) => listener(payload);
      ipcRenderer.on(AI_USAGE_IPC.changed, wrapped);
      return () => ipcRenderer.removeListener(AI_USAGE_IPC.changed, wrapped);
    },
  },
  persistence: {
    load: () => ipcRenderer.invoke(IPC.persistenceLoad) as Promise<PersistedState>,
    save: (state) => ipcRenderer.invoke(IPC.persistenceSave, state) as Promise<void>,
    saveNow: (state) => { ipcRenderer.sendSync(IPC.persistenceSaveNow, state); },
  },
  workspace: {
    chooseDirectory: () => ipcRenderer.invoke(IPC.workspaceChooseDirectory) as Promise<string | null>,
    chooseIcon: () => ipcRenderer.invoke(IPC.workspaceChooseIcon) as Promise<string | null>,
  },
  app: {
    storageMaintenance: (prune) => ipcRenderer.invoke(IPC.storageMaintenance, prune),
    revokeExecutionTrust: () => ipcRenderer.invoke(IPC.revokeExecutionTrust),
    textMenu: () => ipcRenderer.send(IPC.appTextMenu),
    onMenuCommand: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, command: MenuCommand) => listener(command);
      ipcRenderer.on(IPC.menuCommand, wrapped);
      return () => ipcRenderer.removeListener(IPC.menuCommand, wrapped);
    },
  },
  attachments: {
    save: (viewId, name, bytes) => ipcRenderer.invoke(IPC.attachmentsSave, { viewId, name, bytes }),
    thumbnail: (viewId, id) => ipcRenderer.invoke(IPC.attachmentsThumbnail, { viewId, id }),
    image: (viewId, id) => ipcRenderer.invoke(IPC.attachmentsImage, { viewId, id }),
  },
  files: {
    onProgress: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, progress: import("../shared/file-operations").FileOperationProgress) => listener(progress);
      ipcRenderer.on(IPC.filesProgress, wrapped);
      return () => ipcRenderer.removeListener(IPC.filesProgress, wrapped);
    },
    operate: (operation) => ipcRenderer.invoke(IPC.filesOperate, operation),
    locate: (root, path) => ipcRenderer.invoke(IPC.filesLocate, { root, path }),
    openExternal: (root, path) => ipcRenderer.invoke(IPC.filesOpenExternal, { root, path }),
    list: (root, path) => ipcRenderer.invoke(IPC.filesList, { root, path }),
    read: (root, path) => ipcRenderer.invoke(IPC.filesRead, { root, path }),
    find: (root, query) => ipcRenderer.invoke(IPC.filesFind, { root, query }),
    write: (root, path, content, expectedHash) => ipcRenderer.invoke(IPC.filesWrite, { root, path, content, expectedHash }),
    search: (root, query, options) => ipcRenderer.invoke(IPC.filesSearch, { root, query, ...options }),
    image: (root, path) => ipcRenderer.invoke(IPC.filesImage, { root, path }),
    exists: (root, paths) => ipcRenderer.invoke(IPC.filesExists, { root, paths }),
    create: (root, path, kind) => ipcRenderer.invoke(IPC.filesCreate, { root, path, kind }),
    rename: (root, from, to) => ipcRenderer.invoke(IPC.filesRename, { root, from, to }),
    trash: (root, path) => ipcRenderer.invoke(IPC.filesTrash, { root, path }),
    reveal: (root, path) => ipcRenderer.send(IPC.filesReveal, { root, path }),
    watch: (root) => ipcRenderer.send(IPC.filesWatch, { root }),
    unwatch: (root) => ipcRenderer.send(IPC.filesUnwatch, { root }),
    onChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: FilesChangedEvent) => listener(payload);
      ipcRenderer.on(IPC.filesChanged, wrapped);
      return () => ipcRenderer.removeListener(IPC.filesChanged, wrapped);
    },
  },
  sourceControl: {
    detect: (root) => ipcRenderer.invoke(IPC.sourceControlDetect, { root }),
    status: (root) => ipcRenderer.invoke(IPC.sourceControlStatus, { root }),
    commit: (root, message, options) => ipcRenderer.invoke(IPC.sourceControlCommit, { root, message, ...options }),
    runAction: (root, action) => ipcRenderer.invoke(IPC.sourceControlRunAction, { root, action }),
    stage: (root, paths) => ipcRenderer.invoke(IPC.sourceControlStage, { root, paths }),
    unstage: (root, paths) => ipcRenderer.invoke(IPC.sourceControlUnstage, { root, paths }),
    discard: (root, paths) => ipcRenderer.invoke(IPC.sourceControlDiscard, { root, paths }),
    branchAction: (root, action, target) => ipcRenderer.invoke(IPC.sourceControlBranchAction, { root, action, target }),
    history: (root, skip, limit) => ipcRenderer.invoke(IPC.sourceControlHistory, { root, skip, limit }),
    commitFiles: (root, id) => ipcRenderer.invoke(IPC.sourceControlCommitFiles, { root, id }),
    commitFile: (root, id, path, originalPath) => ipcRenderer.invoke(IPC.sourceControlCommitFile, { root, id, path, originalPath }),
    revert: (root, id) => ipcRenderer.invoke(IPC.sourceControlRevert, { root, id }),
    stashes: (root) => ipcRenderer.invoke(IPC.sourceControlStashes, { root }),
    stashAction: (root, action, id) => ipcRenderer.invoke(IPC.sourceControlStashAction, { root, action, id }),
    createWorktree: (root, branch, base) => ipcRenderer.invoke(IPC.sourceControlCreateWorktree, { root, branch, base }),
    branches: (root) => ipcRenderer.invoke(IPC.sourceControlBranches, { root }),
    baseBranches: (root, refresh) => ipcRenderer.invoke(IPC.sourceControlBaseBranches, { root, refresh }),
    checkout: (root, branch) => ipcRenderer.invoke(IPC.sourceControlCheckout, { root, branch }),
    fileAt: (root, path, base) => ipcRenderer.invoke(IPC.sourceControlFileAt, { root, path, base }),
    ignored: (root) => ipcRenderer.invoke(IPC.sourceControlIgnored, { root }),
    previewCommitMessage: (root, stagedOnly) => ipcRenderer.invoke(IPC.sourceControlPreviewCommitMessage, { root, stagedOnly }),
    generateCommitMessage: (root, providerId, stagedOnly) => ipcRenderer.invoke(IPC.sourceControlGenerateCommitMessage, { root, providerId, stagedOnly }),
  },
  resources: {
    snapshot: () => ipcRenderer.invoke(IPC.resourcesSnapshot),
    summary: () => ipcRenderer.invoke(IPC.resourcesSummary),
    end: (sessionId) => ipcRenderer.invoke(IPC.resourcesEnd, { sessionId }),
  },
  pty: {
    create: (options: PtyCreateOptions) => ipcRenderer.invoke(IPC.ptyCreate, options) as Promise<string>,
    attach: (sessionId) => ipcRenderer.invoke(IPC.ptyAttach, { sessionId }),
    input: (sessionId, data) => ipcRenderer.send(IPC.ptyInput, { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.ptyResize, { sessionId, cols, rows }),
    terminate: (sessionId) => ipcRenderer.send(IPC.ptyTerminate, { sessionId }),
    onData: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: PtyDataEvent) => listener(payload);
      ipcRenderer.on(IPC.ptyData, wrapped);
      return () => ipcRenderer.removeListener(IPC.ptyData, wrapped);
    },
    onExit: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: PtyExitEvent) => listener(payload);
      ipcRenderer.on(IPC.ptyExit, wrapped);
      return () => ipcRenderer.removeListener(IPC.ptyExit, wrapped);
    },
  },
  agent: {
    providers: () => ipcRenderer.invoke(IPC.agentProviders),
    onProvidersChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: AgentProviderInfo[]) => listener(payload);
      ipcRenderer.on(IPC.agentProvidersChanged, wrapped);
      return () => ipcRenderer.removeListener(IPC.agentProvidersChanged, wrapped);
    },
    attach: (sessionId) => ipcRenderer.invoke(IPC.agentAttach, { sessionId }),
    input: (sessionId, data) => ipcRenderer.send(IPC.agentInput, { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.agentResize, { sessionId, cols, rows }),
    create: (options: AgentSessionCreateOptions) =>
      ipcRenderer.invoke(IPC.agentCreate, options) as Promise<string>,
    sendPrompt: (sessionId, request) =>
      ipcRenderer.invoke(IPC.agentSendPrompt, { sessionId, ...request }),
    interrupt: (sessionId) => ipcRenderer.send(IPC.agentInterrupt, { sessionId }),
    terminate: (sessionId) => ipcRenderer.send(IPC.agentTerminate, { sessionId }),
    onEvent: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: AgentSessionEvent) => listener(payload);
      ipcRenderer.on(IPC.agentEvent, wrapped);
      return () => ipcRenderer.removeListener(IPC.agentEvent, wrapped);
    },
  },
};

contextBridge.exposeInMainWorld("workbench", api);
