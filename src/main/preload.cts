// Preload script: minimal surface, typed IPC only.
// See src/shared/ipc-contracts/ for the schema.
import { contextBridge, ipcRenderer } from "electron";

interface DiskUsage {
  snapshots: number;
  blobs: number;
  total: number;
}

contextBridge.exposeInMainWorld("forme", {
  invoke<T>(channel: string, payload: unknown): Promise<T> {
    return ipcRenderer.invoke(channel, payload) as Promise<T>;
  },
  on(channel: string, listener: (...args: unknown[]) => void) {
    const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  // Convenience subscription for the unified disk-usage-changed event the
  // main process broadcasts after any snapshot/blob mutation. Returns an
  // unsubscribe function so callers can clean up on unmount.
  onDiskUsageChanged(cb: (usage: DiskUsage) => void): () => void {
    const handler = (_event: unknown, usage: DiskUsage) => cb(usage);
    ipcRenderer.on("disk-usage-changed", handler);
    return () => {
      ipcRenderer.removeListener("disk-usage-changed", handler);
    };
  },
  platform: process.platform,
});
