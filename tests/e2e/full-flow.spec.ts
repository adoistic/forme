import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";

// Full-flow E2E per user ask: "test everything end to end, each and every
// page." Drives the real Electron UI through the critical path:
//
//   Create issue → Import 3 Wikipedia-derived .docx → Add a classified →
//   Upload an ad image → Export PPTX → Convert to PDF via LibreOffice →
//   Rasterize every page to PNG so we (and future CI) can inspect the
//   actual print-ready output.
//
// Fixtures under tests/fixtures/ (articles/ads/classifieds) are built by
// scripts/build-fixtures.ts. Run them together:
//   bun scripts/build-fixtures.ts && bun run test:e2e

const repoRoot = process.cwd();
const FIXTURES = path.join(repoRoot, "tests/fixtures");
const ARTICLES = [
  "chandrayaan-3.docx",
  "typography.docx",
  "movable-type.docx",
].map((f) => path.join(FIXTURES, "articles", f));
const AD_IMAGE = path.join(FIXTURES, "ads", "full-page-rust.png");

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let documentsDir: string;

test.beforeAll(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-full-e2e-ud-"));
  // Redirect the "documents" path so export:pptx lands in a scratch dir
  // instead of ~/Documents/Forme. The main process uses app.getPath("documents").
  // We hand an override via env, and main/app-state.ts honors it if set.
  documentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-full-e2e-docs-"));
  const mainEntry = path.join(repoRoot, "dist/main/index.js");

  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      FORME_TEST_DOCUMENTS_DIR: documentsDir,
    },
    timeout: 30_000,
  });
  window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(300);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(documentsDir, { recursive: true, force: true }).catch(() => {});
});

test("full flow: create issue → import docs → add classified → upload ad → export PPTX", async () => {
  // 1) Create an issue ────────────────────────────────────────────────
  await window.getByTestId("nav-issue-board").click();
  await window.getByTestId("create-issue-button").click();
  await window.getByTestId("create-issue-modal").waitFor({ state: "visible" });
  await window.getByTestId("create-issue-title").fill("Saptahik Weekly — QA Run");
  await window.getByTestId("create-issue-submit").click();
  // Success toast proves the IPC round-trip
  await expect(window.getByText(/new issue created/i)).toBeVisible({ timeout: 10_000 });

  // 2) Import 3 Wikipedia articles via the hidden file input ────────
  await window.getByTestId("nav-articles").click();
  await window.getByTestId("import-docx-input").setInputFiles(ARTICLES);
  // Each import round-trips through IPC + blob store + mammoth. Allow time.
  await expect(window.getByText(/imported 3 articles/i)).toBeVisible({
    timeout: 45_000,
  });

  // 3) Add one classified via the JSON view (type-agnostic path) ─────
  await window.getByTestId("nav-classifieds").click();
  await window.getByTestId("add-classified-button").click();
  await window.getByRole("button", { name: /obituary/i }).click();
  await window.getByTestId("add-classified-modal").waitFor({ state: "visible" });
  await window.getByRole("button", { name: /JSON view/i }).click();
  const jsonTextarea = window.locator('textarea').first();
  await jsonTextarea.fill(
    JSON.stringify({
      name_of_deceased: "R. Sharma",
      date_of_death: "2026-04-18",
      age: 84,
      life_summary:
        "A printer, teacher, and community organizer who spent forty years at the local press.",
      surviving_family: "Wife Meena, two daughters, five grandchildren.",
      prayer_meeting: "Lodhi Crematorium, 23 April 2026, 11 AM.",
    })
  );
  await window.getByTestId("classified-submit").click();
  // Modal closes on save — use that as the signal
  await expect(window.getByTestId("add-classified-modal")).toBeHidden({
    timeout: 10_000,
  });

  // 4) Upload one ad image ──────────────────────────────────────────
  await window.getByTestId("nav-ads").click();
  await window.getByTestId("ad-slot-type").selectOption("full_page");
  await window.getByTestId("ad-upload-input").setInputFiles(AD_IMAGE);
  await expect(window.getByText(/uploaded /i)).toBeVisible({ timeout: 15_000 });

  // 5) Export from the Issue Board header ───────────────────────────
  await window.getByTestId("nav-issue-board").click();
  await window.getByTestId("export-issue-button").click();
  await expect(window.getByText(/exported.*pages/i)).toBeVisible({
    timeout: 60_000,
  });

  // 6) Find the exported .pptx ──────────────────────────────────────
  const exportRoot = path.join(documentsDir, "Forme");
  const files = await fs.readdir(exportRoot).catch(() => []);
  const pptx = files.find((f) => f.endsWith(".pptx"));
  expect(pptx, `expected a .pptx in ${exportRoot}`).toBeTruthy();
  const pptxPath = path.join(exportRoot, pptx!);
  const stat = await fs.stat(pptxPath);
  expect(stat.size).toBeGreaterThan(5_000);

  // 7) Convert to PDF via LibreOffice, rasterize every page ─────────
  const outDir = path.join(repoRoot, "test-results/full-flow");
  await fs.mkdir(outDir, { recursive: true });
  const pdfPath = await sofficeToPdf(pptxPath, outDir);
  expect(pdfPath).toBeTruthy();
  await rasterizePdf(pdfPath, outDir, "page");
  const pages = (await fs.readdir(outDir))
    .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
    .sort();
  console.log("rasterized pages:", pages);
  expect(pages.length).toBeGreaterThanOrEqual(1);
});

async function sofficeToPdf(pptxPath: string, outDir: string): Promise<string> {
  const soffice = await findSoffice();
  if (!soffice) throw new Error("soffice not found");
  // Unique profile to avoid "another LibreOffice is running" lock errors
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "lo-profile-"));
  await runCmd(soffice, [
    `-env:UserInstallation=file://${profile}`,
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outDir,
    pptxPath,
  ]);
  const base = path.basename(pptxPath, ".pptx");
  const pdfPath = path.join(outDir, `${base}.pdf`);
  await fs.access(pdfPath);
  return pdfPath;
}

async function rasterizePdf(
  pdfPath: string,
  outDir: string,
  prefix: string
): Promise<void> {
  await runCmd("pdftoppm", ["-png", "-r", "110", pdfPath, path.join(outDir, prefix)]);
}

async function findSoffice(): Promise<string | null> {
  const candidates = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "soffice",
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // keep scanning
    }
  }
  return null;
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "pipe" });
    let stderr = "";
    p.stderr?.on("data", (d) => (stderr += d));
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${stderr}`))
    );
  });
}
