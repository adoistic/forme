// Preload script: minimal surface, typed IPC only.
// See src/shared/ipc-contracts/ for the schema.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("forme", {
  invoke<T>(channel: string, payload: unknown): Promise<T> {
    return ipcRenderer.invoke(channel, payload) as Promise<T>;
  },
  on(channel: string, listener: (...args: unknown[]) => void) {
    const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform,
});
