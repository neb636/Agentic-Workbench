import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, shell, type WebContents } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { AgentModelCatalogue } from "./agent-model-catalogue";
import { AgentSessionManager } from "./agent-session-manager";
import { CommitMessages } from "./internal-ai/commit-message";
import { InternalAiService } from "./internal-ai/internal-ai-service";
import { isWorkspaceTrusted, loadExecutionTrust } from "./workspace-trust";
import { executablePath } from "./executables";
import { APP_URL, assertAppSender, registerAppWindow, developmentUrl, configureSecurity } from "./security";
import { registerIpc } from "./ipc";
import { ClaudeAgentProvider } from "./providers/claude-agent-provider";
import { CodexAgentProvider } from "./providers/codex-agent-provider";
import { GitSourceControlProvider } from "./providers/git-source-control-provider";
import { imagePreview } from "./image-previews";
import { PromptAttachments, THUMBNAIL_SIDE } from "./prompt-attachments";
import { PtyManager } from "./pty-manager";
import { ResourceMonitor } from "./resource-monitor";
import { adoptLoginShellPath } from "./shell-environment";
import { IPC } from "../shared/ipc";
import type { MenuCommand } from "../shared/models";
import { SourceControlService } from "./source-control/source-control-provider";
import { WorkspaceFiles, WorkspaceRoots } from "./workspace-files";
import { createAiUsage, registerAiUsage } from "./ai-usage";

if (process.env.WORKBENCH_USER_DATA_DIR) app.setPath("userData", process.env.WORKBENCH_USER_DATA_DIR);
if (app.isPackaged) adoptLoginShellPath();

const ptyManager = new PtyManager();
const attachments = new PromptAttachments(() => path.join(app.getPath("userData"), "attachments"), (bytes) => imagePreview(bytes, THUMBNAIL_SIDE));
const agentProviders = [new CodexAgentProvider(), new ClaudeAgentProvider()];
const agentModels = new AgentModelCatalogue(agentProviders);
const aiUsage = createAiUsage(agentProviders);
const agentSessionManager = new AgentSessionManager(agentProviders, undefined, (viewId) => attachments.folderFor(viewId), agentModels, [aiUsage.launchArgs]);
const internalAi = new InternalAiService(agentProviders, () => path.join(app.getPath("userData"), "internal-ai"));
const resources = new ResourceMonitor([ptyManager, agentSessionManager]);
const roots = new WorkspaceRoots();
const sourceControl = new SourceControlService([new GitSourceControlProvider(() => executablePath("git"), isWorkspaceTrusted)]);
const workspaceServices = {
  roots,
  files: new WorkspaceFiles(roots, (target) => shell.trashItem(target)),
  sourceControl,
  commitMessages: new CommitMessages(sourceControl, internalAi),
};

/**
 * Files the system asks the app to open: Finder's Open With or a default-app double click, a file dropped on the dock
 * icon, `open -a`, a path on the command line, or File ▸ Open File…. Each is granted on its own (never its folder) and
 * handed to the renderer, which opens it in the workspace that holds it or in the built-in Files workspace.
 * macOS can ask before the app is ready (a cold launch from Finder) and before the page listens, so paths wait here.
 */
const pendingFiles: string[] = [];
const listeningForFiles = new Set<WebContents>();

async function openFiles(paths: string[]): Promise<void> {
  for (const requested of paths) {
    try {
      const absolute = await fs.realpath(path.resolve(requested));
      if (!(await fs.stat(absolute)).isFile()) continue;
      roots.grantFiles([absolute]);
      pendingFiles.push(absolute);
    } catch (error) { console.warn("Could not open file", String(error)); }
  }
  deliverFiles();
}

function deliverFiles(): void {
  if (!pendingFiles.length || !app.isReady()) return;
  const windows = BrowserWindow.getAllWindows();
  if (!windows.length) { createWindow(); return; }
  const target = [BrowserWindow.getFocusedWindow(), ...windows].find((window) => window && listeningForFiles.has(window.webContents));
  if (!target) return;
  target.webContents.send(IPC.openFiles, pendingFiles.splice(0));
  if (process.env.WORKBENCH_QA_HIDDEN === "1") return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}

/** File paths given on the command line (`electron . notes.md`, or the packaged binary with a path). */
function commandLineFiles(argv: string[]): string[] {
  return argv.slice(process.defaultApp ? 2 : 1).filter((arg) => arg && !arg.startsWith("-") && arg !== ".");
}

app.on("open-file", (event, file) => {
  event.preventDefault();
  void openFiles([file]);
});

async function chooseFilesToOpen(): Promise<void> {
  const result = await dialog.showOpenDialog({ title: "Open File", properties: ["openFile", "multiSelections"], buttonLabel: "Open" });
  if (!result.canceled) await openFiles(result.filePaths);
}

/** File ▸ Open File… (⌘O), added to Electron's default File menu. */
function addFileMenuItems(): void {
  const menu = Menu.getApplicationMenu();
  const file = menu?.items.find((item) => item.role === "fileMenu" || item.label === "File")?.submenu;
  if (!menu || !file) return;
  file.insert(0, new MenuItem({ type: "separator" }));
  file.insert(0, new MenuItem({ id: "workbench-open-file", label: "Open File…", accelerator: "CmdOrCtrl+O", click: () => void chooseFilesToOpen() }));
  Menu.setApplicationMenu(menu);
}

/**
 * View ▸ Go to File (⌘P) and Find in Files (⇧⌘F) as menu accelerators, so they work wherever focus is
 * (a terminal included). Added to Electron's default menu, keeping its Edit/Window roles.
 */
function addMenuItems(): void {
  const menu = Menu.getApplicationMenu();
  const view = menu?.items.find((item) => item.role === "viewMenu" || item.label === "View")?.submenu;
  if (!menu || !view) return;
  const send = (command: MenuCommand) =>
    (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send(IPC.menuCommand, command);
  const items: { id: MenuCommand; label: string; accelerator: string }[] = [
    { id: "quick-open", label: "Go to File…", accelerator: "CmdOrCtrl+P" },
    { id: "find-in-files", label: "Find in Files", accelerator: "CmdOrCtrl+Shift+F" },
  ];
  view.insert(0, new MenuItem({ type: "separator" }));
  for (const item of items.reverse()) {
    view.insert(0, new MenuItem({ id: `workbench-${item.id}`, label: item.label, accelerator: item.accelerator, click: () => send(item.id) }));
  }
  Menu.setApplicationMenu(menu);
}

function createWindow(): BrowserWindow {
  const qaHidden = process.env.WORKBENCH_QA_HIDDEN === "1";
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f8f7f7",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 22, y: 22 },
    show: !qaHidden,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !qaHidden,
    },
  });

  registerAppWindow(window);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const allowed = developmentUrl();
    if (!allowed || new URL(url).origin !== new URL(allowed).origin) event.preventDefault();
  });
  // Sessions belong to the page that started them. A reload or a crashed renderer loses every view that showed them,
  // and the webContents outlives both, so they end then too: nothing could reach or close them afterwards.
  const contents = window.webContents;
  const endSessions = () => {
    listeningForFiles.delete(contents);
    ptyManager.terminateForOwner(contents);
    agentSessionManager.terminateForOwner(contents);
  };
  window.webContents.on("destroyed", endSessions);
  window.webContents.on("render-process-gone", endSessions);
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) endSessions();
  });

  if (developmentUrl()) {
    void window.loadURL(developmentUrl()!);
  } else {
    void window.loadURL(APP_URL);
  }
  return window;
}

app.whenReady().then(async () => {
  await fs.mkdir(app.getPath("userData"), { recursive: true, mode: 0o700 });
  await fs.chmod(app.getPath("userData"), 0o700);
  await loadExecutionTrust();
  configureSecurity();
  if (process.env.WORKBENCH_QA_HIDDEN === "1") app.dock?.hide();
  registerIpc(ptyManager, agentSessionManager, workspaceServices, attachments, resources);
  registerAiUsage(aiUsage);
  // The page says when it listens for files to open; anything that arrived before then is delivered at that point.
  ipcMain.on(IPC.openFiles, (event) => {
    try { assertAppSender(event); } catch (error) { console.warn(`Rejected ${IPC.openFiles}:`, String(error)); return; }
    listeningForFiles.add(event.sender);
    deliverFiles();
  });
  addMenuItems();
  addFileMenuItems();
  createWindow();
  void openFiles(commandLineFiles(process.argv));
  agentModels.start(() => {
    const providers = agentSessionManager.discover();
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.agentProvidersChanged, providers);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/** At quit, sessions get a short grace to exit on their hang-up (a CLI saving its conversation) before being killed. */
const QUIT_GRACE_MS = 1500;
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  agentModels.stop();
  aiUsage.stop();
  internalAi.terminateAll();
  void Promise.allSettled([agentSessionManager.terminateAll(QUIT_GRACE_MS), ptyManager.terminateAll(QUIT_GRACE_MS)]).then(() => app.quit());
});
