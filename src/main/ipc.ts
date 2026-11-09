import { app, dialog, ipcMain, shell, Menu, type WebContents } from "electron";
import { promises as fs } from "node:fs";
import { FileOperations } from "./file-operations";
import { basename, join } from "node:path";
import { IPC } from "../shared/ipc";
import {
  agentPromptSchema,
  agentSessionActionSchema,
  agentSessionCreateOptionsSchema,
  attachmentLocationSchema,
  attachmentSaveSchema,
  checkoutSchema,
  commitSchema,
  baseBranchesSchema,
  createWorktreeSchema,
  fileOperationSchema,
  fileAtSchema,
  fileCreateSchema,
  fileExistsSchema,
  fileFindSchema,
  fileLocationSchema,
  fileRenameSchema,
  fileSearchSchema,
  fileWriteSchema,
  generateCommitMessageSchema,
  persistedStateSchema,
  ptyCreateOptionsSchema,
  ptyInputSchema,
  ptyResizeSchema,
  ptyTerminateSchema,
  workspaceRootSchema,
} from "../shared/schemas";
import type { FilesChangedEvent } from "../shared/models";
import { AgentSessionManager } from "./agent-session-manager";
import type { CommitMessages } from "./internal-ai/commit-message";
import { loadState, saveState, saveStateNow } from "./persistence";
import type { PromptAttachments } from "./prompt-attachments";
import { PtyManager } from "./pty-manager";
import type { SourceControlService } from "./source-control/source-control-provider";
import type { WorkspaceFiles, WorkspaceRoots } from "./workspace-files";

export interface WorkspaceServices {
  roots: WorkspaceRoots;
  files: WorkspaceFiles;
  sourceControl: SourceControlService;
  commitMessages: CommitMessages;
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
    try {
      if (event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted frame");
      handler(event, input);
    } catch (error) { console.warn(`Rejected ${channel}:`, String(error)); }
  });
}

/** Only the app's own top frame may call privileged handlers. */
function handle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, input: unknown) => unknown): void {
  ipcMain.handle(channel, (event, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted frame");
    return listener(event, input);
  });
}

export function registerIpc(ptyManager: PtyManager, agentSessionManager: AgentSessionManager, workspace: WorkspaceServices, attachments: PromptAttachments): void {
  listen(IPC.appTextMenu, () => Menu.buildFromTemplate([{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" }]).popup());
  const histories = new Map<WebContents, FileOperations>();
  const cache = join(app.getPath("userData"), "file-history");
  const ready = fs.rm(cache, { recursive: true, force: true });
  handle(IPC.filesOperate, async (event, input) => {
    await ready;
    let history = histories.get(event.sender);
    if (!history) {
      history = new FileOperations(workspace.roots, workspace.files, join(cache, String(event.sender.id)), 50, 256 * 1024 * 1024, (progress) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.filesProgress, progress); });
      histories.set(event.sender, history);
      const owned = history;
      event.sender.once("destroyed", () => { histories.delete(event.sender); void owned.dispose(); });
    }
    const result = await history.run(fileOperationSchema.parse(input));
    for (const root of new Set(result.effects.flatMap((e) => [e.source?.root, e.target?.root]).filter((r): r is string => Boolean(r)))) {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.filesChanged, { root, paths: [""] });
    }
    return result;
  });
  handle(IPC.filesLocate, (_event, input) => {
    const { root, path } = fileLocationSchema.parse(input); return workspace.files.absolutePath(root, path);
  });
  handle(IPC.filesOpenExternal, async (_event, input) => {
    const { root, path } = fileLocationSchema.parse(input);
    const error = await shell.openPath(await workspace.files.locate(root, path));
    if (error) throw new Error(error);
  });
  const watches = new FileWatchOwners(workspace.files);
  const allowedRoot = async (root: string) => { await workspace.roots.resolve(root); return root; };
  handle(IPC.persistenceLoad, async () => {
    const state = await loadState();
    workspace.roots.replace(state.workspaces.map((item) => item.path));
    // Nothing listed can also mean the state file couldn't be read: only tidy up against a real list of views.
    if (state.workspaces.length) {
      void attachments.retain(state.workspaces.flatMap((item) => item.views.map((view) => view.id)))
        .catch((error: unknown) => console.warn("Could not tidy attachments", String(error)));
    }
    return state;
  });
  handle(IPC.persistenceSave, async (_event, input: unknown) => {
    const state = await saveState(persistedStateSchema.parse(input));
    workspace.roots.replace(state.workspaces.map((item) => item.path));
  });
  // Synchronous on purpose: the closing window waits here, so the write finishes before the app can exit.
  ipcMain.on(IPC.persistenceSaveNow, (event, input: unknown) => {
    try {
      if (event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted frame");
      saveStateNow(input);
    } catch (error) { console.error("Could not save workbench state on close", error); }
    event.returnValue = null;
  });
  handle(IPC.workspaceChooseDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: "Add workspace",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Add workspace",
    });
    const chosen = result.canceled ? null : result.filePaths[0] ?? null;
    if (chosen) workspace.roots.add(chosen);
    return chosen;
  });
  handle(IPC.appMetrics, () => ({
    memoryBytes: app.getAppMetrics().reduce((total, metric) => total + metric.memory.workingSetSize * 1024, 0),
  }));
  handle(IPC.attachmentsSave, (_event, input: unknown) => {
    const { viewId, name, bytes } = attachmentSaveSchema.parse(input);
    return attachments.save(viewId, name, bytes);
  });
  handle(IPC.attachmentsThumbnail, (_event, input: unknown) => {
    const { viewId, id } = attachmentLocationSchema.parse(input);
    return attachments.thumbnail(viewId, id);
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
  handle(IPC.filesSearch, async (_event, input: unknown) => {
    const { root, query, ...options } = fileSearchSchema.parse(input);
    await allowedRoot(root);
    if (options.directory) await workspace.files.locate(root, options.directory);
    const provider = await workspace.sourceControl.providerFor(root);
    return provider?.search ? provider.search(root, query, options) : workspace.files.search(root, query, options);
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
    void workspace.files.locate(root, path).then((target) => shell.showItemInFolder(target))
      .catch((error: unknown) => console.warn("Could not reveal file", String(error)));
  });
  listen(IPC.filesWatch, (event, input: unknown) => watches.watch(event.sender, workspaceRootSchema.parse(input).root));
  listen(IPC.filesUnwatch, (event, input: unknown) => watches.unwatch(event.sender, workspaceRootSchema.parse(input).root));
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
    const { root, branch, base } = createWorktreeSchema.parse(input);
    return workspace.sourceControl.createWorktree(await allowedRoot(root), branch, base);
  });
  handle(IPC.sourceControlBranches, async (_event, input: unknown) =>
    workspace.sourceControl.branches(await allowedRoot(workspaceRootSchema.parse(input).root)));
  handle(IPC.sourceControlBaseBranches, async (_event, input: unknown) => {
    const { root, refresh } = baseBranchesSchema.parse(input);
    return workspace.sourceControl.baseBranches(await allowedRoot(root), refresh);
  });
  handle(IPC.sourceControlCheckout, async (_event, input: unknown) => {
    const { root, branch } = checkoutSchema.parse(input);
    return workspace.sourceControl.checkout(await allowedRoot(root), branch);
  });
  handle(IPC.sourceControlFileAt, async (_event, input: unknown) => {
    const { root, path, base } = fileAtSchema.parse(input);
    return workspace.sourceControl.fileAt(await allowedRoot(root), path, base);
  });
  handle(IPC.sourceControlIgnored, async (_event, input: unknown) =>
    workspace.sourceControl.ignored(await allowedRoot(workspaceRootSchema.parse(input).root)));
  handle(IPC.sourceControlGenerateCommitMessage, async (_event, input: unknown) => {
    const { root, providerId } = generateCommitMessageSchema.parse(input);
    return workspace.commitMessages.generate(await allowedRoot(root), providerId);
  });
  handle(IPC.ptyCreate, async (event, input: unknown) => {
    const options = ptyCreateOptionsSchema.parse(input);
    options.cwd = await workspace.roots.directory(options.cwd);
    if (!(await fs.stat(options.cwd)).isDirectory()) throw new Error("Terminal working directory must be a folder.");
    return ptyManager.create(options, event.sender);
  });
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
