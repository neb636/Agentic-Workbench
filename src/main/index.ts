import { app, BrowserWindow, shell, ipcMain, dialog, Menu, MenuItem, clipboard } from "electron";
import path from "node:path";
import { AgentSessionManager } from "./agent-session-manager";
import { ImageLibrary } from "./image-library";
import { registerIpc } from "./ipc";
import { ClaudeAgentProvider } from "./providers/claude-agent-provider";
import { CodexAgentProvider } from "./providers/codex-agent-provider";
import { GitSourceControlProvider } from "./providers/git-source-control-provider";
import { PtyManager } from "./pty-manager";
import { adoptLoginShellPath } from "./shell-environment";
import { SourceControlService } from "./source-control/source-control-provider";
import { WorkspaceFiles, WorkspaceRoots } from "./workspace-files";
import { WorkService } from "./work";

import { StudioServer } from './studio-server';
import { GAME_PORTS, STUDIO_ORIGIN } from '../shared/labs';
import type { MenuCommand } from '../shared/models';
import { GameServerPool } from './game-server';
import { SectionsService } from './sections';
import { createQuitHandler } from './quit-handler';
import { LabAi } from './lab-ai';
const labAi = new LabAi();
const repoRoot = app.isPackaged ? null : process.env.STUDIO_REPO_ROOT || path.resolve(__dirname, '../../..');
let quitting = false;
// Window icon on Windows/Linux. macOS uses the native icon from the app bundle.
const appIcon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.resolve(__dirname, '../../../public/icons/icon-512.png');
// Every piece of work gets its own server when its game opens. STUDIO_GAME_PORT is for a server someone else runs.
const launcherPort = !app.isPackaged && repoRoot ? Number(process.env.STUDIO_GAME_PORT) || undefined : undefined;
const gameServers = new GameServerPool(GAME_PORTS.filter(port => port !== launcherPort), {
  keep: 2,
  external: launcherPort && repoRoot ? { root: repoRoot, port: launcherPort } : undefined,
  onFailure: (root, message) => dialog.showErrorBox('Game server stopped', `${root}\n\n${message}`),
});
const sections = new SectionsService();
const studioServer = new StudioServer();
app.setName('Kaylee Gamepack Studio');
app.setPath('userData', path.join(app.getPath('appData'), 'Kaylee Gamepack Studio'));
if (process.env.WORKBENCH_USER_DATA_DIR) app.setPath("userData", process.env.WORKBENCH_USER_DATA_DIR);
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
app.on('second-instance', () => { const window = BrowserWindow.getAllWindows()[0]; window?.restore(); window?.focus(); });
if (app.isPackaged) adoptLoginShellPath();

const ptyManager = new PtyManager();
const images = new ImageLibrary(path.join(app.getPath("userData"), "image-generator"));
const agentSessionManager = new AgentSessionManager([
  new CodexAgentProvider(),
  new ClaudeAgentProvider(),
], undefined, [
  // Image generator views ask their agent to run the image CLI once per variant and write a manifest.
  { id: "image-generator", root: images.root, allowCommands: ["codex exec"], allowWritesInCwd: true },
]);
const roots = new WorkspaceRoots();
const git = new GitSourceControlProvider();
const workspaceServices = {
  roots,
  files: new WorkspaceFiles(roots, (target) => shell.trashItem(target)),
  sourceControl: new SourceControlService([git]),
  images,
  work: new WorkService(git, roots),
};

/**
 * View ▸ Game (⌘G), Explorer (⌘⌥B), Go to File (⌘P), Find in Files (⇧⌘F). Menu accelerators, so they work wherever
 * focus is, the game's own frame included (that frame keeps its key events from Studio's page). Added to Electron's
 * default menu, keeping its Edit/Window roles.
 */
function addStudioMenuItems(): void {
  const menu = Menu.getApplicationMenu();
  const view = menu?.items.find((item) => item.role === "viewMenu" || item.label === "View")?.submenu;
  if (!menu || !view) return;
  // One window gets each once: the focused one, else the first.
  const send = (command: MenuCommand) => (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send("studio:menu", command);
  const items: { id: MenuCommand; label: string; accelerator: string }[] = [
    { id: "game", label: "Game", accelerator: "CmdOrCtrl+G" },
    { id: "explorer", label: "Show/Hide Explorer", accelerator: "CmdOrCtrl+Alt+B" },
    { id: "quick-open", label: "Go to File…", accelerator: "CmdOrCtrl+P" },
    { id: "find-in-files", label: "Find in Files", accelerator: "CmdOrCtrl+Shift+F" },
  ];
  view.insert(0, new MenuItem({ type: "separator" }));
  for (const item of items.reverse()) view.insert(0, new MenuItem({ id: `studio-${item.id}`, label: item.label, accelerator: item.accelerator, click: () => send(item.id) }));
  Menu.setApplicationMenu(menu);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f8f7f7",
    title: "Kaylee Gamepack Studio",
    icon: appIcon,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 22, y: 22 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged ? STUDIO_ORIGIN : process.env.VITE_DEV_SERVER_URL;
    if (!allowed || new URL(url).origin !== new URL(allowed).origin) event.preventDefault();
  });
  window.webContents.on("destroyed", () => {
    labAi.cancelOwner(window.webContents.id);
    ptyManager.terminateForOwner(window.webContents);
    agentSessionManager.terminateForOwner(window.webContents);
  });

  if (app.isPackaged) {
    void window.loadURL(STUDIO_ORIGIN);
  } else if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
  return window;
}

app.whenReady().then(async () => {
  if (!hasLock) return;
  if (app.isPackaged) {
    await studioServer.start(path.join(__dirname, "../../dist"));
  }
  registerIpc(ptyManager, agentSessionManager, workspaceServices);
  const trusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Only the studio can use native APIs');
  };
  ipcMain.handle('studio:copy-text', (event, text: unknown) => {
    trusted(event);
    if (typeof text !== 'string' || text.length > 200_000) throw new Error('Invalid clipboard text');
    clipboard.writeText(text);
  });
  ipcMain.handle('studio:repo-root', event => { trusted(event); if (repoRoot) roots.add(repoRoot); return repoRoot; });
  // The game for one piece of work: its own loopback server (the last 2 stay running). Returns that server's origin.
  ipcMain.handle('studio:use-checkout', async (event, root: unknown) => {
    trusted(event);
    if (quitting) throw new Error('Studio is quitting.');
    if (typeof root !== 'string') throw new Error('Choose a checkout.');
    return gameServers.origin(await roots.resolve(root));
  });
  ipcMain.handle('studio:sections', async (event, input: unknown) => {
    trusted(event);
    const { root, refresh } = (input ?? {}) as { root?: unknown; refresh?: unknown };
    if (typeof root !== 'string') throw new Error('Choose a checkout.');
    return sections.get(await roots.resolve(root), refresh === true);
  });
  ipcMain.handle('studio:trim-servers', async (event, keep: unknown, root: unknown) => {
    trusted(event);
    await gameServers.trim(typeof keep === 'number' && keep >= 0 ? Math.floor(keep) : 1, typeof root === 'string' ? await roots.resolve(root) : undefined);
  });
  ipcMain.handle('studio:tune', (event, input: unknown) => { trusted(event); return labAi.run(input, event.sender.id); });
  ipcMain.on('studio:cancel', (event, id: unknown) => { trusted(event); if (typeof id === 'string') labAi.cancel(id, event.sender.id); });
  addStudioMenuItems();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => {
  dialog.showErrorBox('Studio could not start', `${String(error)}\n\nKeep the game checkout and its npm dependencies installed. Close any other Studio using ports 5174 or 5175 and try again.`);
  app.quit();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", createQuitHandler(async () => {
  quitting = true;
  studioServer.stop();
  agentSessionManager.terminateAll();
  ptyManager.terminateAll();
  // A switch may still be starting a server: stopAll drains it before the final stop.
  await gameServers.stopAll();
}, () => app.quit(), error => console.error('Studio cleanup failed', error)));
