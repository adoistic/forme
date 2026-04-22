/// <reference types="vite/client" />

// Global `forme` API exposed from preload via contextBridge.
declare global {
  interface Window {
    forme: {
      invoke<T>(channel: string, payload: unknown): Promise<T>;
      on(channel: string, listener: (...args: unknown[]) => void): () => void;
      onDiskUsageChanged(
        cb: (usage: { snapshots: number; blobs: number; total: number }) => void
      ): () => void;
      platform: NodeJS.Platform;
    };
  }
}

// Allow side-effect CSS imports (globals.css, etc.)
declare module "*.css";
declare module "*.png";
declare module "*.svg";
declare module "*.jpg";
declare module "*.jpeg";

export {};
