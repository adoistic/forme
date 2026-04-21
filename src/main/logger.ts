import pino from "pino";
import path from "node:path";
import { app } from "electron";

// Structured logger per docs/eng-plan.md §1 observability.
// Writes to ~/Library/Logs/Forme/ on macOS (7-day rotation handled by OS via file size checks).
// No remote telemetry — local only.

let baseLogger: pino.Logger | null = null;

function getBaseLogger(): pino.Logger {
  if (baseLogger) return baseLogger;

  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const logDir = app.isReady() ? path.join(app.getPath("logs"), "forme.log") : undefined;

  baseLogger = pino(
    {
      level: isDev ? "debug" : "info",
      base: {
        version: app.isReady() ? app.getVersion() : "unknown",
        pid: process.pid,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    isDev
      ? pino.transport({
          target: "pino-pretty",
          options: { colorize: true, ignore: "pid,hostname" },
        })
      : logDir
        ? pino.destination({ dest: logDir, sync: false, mkdir: true })
        : undefined
  );

  return baseLogger;
}

export function createLogger(component: string): pino.Logger {
  return getBaseLogger().child({ component });
}
