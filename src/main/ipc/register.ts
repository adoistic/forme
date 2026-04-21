import type { IpcMain } from "electron";
import { createLogger } from "../logger.js";
import { fromUnknown } from "@shared/errors/structured.js";
import type { Result } from "@shared/ipc-contracts/result.js";
import { ok, err } from "@shared/ipc-contracts/result.js";

const logger = createLogger("ipc");

type Handler<P, R> = (payload: P) => Promise<R> | R;
const registry = new Map<string, Handler<unknown, unknown>>();

/**
 * Central IPC wrapper per docs/eng-plan.md §1.
 * Every handler is wrapped in error-catching middleware that:
 *   1. Logs context (handler channel, args summary, stack)
 *   2. Converts raw throws into StructuredError
 *   3. Returns Result<T> to the renderer
 *
 * Raw throws never cross the IPC boundary.
 */
export function addHandler<P, R>(channel: string, handler: Handler<P, R>): void {
  if (registry.has(channel)) {
    throw new Error(`IPC handler already registered: ${channel}`);
  }
  registry.set(channel, handler as Handler<unknown, unknown>);
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  // Register a single dispatcher; all handlers go through this.
  ipcMain.handle("forme:dispatch", async (_event, payload: unknown): Promise<Result<unknown>> => {
    if (!payload || typeof payload !== "object" || !("channel" in payload)) {
      return err({
        code: "ipc_handler_missing",
        severity: "error",
        context: { reason: "malformed payload" },
      });
    }

    const { channel, data } = payload as { channel: string; data: unknown };
    const handler = registry.get(channel);

    if (!handler) {
      logger.warn({ channel }, "No IPC handler registered");
      return err({
        code: "ipc_handler_missing",
        severity: "error",
        context: { channel },
      });
    }

    try {
      const result = await handler(data);
      return ok(result);
    } catch (thrown: unknown) {
      const structured = fromUnknown(thrown, "ipc_handler_threw");
      logger.error({ channel, code: structured.code, context: structured.context }, "IPC handler threw");
      return err(structured);
    }
  });

  // Register a health-check channel for tests + diagnostics
  addHandler("ping", (_payload: unknown) => ({ pong: true, t: Date.now() }));
}
