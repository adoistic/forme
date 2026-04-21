import pino from "pino";
import path from "node:path";

// Structured logger per docs/eng-plan.md §1 observability.
// Writes to ~/Library/Logs/Forme/ on macOS in prod.
// No remote telemetry — local only.
//
// Designed to be import-safe outside Electron (tests, CLI tools) — the
// `electron.app` reference is resolved lazily and guarded.

let baseLogger: pino.Logger | null = null;

interface AppShape {
  isReady(): boolean;
  getVersion(): string;
  getPath(name: "logs"): string;
}

function tryGetApp(): AppShape | null {
  try {
    // Dynamic-ish import: if we're inside Electron's main process,
    // 'electron' resolves and `.app` is defined.
    // In node tests, require('electron') throws or returns a string path.
    const mod = require("electron") as { app?: AppShape };
    return mod.app ?? null;
  } catch {
    return null;
  }
}

function getBaseLogger(): pino.Logger {
  if (baseLogger) return baseLogger;

  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const electronApp = tryGetApp();
  const ready = electronApp?.isReady() === true;
  const logPath = ready ? path.join(electronApp!.getPath("logs"), "forme.log") : undefined;

  // Prefer silent logger in tests to keep Vitest output clean
  if (isTest) {
    baseLogger = pino({ level: "silent", base: { pid: process.pid } });
    return baseLogger;
  }

  baseLogger = pino(
    {
      level: isDev ? "debug" : "info",
      base: {
        version: ready ? electronApp!.getVersion() : "unknown",
        pid: process.pid,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    isDev
      ? pino.transport({
          target: "pino-pretty",
          options: { colorize: true, ignore: "pid,hostname" },
        })
      : logPath
        ? pino.destination({ dest: logPath, sync: false, mkdir: true })
        : undefined
  );

  return baseLogger;
}

export function createLogger(component: string): pino.Logger {
  return getBaseLogger().child({ component });
}
