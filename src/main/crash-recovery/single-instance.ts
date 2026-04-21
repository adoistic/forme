import { BrowserWindow } from "electron";
import { createLogger } from "../logger.js";

const logger = createLogger("single-instance");

// Per docs/eng-plan.md §6 — second-launch should raise the existing window,
// NOT silently exit. This was a named critical gap in the eng review.
export function handleSecondInstance(
  _event: Electron.Event,
  _argv: string[],
  _workingDir: string
): void {
  logger.info("Second instance detected; raising main window.");
  const windows = BrowserWindow.getAllWindows();
  const main = windows[0];
  if (!main) {
    logger.warn("No windows to raise on second-instance; creating one.");
    return;
  }
  if (main.isMinimized()) main.restore();
  main.focus();
}
