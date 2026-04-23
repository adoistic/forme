import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "out", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/**/types.ts",
        "src/renderer/**", // renderer tested via Playwright
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    environmentMatchGlobs: [
      ["tests/integration/renderer/**", "jsdom"],
      ["tests/unit/components/**", "jsdom"],
    ],
  },
  resolve: {
    alias: {
      "@main": resolve(__dirname, "src/main"),
      "@renderer": resolve(__dirname, "src/renderer"),
      "@utility": resolve(__dirname, "src/utility"),
      "@shared": resolve(__dirname, "src/shared"),
      "@templates": resolve(__dirname, "templates"),
      "@tests": resolve(__dirname, "tests"),
    },
  },
});
