import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import electronRenderer from "vite-plugin-electron-renderer";
import { resolve } from "node:path";

// Forme build config.
// Three processes: main (Node), renderer (Chromium), utility (worker for pptxgenjs).
// See docs/eng-plan.md §1 for rationale.
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist/main",
            sourcemap: true,
            minify: process.env.NODE_ENV === "production",
            rollupOptions: {
              external: ["better-sqlite3", "sharp", "electron"],
            },
          },
        },
        onstart(options) {
          options.startup();
        },
      },
      {
        // Utility process (for pptxgenjs — offloaded from renderer per eng-plan §1)
        entry: "src/utility/pptx-gen.ts",
        vite: {
          build: {
            outDir: "dist/utility",
            sourcemap: true,
            minify: process.env.NODE_ENV === "production",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
    electronRenderer(),
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
