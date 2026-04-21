import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

// E2E smoke test per docs/eng-plan.md §1: launches the packaged Electron app,
// walks the shell, and hits a happy path (create issue → switch tabs → see the
// empty drop zones come alive). Local-only (font antialiasing differs across
// machines, pixel diff unreliable on CI). Run via:
//   bun run test:e2e

const repoRoot = process.cwd();

let app: ElectronApplication;
let window: Page;
// Use a throwaway userData dir so the test never stomps on real user state.
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-e2e-"));
  const mainEntry = path.join(repoRoot, "dist/main/index.js");
  // Electron honors --user-data-dir as a CLI switch (see electron command-line
  // switches docs). Point it at a scratch dir so the test never touches real
  // app state in ~/Library/Application Support/Forme.
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
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
  await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
});

test("main window opens and renders the 8-tab shell", async () => {
  const title = await window.title();
  expect(title.toLowerCase()).toContain("forme");

  // All 8 sidebar tabs present
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
    await expect(window.getByTestId(`nav-${id}`)).toBeVisible();
  }

  // Sidebar export button is present, disabled when no issue exists yet
  const exportBtn = window.getByTestId("export-button");
  await expect(exportBtn).toBeVisible();
  await expect(exportBtn).toBeDisabled();

  // IssueBoard header autosave indicator is present
  await expect(window.getByTestId("autosave-indicator")).toBeVisible();
});

test("Issue Board shows the no-issue CTA", async () => {
  await window.getByTestId("nav-issue-board").click();
  await expect(window.getByTestId("create-issue-button")).toBeVisible();
  await expect(window.getByText(/let.?s set up your first issue/i)).toBeVisible();
});

test("Articles tab without an issue prompts the user to create one", async () => {
  await window.getByTestId("nav-articles").click();
  // "Create an issue first." when no issue exists — not the drop zone
  await expect(window.getByText(/create an issue first/i)).toBeVisible();
});

test("Classifieds tab renders its empty state", async () => {
  await window.getByTestId("nav-classifieds").click();
  await expect(window.getByText(/add your first classified/i)).toBeVisible();
  await expect(window.getByTestId("add-classified-button")).toBeVisible();
});

test("Settings tab renders the publisher profile form", async () => {
  await window.getByTestId("nav-settings").click();
  // Profile form has a visible heading — use text match rather than test-id
  // to confirm the screen actually mounts.
  await expect(window.getByText(/publisher profile/i)).toBeVisible();
});

test("can navigate back to Issue Board after visiting other tabs", async () => {
  await window.getByTestId("nav-articles").click();
  await window.getByTestId("nav-issue-board").click();
  await expect(window.getByTestId("create-issue-button")).toBeVisible();
});

// Visual-regression shots written to test-results/screenshots/. Eyeball these
// when bumping tokens, tweaking the modal, or onboarding new contributors.
test("screenshots: issue board + create-issue modal + classifieds + settings", async () => {
  const outDir = path.join(repoRoot, "test-results/screenshots");
  await fs.mkdir(outDir, { recursive: true });

  await window.getByTestId("nav-issue-board").click();
  await window.waitForTimeout(200);
  await window.screenshot({ path: path.join(outDir, "01-issue-board.png"), fullPage: true });

  await window.getByTestId("create-issue-button").click();
  await expect(window.getByTestId("create-issue-modal")).toBeVisible();
  await window.waitForTimeout(200);
  await window.screenshot({ path: path.join(outDir, "02-create-issue-modal.png"), fullPage: true });
  await window.getByTestId("create-issue-cancel").click();

  await window.getByTestId("nav-classifieds").click();
  await window.waitForTimeout(200);
  await window.screenshot({ path: path.join(outDir, "03-classifieds.png"), fullPage: true });

  await window.getByTestId("nav-settings").click();
  await window.waitForTimeout(200);
  await window.screenshot({ path: path.join(outDir, "04-settings.png"), fullPage: true });
});
