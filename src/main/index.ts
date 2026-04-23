import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { createLogger } from "./logger.js";
import { registerIpcHandlers } from "./ipc/register.js";
import { registerIssueHandlers } from "./ipc/handlers/issue.js";
import { registerArticleHandlers } from "./ipc/handlers/article.js";
import { registerClassifiedHandlers } from "./ipc/handlers/classified.js";
import { registerAdHandlers } from "./ipc/handlers/ad.js";
import { registerPublisherHandlers } from "./ipc/handlers/publisher.js";
import { registerExportHandlers } from "./ipc/handlers/export.js";
import { registerSnapshotHandlers } from "./ipc/handlers/snapshot.js";
import { registerDiskUsageHandlers } from "./ipc/handlers/disk-usage.js";
import { registerStorageHandlers } from "./ipc/handlers/storage.js";
import { registerReorderHandlers } from "./ipc/handlers/reorder.js";
import { registerHeroUploadHandlers } from "./ipc/handlers/hero-upload.js";
import { handleSecondInstance } from "./crash-recovery/single-instance.js";
import { bootstrap } from "./app-state.js";

// In CJS bundled output, __dirname is auto-injected by Node. Declare it for
// TypeScript so strict mode doesn't choke.
declare const __dirname: string;

const logger = createLogger("main");

// Per docs/eng-plan.md §6 — wire the second-instance handler so that
// double-clicking the app icon while it's already running raises the
// existing window instead of silently exiting.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.info("Second instance rejected; existing window will raise.");
  app.quit();
} else {
  app.on("second-instance", handleSecondInstance);
}

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  // Honor the macOS work area (screen minus menu bar minus Dock). Asking for
  // 900px on a 13" MacBook (~845px work area) pushes the window behind the
  // Dock, so its bottom edge — and any controls in it — become unclickable.
  const { workAreaSize } = screen.getPrimaryDisplay();
  const margin = 32;
  const width = Math.min(1440, workAreaSize.width - margin);
  const height = Math.min(900, workAreaSize.height - margin);
  const minWidth = Math.min(1280, width);
  const minHeight = Math.min(800, height);

  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    center: true,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#F5EFE7",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // sharp native module needs non-sandboxed main
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    // Open devtools only in dev builds
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

void app.whenReady().then(async () => {
  logger.info({ version: app.getVersion(), platform: process.platform }, "Forme starting");

  // Bootstrap DB + blob store + snapshots + templates
  await bootstrap();

  // Register domain handlers BEFORE the generic dispatcher is wired
  registerIssueHandlers();
  registerArticleHandlers();
  registerClassifiedHandlers();
  registerAdHandlers();
  registerPublisherHandlers();
  registerExportHandlers();
  registerSnapshotHandlers();
  registerDiskUsageHandlers();
  registerStorageHandlers();
  registerReorderHandlers();
  registerHeroUploadHandlers();

  registerIpcHandlers(ipcMain);

  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Export for tests that need a handle to the main window
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
