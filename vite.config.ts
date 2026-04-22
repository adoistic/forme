import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { resolve } from "node:path";

// Forme build config.
// Three processes: main (Node), renderer (Chromium), utility (worker for pptxgenjs).
// Using vite-plugin-electron/simple which emits CJS for main + preload (required
// for Electron to load them without "type": "module" contortions) and keeps
// the renderer as ESM.
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist/main",
            sourcemap: true,
            minify: process.env.NODE_ENV === "production",
            rollupOptions: {
              external: [
                "better-sqlite3",
                "sharp",
                "@napi-rs/canvas",
                // pino spawns worker threads for transports (pino-pretty,
                // pino-worker etc.) and resolves the worker path
                // relative to its own dist. When bundled, the path
                // collapses into dist/main/lib/worker.js which doesn't
                // exist — Electron crashes on first log call. Keep pino
                // (and pino-pretty) external so they load from
                // node_modules with their full file structure intact.
                "pino",
                "pino-pretty",
                "@chenglou/pretext",
                "electron",
                /^node:/,
              ],
            },
          },
        },
      },
      preload: {
        input: "src/main/preload.cts",
        vite: {
          build: {
            outDir: "dist/main",
            sourcemap: true,
            minify: process.env.NODE_ENV === "production",
            rollupOptions: {
              external: ["electron", /^node:/],
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@main": resolve(__dirname, "src/main"),
      "@renderer": resolve(__dirname, "src/renderer"),
      "@utility": resolve(__dirname, "src/utility"),
      "@shared": resolve(__dirname, "src/shared"),
      "@templates": resolve(__dirname, "templates"),
    },
  },
  build: {
    outDir: "dist/renderer",
    sourcemap: true,
  },
  server: {
    port: 5175,
    strictPort: false,
  },
});
