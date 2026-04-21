import type {
  ChannelMap,
  ChannelName,
} from "@shared/ipc-contracts/channels.js";
import type { Result } from "@shared/ipc-contracts/result.js";
import type { StructuredError } from "@shared/errors/structured.js";

// Renderer-side typed IPC client.
// window.forme.invoke returns a Result<T>; callers get data on ok or throw
// StructuredError on err. The renderer then displays the user-message via
// the shared error registry.

export class IpcError extends Error {
  constructor(public structured: StructuredError) {
    super(structured.code);
    this.name = "IpcError";
  }
}

export async function invoke<C extends ChannelName>(
  channel: C,
  data: ChannelMap[C]["request"]
): Promise<ChannelMap[C]["response"]> {
  const response = (await window.forme.invoke<Result<ChannelMap[C]["response"]>>(
    "forme:dispatch",
    { channel, data }
  )) as Result<ChannelMap[C]["response"]>;

  if (!response.ok) {
    throw new IpcError(response.error);
  }
  return response.data;
}
