import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";

// Phase 0 smoke test per docs/eng-plan.md §1: launches the packaged Electron
// app in dev mode, verifies the window opens, the 8-tab sidebar renders, and
// nav clicks change the active tab.
//
// Local-only gate per eng-plan §1 (font antialiasing differs across machines
// so pixel-diff screenshots are unreliable on CI). Run via:
//   bun run test:e2e

// Playwright runs from the repo root by default.
const repoRoot = process.cwd();

let app: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  // Launch via the dev entry. vite-plugin-electron builds dist/main/index.js
  // before the Electron process spawns; for this test we rely on a prior
  // `bun run build` OR invoke the dev server directly.
  const mainEntry = path.join(repoRoot, "dist/main/index.js");
  app = await electron.launch({
    args: [mainEntry],
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });
  window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
});

test("main window opens and renders the Issue Board shell", async () => {
  const title = await window.title();
  expect(title.toLowerCase()).toContain("forme");

  // Sidebar nav is visible — all 8 tabs present
  const navIds = [
    "issue-board",
    "articles",
    "classifieds",
    "ads",
    "images",
    "templates",
    "history",
    "settings",
  ];
  for (const id of navIds) {
    const item = window.getByTestId(`nav-${id}`);
    await expect(item).toBeVisible();
  }

  // Auto-save indicator visible in canvas header
  await expect(window.getByTestId("autosave-indicator")).toBeVisible();

  // Export button present in sidebar footer (disabled in Phase 0)
  const exportBtn = window.getByTestId("export-button");
  await expect(exportBtn).toBeVisible();
  await expect(exportBtn).toBeDisabled();
});

test("clicking a tab changes the active surface", async () => {
  // Start on Issue Board — "Check my issue" button should be present
  await expect(window.getByTestId("check-my-issue-button")).toBeVisible();

  // Click Articles tab
  await window.getByTestId("nav-articles").click();

  // Issue Board's "Check my issue" is no longer rendered
  await expect(window.getByTestId("check-my-issue-button")).toHaveCount(0);

  // Articles empty state should be visible via its label text
  await expect(window.getByText(/drop your first article/i)).toBeVisible();
});

test("classifieds tab renders its empty state", async () => {
  await window.getByTestId("nav-classifieds").click();
  await expect(window.getByText(/add your first classified/i)).toBeVisible();
});

test("can navigate back to Issue Board", async () => {
  await window.getByTestId("nav-articles").click();
  await window.getByTestId("nav-issue-board").click();
  await expect(window.getByTestId("check-my-issue-button")).toBeVisible();
});
