import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createLogger } from "./logger.js";
import { registerIpcHandlers } from "./ipc/register.js";
import { handleSecondInstance } from "./crash-recovery/single-instance.js";

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
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
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

void app.whenReady().then(() => {
  logger.info({ version: app.getVersion(), platform: process.platform }, "Forme starting");

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
