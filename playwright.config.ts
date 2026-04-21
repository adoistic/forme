import { defineConfig } from "@playwright/test";

// Playwright Electron E2E config.
// LOCAL-ONLY GATE per eng-plan.md §1 — font antialiasing differs across CI machines
// and breaks pixel-diff. Run via `bun run test:e2e` on the dev machine.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Electron process can't be concurrently launched
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  expect: {
    // Allow tolerance for font antialiasing in pixel screenshots
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
  },
});
