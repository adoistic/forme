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

// Big-issue stress test: drives the in-app rich-text editor and the
// CSV importer through the actual UI to build a 20-article + 120-
// classified + 5-ad-position issue. This is the test you'd point at
// before any release that touches the export path.
//
// Goals:
//   1. Prove the operator can build an entire issue WITHOUT touching
//      Microsoft Word — every article goes through NewArticleModal's
//      markdown editor (paste from clipboard equivalent).
//   2. Mix English + Hindi + bilingual content so the layout, font
//      switching, and pretext sentence-split all run on real data.
//   3. Hammer every classified type with bulk CSV import — 120 entries.
//   4. Exercise every ad position: inside-front-cover, inside-back-
//      cover, back-cover, between-articles, bottom-strip.
//   5. Export and convert to PDF — assert the full flow doesn't blow
//      up on the bigger payload.

const repoRoot = process.cwd();
const FIXTURES = path.join(repoRoot, "tests/fixtures");
const ARTICLES_MD_DIR = path.join(FIXTURES, "articles-md");
const CLASSIFIEDS_CSV = path.join(FIXTURES, "classifieds", "big-issue.csv");

interface ArticleFront {
  title: string;
  byline: string;
  deck: string;
  contentType: string;
  language?: string;
  body: string;
}

async function loadArticleMd(filePath: string): Promise<ArticleFront> {
  const raw = await fs.readFile(filePath, "utf-8");
  // Strip front-matter
  const m = raw.match(/^---\n([\s\S]*?)\n---\n+([\s\S]*)$/);
  if (!m || !m[1] || !m[2]) {
    throw new Error(`bad front-matter in ${filePath}`);
  }
  const front: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const eq = line.indexOf(":");
    if (eq < 0) continue;
    front[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return {
    title: front["title"] ?? path.basename(filePath, ".md"),
    byline: front["byline"] ?? "",
    deck: front["deck"] ?? "",
    contentType: front["contentType"] ?? "Article",
    ...(front["language"] ? { language: front["language"] } : {}),
    body: m[2].trim(),
  };
}

const ADS = {
  inside_front: path.join(FIXTURES, "ads", "ifc-aurora.png"),
  inside_back: path.join(FIXTURES, "ads", "ibc-fieldnotes.png"),
  back_cover: path.join(FIXTURES, "ads", "back-saptahik.png"),
  between: path.join(FIXTURES, "ads", "between-horizon.png"),
  bottom_strip: path.join(FIXTURES, "ads", "strip-subscribe.png"),
  full_page_rust: path.join(FIXTURES, "ads", "full-page-rust.png"),
  quarter_page_gold: path.join(FIXTURES, "ads", "quarter-page-gold.png"),
};

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let documentsDir: string;

test.beforeAll(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-big-issue-ud-"));
  documentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-big-issue-docs-"));
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
  await window.waitForTimeout(400);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(documentsDir, { recursive: true, force: true }).catch(() => {});
});

test("big issue: 20 articles via NewArticleModal + 120 classifieds + every ad position", async () => {
  test.setTimeout(15 * 60_000); // 15 minutes — generous for the typing

  // 1) Create issue ────────────────────────────────────────────────
  await window.getByTestId("nav-issue-board").click();
  await window.getByTestId("create-issue-button").click();
  await window.getByTestId("create-issue-modal").waitFor({ state: "visible" });
  await window.getByTestId("create-issue-title").fill("Saptahik Weekly — Big Issue");
  await window.getByTestId("create-issue-submit").click();
  await expect(window.getByText(/new issue created/i)).toBeVisible({ timeout: 10_000 });

  // 2) For every article fixture: paste into the rich-text editor ──
  await window.getByTestId("nav-articles").click();
  const mdFiles = (await fs.readdir(ARTICLES_MD_DIR)).filter((f) => f.endsWith(".md")).sort();
  let created = 0;
  for (const file of mdFiles) {
    const article = await loadArticleMd(path.join(ARTICLES_MD_DIR, file));
    await window.getByTestId("new-article-button").click();
    await window.getByTestId("new-article-modal").waitFor({ state: "visible" });
    // Switch to markdown tab — fastest paste path
    await window.getByTestId("new-article-mode-markdown").click();
    // Headline + deck + byline
    await window.getByTestId("new-article-headline").fill(article.title);
    await window.getByTestId("new-article-deck").fill(article.deck);
    await window.getByTestId("new-article-byline").fill(article.byline);
    await window.getByTestId("new-article-content-type").selectOption(article.contentType);
    // Paste body as markdown. Use fill() — it's faster than typing
    // and matches the operator's clipboard-paste flow.
    await window.getByTestId("new-article-markdown-editor").fill(article.body);
    // Save
    await window.getByTestId("new-article-submit").click();
    await expect(window.getByTestId("new-article-modal")).toBeHidden({
      timeout: 10_000,
    });
    created += 1;
  }
  console.log(`created ${created} articles via NewArticleModal`);
  expect(created).toBeGreaterThanOrEqual(20);

  // 3) Bulk CSV: 120 classifieds across every type ─────────────────
  await window.getByTestId("nav-classifieds").click();
  await window.getByTestId("import-csv-input").setInputFiles(CLASSIFIEDS_CSV);
  await expect(window.getByText(/imported \d+/i)).toBeVisible({
    timeout: 30_000,
  });

  // 4) Upload every ad position ────────────────────────────────────
  await window.getByTestId("nav-ads").click();

  // 4a) Cover-placement uploads — full-page + strip slots, no article tie.
  const coverUploads: Array<{ label: string; slot: string; file: string }> = [
    { label: "Inside Front Cover", slot: "full_page", file: ADS.inside_front },
    { label: "Inside Back Cover", slot: "full_page", file: ADS.inside_back },
    { label: "Back Cover", slot: "full_page", file: ADS.back_cover },
    { label: "Run of Book", slot: "full_page", file: ADS.between },
    { label: "Bottom Strip", slot: "strip", file: ADS.bottom_strip },
  ];
  for (const ad of coverUploads) {
    await window.getByTestId("ad-slot-type").selectOption(ad.slot);
    // T15 (v0.6) replaced the free-text position label with structured
    // placement_kind radio buttons.
    await window.getByTestId("ad-placement-cover").check();
    await window.getByTestId("ad-upload-input").setInputFiles(ad.file);
    // Match the upload toast specifically — the page header also says
    // "N uploaded · strict aspect-ratio…", so a bare /uploaded /i regex
    // is ambiguous. The toast format is "Uploaded <filename>.<ext>."
    const expected = `Uploaded ${path.basename(ad.file)}.`;
    await expect(window.getByText(expected)).toBeVisible({ timeout: 15_000 });
    // Tiny delay so the toast clears before the next upload
    await window.waitForTimeout(400);
  }

  // 4b) T15 article-tied placements — exercise the between + bottom-of
  //     branches of placement_kind so the export pipeline gets exercised
  //     on every placement variant in the same issue. Pick the first two
  //     articles in the picker to bind the ads to.
  const articleAdUploads: Array<{
    label: string;
    slot: string;
    placementTestId: "ad-placement-between" | "ad-placement-bottom-of";
    file: string;
    articleIndex: number;
  }> = [
    {
      label: "Between articles",
      slot: "full_page",
      placementTestId: "ad-placement-between",
      file: ADS.full_page_rust,
      articleIndex: 0,
    },
    {
      label: "Bottom of article",
      slot: "quarter_page",
      placementTestId: "ad-placement-bottom-of",
      file: ADS.quarter_page_gold,
      articleIndex: 1,
    },
  ];
  for (const ad of articleAdUploads) {
    await window.getByTestId("ad-slot-type").selectOption(ad.slot);
    await window.getByTestId(ad.placementTestId).check();
    // The article picker only shows up after a non-cover placement is
    // selected. Wait for it, then pick the Nth real option (skip the
    // "Choose an article..." placeholder at index 0).
    const picker = window.getByTestId("ad-placement-article");
    await picker.waitFor({ state: "visible", timeout: 5_000 });
    const optionValues = await picker.evaluate((sel) =>
      Array.from((sel as HTMLSelectElement).options)
        .map((o) => o.value)
        .filter((v) => v !== "")
    );
    const articleId = optionValues[ad.articleIndex] ?? optionValues[0];
    if (!articleId) throw new Error(`no articles available for ${ad.label}`);
    await picker.selectOption(articleId);
    await window.getByTestId("ad-upload-input").setInputFiles(ad.file);
    const expected = `Uploaded ${path.basename(ad.file)}.`;
    await expect(window.getByText(expected)).toBeVisible({ timeout: 15_000 });
    await window.waitForTimeout(400);
  }

  // 5) Export ──────────────────────────────────────────────────────
  // T17 — dialog shimmed via FORME_TEST_DOCUMENTS_DIR; toast now says
  // "Exported to <filename>".
  await window.getByTestId("nav-issue-board").click();
  await window.getByTestId("export-issue-button").click();
  await expect(window.getByText(/exported to /i)).toBeVisible({
    timeout: 5 * 60_000,
  });

  // 6) Find the .pptx, convert + rasterize ─────────────────────────
  const exportRoot = path.join(documentsDir, "Forme");
  const files = await fs.readdir(exportRoot).catch(() => []);
  const pptx = files.find((f) => f.endsWith(".pptx"));
  expect(pptx).toBeTruthy();
  const outDir = path.join(repoRoot, "test-results/big-issue");
  await fs.mkdir(outDir, { recursive: true });
  const pptxPath = path.join(outDir, pptx!);
  await fs.copyFile(path.join(exportRoot, pptx!), pptxPath);
  const pdfPath = await sofficeToPdf(pptxPath, outDir);
  await rasterizePdf(pdfPath, outDir, "page");
  const pages = (await fs.readdir(outDir))
    .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
    .sort();
  console.log(`big-issue: ${pages.length} rasterized pages`);
  // Sanity: 20 articles × ~3 pages min = 60+ pages, plus cover/TOC/ads/classifieds
  expect(pages.length).toBeGreaterThanOrEqual(60);
});

async function sofficeToPdf(pptxPath: string, outDir: string): Promise<string> {
  const candidates = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "soffice",
  ];
  let soffice: string | null = null;
  for (const c of candidates) {
    try {
      await fs.access(c);
      soffice = c;
      break;
    } catch {
      // continue
    }
  }
  if (!soffice) throw new Error("soffice not found");
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
  const pdf = path.join(outDir, `${base}.pdf`);
  await fs.access(pdf);
  return pdf;
}

async function rasterizePdf(pdfPath: string, outDir: string, prefix: string): Promise<void> {
  await runCmd("pdftoppm", ["-png", "-r", "100", pdfPath, path.join(outDir, prefix)]);
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
