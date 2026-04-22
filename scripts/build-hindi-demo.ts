// Mini-issue with just the Hindi-only and bilingual articles, so they
// can be benchmarked in isolation without scrolling through the full
// 29-page issue. Drives the same builder + pretext + Mukta path as the
// full export — only the issue contents differ.
//
// Run: bun scripts/build-hindi-demo.ts

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { buildPptx } from "../src/shared/pptx-builder/build.js";
import { loadTemplateFile } from "../src/main/templates/loader.js";
import { parseDocx } from "../src/main/docx-ingest/parse.js";
import { preLayoutForTemplate } from "../src/main/pptx-prelayout/layout.js";
import { validatePptx } from "../src/main/ooxml-validator/libreoffice.js";

const repoRoot = process.cwd();
const FIXTURES = path.join(repoRoot, "tests/fixtures/articles");
const OUT_DIR = "/tmp/forme-hindi-demo";

interface ArticleSpec {
  slug: string;
  byline: string;
  deck: string;
  contentType: "Article" | "Photo Essay";
}

const ARTICLES: ArticleSpec[] = [
  {
    slug: "kabir-hindi",
    byline: "लेखक — क्यूए परीक्षक",
    deck: "एक संत-कवि का जीवन और काव्य।",
    contentType: "Article",
  },
  {
    slug: "delhi-bilingual",
    byline: "By QA Harness · क्यूए परीक्षक",
    deck:
      "A bilingual feature: English Wikipedia introduction followed by a Hindi Wikipedia passage on the same subject.",
    contentType: "Article",
  },
];

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const featureTemplate = await loadTemplateFile(
    path.join(repoRoot, "templates/standard-feature-a4.json")
  );

  const placements = [];
  let nextPage = 1;
  for (const a of ARTICLES) {
    const buf = await fs.readFile(path.join(FIXTURES, `${a.slug}.docx`));
    const parsed = await parseDocx(buf);
    const language = parsed.language;
    console.log(
      `${a.slug}: language=${language}, headline="${parsed.headline}", byline="${parsed.byline ?? "(none)"}", deck="${parsed.deck ?? "(none)"}", body chars=${parsed.body.length}`
    );

    const prelaidPages = await preLayoutForTemplate({
      body: parsed.body,
      language,
      hasDeck: !!parsed.deck,
      hasTopByline: !!parsed.byline,
      hasHero: false,
      template: {
        trim_mm: featureTemplate.geometry.trim_mm,
        margins_mm: featureTemplate.geometry.margins_mm,
        columns: featureTemplate.geometry.columns,
        gutter_mm: featureTemplate.geometry.gutter_mm,
        typography: {
          headline_pt: featureTemplate.typography.headline_pt,
          ...(featureTemplate.typography.deck_pt !== undefined
            ? { deck_pt: featureTemplate.typography.deck_pt }
            : {}),
          body_pt: featureTemplate.typography.body_pt,
          body_leading_pt: featureTemplate.typography.body_leading_pt,
        },
        page_count_range: featureTemplate.page_count_range,
      },
    });

    placements.push({
      articleId: a.slug,
      template: featureTemplate,
      startingPageNumber: nextPage,
      article: {
        headline: parsed.headline,
        deck: parsed.deck,
        byline: parsed.byline,
        bylinePosition: "top" as const,
        body: parsed.body,
        language,
        section: "Features",
        prelaidPages,
      },
    });
    nextPage += Math.max(prelaidPages.length, featureTemplate.page_count_range[0]);
  }

  const pptxPath = path.join(OUT_DIR, "hindi-demo.pptx");
  const result = await buildPptx(
    {
      issueTitle: "Hindi & Bilingual Demo",
      issueNumber: 1,
      issueDate: "2026-04-22",
      publicationName: "Saptahik Weekly",
      placements,
      coverLines: ARTICLES.map((a) => a.slug.replace(/-/g, " ")),
    },
    pptxPath
  );
  console.log(`built ${result.pageCount} pages → ${pptxPath}`);

  // Convert + rasterize
  const v = await validatePptx({ pptxPath });
  if (!v.valid || !v.pdfPath) {
    throw new Error(`validate failed: ${JSON.stringify(v)}`);
  }
  const pdfPath = path.join(OUT_DIR, "hindi-demo.pdf");
  await fs.copyFile(v.pdfPath, pdfPath);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("pdftoppm", ["-png", "-r", "120", pdfPath, path.join(OUT_DIR, "page")], { stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`pdftoppm ${c}`))));
  });
  // Open PDF
  spawn("open", [pdfPath], { stdio: "inherit" });
  console.log(`PDF ready → ${pdfPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
