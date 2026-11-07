import { app, dialog, ipcMain, shell, type WebContents } from "electron";
import { basename } from "node:path";
import { IPC } from "../shared/ipc";
import {
  agentPromptSchema,
  agentSessionActionSchema,
  agentSessionCreateOptionsSchema,
  commitSchema,
  createWorktreeSchema,
  fileAtSchema,
  fileCreateSchema,
  fileExistsSchema,
  fileFindSchema,
  fileLocationSchema,
  fileRenameSchema,
  fileSearchSchema,
  fileWriteSchema,
  imageFileSchema,
  imageImportSchema,
  imagePrepareRunSchema,
  imageRunSchema,
  imageViewSchema,
  persistedStateSchema,
  ptyCreateOptionsSchema,
  ptyInputSchema,
  ptyResizeSchema,
  ptyTerminateSchema,
  workCreateSchema,
  workListSchema,
  workRemoveSchema,
  workspaceRootSchema,
} from "../shared/schemas";
import type { FilesChangedEvent } from "../shared/models";
import { AgentSessionManager } from "./agent-session-manager";
import type { ImageLibrary } from "./image-library";
import { loadState, saveState } from "./persistence";
import { PtyManager } from "./pty-manager";
import type { SourceControlService } from "./source-control/source-control-provider";
import type { WorkspaceFiles, WorkspaceRoots } from "./workspace-files";
import type { WorkService } from "./work";

export interface WorkspaceServices {
  roots: WorkspaceRoots;
  files: WorkspaceFiles;
  sourceControl: SourceControlService;
  images: ImageLibrary;
  work: WorkService;
}

/** File watches are owned by the window that asked for them and end with it. */
class FileWatchOwners {
  private readonly owners = new Map<WebContents, Map<string, Promise<() => void>>>();

  constructor(private readonly files: WorkspaceFiles) {}

  watch(owner: WebContents, root: string): void {
    let watches = this.owners.get(owner);
    if (!watches) {
      watches = new Map();
      this.owners.set(owner, watches);
      owner.once("destroyed", () => this.release(owner));
    }
    if (watches.has(root)) return;
    const disposal = this.files.watch(root, (paths) => {
      if (!owner.isDestroyed()) owner.send(IPC.filesChanged, { root, paths } satisfies FilesChangedEvent);
    });
    disposal.catch((error: unknown) => { console.warn("Could not watch workspace", String(error)); watches.delete(root); });
    watches.set(root, disposal);
  }

  unwatch(owner: WebContents, root: string): void {
    const disposal = this.owners.get(owner)?.get(root);
    this.owners.get(owner)?.delete(root);
    void disposal?.then((dispose) => dispose()).catch(() => undefined);
  }

  private release(owner: WebContents): void {
    for (const root of [...(this.owners.get(owner)?.keys() ?? [])]) this.unwatch(owner, root);
    this.owners.delete(owner);
  }
}

function listen(channel: string, handler: (event: Electron.IpcMainEvent, input: unknown) => void): void {
  ipcMain.on(channel, (event, input: unknown) => {
    try { if (event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted frame"); handler(event, input); } catch (error) { console.warn(`Rejected ${channel}:`, String(error)); }
  });
}

export function registerIpc(ptyManager: PtyManager, agentSessionManager: AgentSessionManager, workspace: WorkspaceServices): void {
  const handle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, input: unknown) => unknown) => ipcMain.handle(channel, (event, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted frame');
    return listener(event, input);
  });
  const watches = new FileWatchOwners(workspace.files);
  const allowedRoot = async (root: string) => { await workspace.roots.resolve(root); return root; };
  handle(IPC.persistenceLoad, async () => {
    const state = await loadState();
    workspace.roots.replace([...state.workspaces.map((item) => item.path), ...(state.repoRoot ? [state.repoRoot] : [])]);
    return state;
  });
  let saving: Promise<unknown> = Promise.resolve();
  handle(IPC.persistenceSave, (_event, input: unknown) => {
    const state = persistedStateSchema.parse(input);
    // Grant/revoke in message order; an older disk write must not revoke a newly opened folder.
    workspace.roots.replace([...state.workspaces.map((item) => item.path), ...(state.repoRoot ? [state.repoRoot] : [])]);
    const next = saving.catch(() => {}).then(() => saveState(state));
    saving = next;
    return next.then(() => undefined);
  });
  handle(IPC.workspaceChooseDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: "Open the Gamepack repo",
      properties: ["openDirectory"],
      buttonLabel: "Open",
    });
    const chosen = result.canceled ? null : result.filePaths[0] ?? null;
    if (chosen) workspace.roots.add(chosen);
    return chosen;
  });
  handle(IPC.appMetrics, () => ({
    memoryBytes: app.getAppMetrics().reduce((total, metric) => total + metric.memory.workingSetSize * 1024, 0),
  }));
  // The Dock badge: how many pieces of work have an agent that finished or asks something.
  listen(IPC.appBadge, (_event, input) => {
    const count = typeof input === "number" && Number.isFinite(input) ? Math.max(0, Math.min(99, Math.floor(input))) : 0;
    app.setBadgeCount(count);
  });
  handle(IPC.filesList, (_event, input: unknown) => {
    const { root, path } = fileLocationSchema.parse(input);
    return workspace.files.list(root, path);
  });
  handle(IPC.filesRead, (_event, input: unknown) => {
    const { root, path } = fileLocationSchema.parse(input);
    return workspace.files.read(root, path);
  });
  handle(IPC.filesFind, (_event, input: unknown) => {
    const { root, query } = fileFindSchema.parse(input);
    return workspace.files.find(root, query);
  });
  handle(IPC.filesWrite, (_event, input: unknown) => {
    const { root, path, content, expectedHash } = fileWriteSchema.parse(input);
    return workspace.files.write(root, path, content, expectedHash);
  });
  handle(IPC.filesSearch, (_event, input: unknown) => {
    const { root, query, caseSensitive, regex } = fileSearchSchema.parse(input);
    return workspace.files.search(root, query, { caseSensitive, regex });
  });
  handle(IPC.filesImage, (_event, input: unknown) => {
    const { root, path } = fileLocationSchema.parse(input);
    return workspace.files.image(root, path);
  });
  handle(IPC.filesExists, (_event, input: unknown) => {
    const { root, paths } = fileExistsSchema.parse(input);
    return workspace.files.exists(root, paths);
  });
  handle(IPC.filesCreate, (_event, input: unknown) => {
    const { root, path, kind } = fileCreateSchema.parse(input);
    return workspace.files.create(root, path, kind);
  });
  handle(IPC.filesRename, (_event, input: unknown) => {
    const { root, from, to } = fileRenameSchema.parse(input);
    return workspace.files.rename(root, from, to);
  });
  handle(IPC.filesTrash, (_event, input: unknown) => {
    const { root, path } = fileLocationSchema.parse(input);
    return workspace.files.trash(root, path);
  });
  listen(IPC.filesReveal, (_event, input: unknown) => {
    const { root, path } = fileLocationSchema.parse(input);
    void workspace.files.locate(root, path).then((target) => shell.showItemInFolder(target)).catch((error: unknown) => console.warn("Could not reveal file", String(error)));
  });
  listen(IPC.filesWatch, (event, input: unknown) => watches.watch(event.sender, workspaceRootSchema.parse(input).root));
  listen(IPC.filesUnwatch, (event, input: unknown) => watches.unwatch(event.sender, workspaceRootSchema.parse(input).root));
  handle(IPC.sourceControlBranches, async (_event, input: unknown) =>
    workspace.sourceControl.branches(await allowedRoot(workspaceRootSchema.parse(input).root)));
  handle(IPC.sourceControlCheckout, async (_event, input: unknown) => {
    const { root, branch } = createWorktreeSchema.parse(input);
    return workspace.sourceControl.checkout(await allowedRoot(root), branch);
  });
  handle(IPC.sourceControlDetect, async (_event, input: unknown) => {
    const root = await allowedRoot(workspaceRootSchema.parse(input).root);
    return Boolean(await workspace.sourceControl.providerFor(root));
  });
  handle(IPC.sourceControlStatus, async (_event, input: unknown) =>
    workspace.sourceControl.status(await allowedRoot(workspaceRootSchema.parse(input).root)));
  handle(IPC.sourceControlCommit, async (_event, input: unknown) => {
    const { root, message } = commitSchema.parse(input);
    return workspace.sourceControl.commit(await allowedRoot(root), message);
  });
  handle(IPC.sourceControlCreateWorktree, async (_event, input: unknown) => {
    const { root, branch } = createWorktreeSchema.parse(input);
    return workspace.sourceControl.createWorktree(await allowedRoot(root), branch);
  });
  handle(IPC.sourceControlFileAt, async (_event, input: unknown) => {
    const { root, path, base } = fileAtSchema.parse(input);
    return workspace.sourceControl.fileAt(await allowedRoot(root), path, base);
  });
  handle(IPC.sourceControlIgnored, async (_event, input: unknown) =>
    workspace.sourceControl.ignored(await allowedRoot(workspaceRootSchema.parse(input).root)));
  handle(IPC.workList, async (_event, input: unknown) => {
    const { root, refresh } = workListSchema.parse(input);
    return workspace.work.list(await allowedRoot(root), refresh);
  });
  handle(IPC.workCreate, async (_event, input: unknown) => {
    const { root, name } = workCreateSchema.parse(input);
    return workspace.work.create(await allowedRoot(root), name);
  });
  handle(IPC.workRemove, async (_event, input: unknown) => {
    const { root, path } = workRemoveSchema.parse(input);
    return workspace.work.remove(await allowedRoot(root), path);
  });
  handle(IPC.workInstall, async (_event, input: unknown) => {
    const { root, path } = workRemoveSchema.parse(input);
    return workspace.work.installDependencies(await allowedRoot(root), path);
  });
  handle(IPC.imagesFolder, (_event, input: unknown) => workspace.images.folder(imageViewSchema.parse(input).viewId));
  handle(IPC.imagesImportData, (_event, input: unknown) => {
    const { viewId, name, data } = imageImportSchema.parse(input);
    return workspace.images.importData(viewId, name, data);
  });
  handle(IPC.imagesPrepareRun, (_event, input: unknown) => {
    const { viewId, runId, attachments } = imagePrepareRunSchema.parse(input);
    return workspace.images.prepareRun(viewId, runId, attachments);
  });
  handle(IPC.imagesInspectRun, (_event, input: unknown) => {
    const { viewId, runId } = imageRunSchema.parse(input);
    return workspace.images.inspectRun(viewId, runId);
  });
  handle(IPC.imagesRead, (_event, input: unknown) => {
    const { viewId, file } = imageFileSchema.parse(input);
    return workspace.images.read(viewId, file);
  });
  listen(IPC.imagesReveal, (_event, input: unknown) => {
    const { viewId, file } = imageFileSchema.parse(input);
    void workspace.images.locate(viewId, file).then((target) => shell.showItemInFolder(target)).catch((error: unknown) => console.warn("Could not reveal image", String(error)));
  });
  handle(IPC.ptyCreate, (event, input: unknown) =>
    ptyManager.create(ptyCreateOptionsSchema.parse(input), event.sender),
  );
  listen(IPC.ptyInput, (event, input: unknown) => {
    const parsed = ptyInputSchema.parse(input);
    ptyManager.input(parsed.sessionId, parsed.data, event.sender);
  });
  listen(IPC.ptyResize, (event, input: unknown) => {
    const parsed = ptyResizeSchema.parse(input);
    ptyManager.resize(parsed.sessionId, parsed.cols, parsed.rows, event.sender);
  });
  listen(IPC.ptyTerminate, (event, input: unknown) => {
    ptyManager.terminate(ptyTerminateSchema.parse(input).sessionId, event.sender);
  });
  handle(IPC.agentCreate, (event, input: unknown) =>
    agentSessionManager.create(agentSessionCreateOptionsSchema.parse(input), event.sender),
  );
  handle(IPC.agentProviders, () => agentSessionManager.discover());
  handle(IPC.agentAttach, (event, input: unknown) => agentSessionManager.attach(agentSessionActionSchema.parse(input).sessionId, event.sender));
  listen(IPC.agentInput, (event, input: unknown) => {
    const p = ptyInputSchema.parse(input);
    agentSessionManager.input(p.sessionId, p.data, event.sender);
  });
  listen(IPC.agentResize, (event, input: unknown) => {
    const p = ptyResizeSchema.parse(input);
    agentSessionManager.resize(p.sessionId, p.cols, p.rows, event.sender);
  });
  handle(IPC.agentSendPrompt, (event, input: unknown) => {
    const parsed = agentPromptSchema.parse(input);
    return agentSessionManager.sendPrompt(parsed.sessionId, { prompt: parsed.prompt, intent: parsed.intent }, event.sender);
  });
  listen(IPC.agentInterrupt, (event, input: unknown) => {
    agentSessionManager.interrupt(agentSessionActionSchema.parse(input).sessionId, event.sender);
  });
  listen(IPC.agentTerminate, (event, input: unknown) => {
    agentSessionManager.terminate(agentSessionActionSchema.parse(input).sessionId, event.sender);
  });
}

export function unregisterIpc(): void {
  for (const channel of Object.values(IPC)) { ipcMain.removeHandler(channel); ipcMain.removeAllListeners(channel); }
}

export function directoryName(directoryPath: string): string {
  return basename(directoryPath);
}
