import { resolveMessage } from "@shared/errors/registry.js";
import { IpcError } from "../ipc/client.js";

/**
 * Convert any thrown value into an operator-readable message.
 * For StructuredError (via IpcError), pulls from the registry with substitutions.
 * For everything else, fall back to a generic message.
 */
export function describeError(thrown: unknown): string {
  if (thrown instanceof IpcError) {
    return resolveMessage(thrown.structured.code, thrown.structured.context);
  }
  if (thrown instanceof Error) return thrown.message;
  return "Something went wrong.";
}
