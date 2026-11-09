import { app, BrowserWindow, Menu, MenuItem, nativeImage, shell } from "electron";
import path from "node:path";
import { AgentSessionManager } from "./agent-session-manager";
import { CommitMessages } from "./internal-ai/commit-message";
import { InternalAiService } from "./internal-ai/internal-ai-service";
import { registerIpc } from "./ipc";
import { ClaudeAgentProvider } from "./providers/claude-agent-provider";
import { CodexAgentProvider } from "./providers/codex-agent-provider";
import { GitSourceControlProvider } from "./providers/git-source-control-provider";
import { PromptAttachments, THUMBNAIL_SIDE } from "./prompt-attachments";
import { PtyManager } from "./pty-manager";
import { adoptLoginShellPath } from "./shell-environment";
import { IPC } from "../shared/ipc";
import type { MenuCommand } from "../shared/models";
import { SourceControlService } from "./source-control/source-control-provider";
import { WorkspaceFiles, WorkspaceRoots } from "./workspace-files";

if (process.env.WORKBENCH_USER_DATA_DIR) app.setPath("userData", process.env.WORKBENCH_USER_DATA_DIR);
if (app.isPackaged) adoptLoginShellPath();

/** Scales a PNG or JPEG so its shorter side fills a thumbnail; null for what nativeImage can't decode. */
function shrinkPicture(bytes: Buffer): string | null {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (Math.min(width, height) <= THUMBNAIL_SIDE) return image.toDataURL();
  return image.resize(width < height ? { width: THUMBNAIL_SIDE, quality: "good" } : { height: THUMBNAIL_SIDE, quality: "good" }).toDataURL();
}

const ptyManager = new PtyManager();
const attachments = new PromptAttachments(() => path.join(app.getPath("userData"), "attachments"), shrinkPicture);
const agentProviders = [new CodexAgentProvider(), new ClaudeAgentProvider()];
const agentSessionManager = new AgentSessionManager(agentProviders, undefined, (viewId) => attachments.folderFor(viewId));
const internalAi = new InternalAiService(agentProviders, () => path.join(app.getPath("userData"), "internal-ai"));
const roots = new WorkspaceRoots();
const sourceControl = new SourceControlService([new GitSourceControlProvider()]);
const workspaceServices = {
  roots,
  files: new WorkspaceFiles(roots, (target) => shell.trashItem(target)),
  sourceControl,
  commitMessages: new CommitMessages(sourceControl, internalAi),
};

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
      sandbox: false,
      backgroundThrottling: !qaHidden,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const allowed = process.env.VITE_DEV_SERVER_URL;
    if (!allowed || new URL(url).origin !== new URL(allowed).origin) event.preventDefault();
  });
  window.webContents.on("destroyed", () => {
    ptyManager.terminateForOwner(window.webContents);
    agentSessionManager.terminateForOwner(window.webContents);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
  return window;
}

app.whenReady().then(() => {
  if (process.env.WORKBENCH_QA_HIDDEN === "1") app.dock?.hide();
  registerIpc(ptyManager, agentSessionManager, workspaceServices, attachments);
  addMenuItems();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  internalAi.terminateAll();
  agentSessionManager.terminateAll();
  ptyManager.terminateAll();
});
