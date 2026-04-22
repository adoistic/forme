// Diagnostic: load an article fixture, run the layout, print per-page
// per-col paragraph + line count vs available capacity. The point is
// to see whether the layout planner is FLOWING fewer lines than the
// container can hold (planner bug) or whether PowerPoint's renderer
// is showing fewer lines than the planner emitted (renderer bug).
//
// Usage: bun scripts/diagnose-layout.ts tests/fixtures/articles-md/ayurveda-bi.md

import path from "node:path";
import fs from "node:fs/promises";
import { preLayoutForTemplate } from "../src/main/pptx-prelayout/layout.js";
import { loadTemplateFile } from "../src/main/templates/loader.js";

const PT_PER_INCH = 72;
const MM_PER_INCH = 25.4;

interface ArticleFront {
  title: string;
  byline: string;
  deck: string;
  contentType: string;
  language: "en" | "hi" | "bilingual";
  body: string;
}

async function loadArticleMd(filePath: string): Promise<ArticleFront> {
  const raw = await fs.readFile(filePath, "utf-8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n+([\s\S]*)$/);
  if (!m || !m[1] || !m[2]) throw new Error(`bad front-matter`);
  const front: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const eq = line.indexOf(":");
    if (eq < 0) continue;
    front[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const lang = (front["language"] ?? "en") as "en" | "hi" | "bilingual";
  return {
    title: front["title"] ?? "",
    byline: front["byline"] ?? "",
    deck: front["deck"] ?? "",
    contentType: front["contentType"] ?? "Article",
    language: lang,
    body: m[2].trim(),
  };
}

async function main() {
  const articlePath = process.argv[2];
  if (!articlePath) throw new Error("usage: <article-md>");
  const article = await loadArticleMd(articlePath);

  // Use the feature-spread template (default for Articles).
  const template = await loadTemplateFile(
    path.join(process.cwd(), "templates/standard-feature-a4.json")
  );
  const t = template;

  console.log(`\n=== ${article.title} (${article.language}) ===`);
  console.log(`headline: "${article.title}" (${article.title.length} chars)`);
  console.log(`deck:     "${article.deck}" (${article.deck.length} chars)`);
  console.log(`body:     ${article.body.length} chars`);
  console.log(`template: ${t.template_id} cols=${t.geometry.columns}`);
  console.log(
    `         body_pt=${t.typography.body_pt} leading_pt=${t.typography.body_leading_pt}`
  );

  const trimHIn = t.geometry.trim_mm[1] / MM_PER_INCH;
  const marginTopIn = t.geometry.margins_mm.top / MM_PER_INCH;
  const marginBotIn = t.geometry.margins_mm.bottom / MM_PER_INCH;
  const pageContentIn = trimHIn - marginTopIn - marginBotIn;
  const linesPerColFull =
    (pageContentIn * PT_PER_INCH) / t.typography.body_leading_pt;

  console.log(
    `         page content height: ${pageContentIn.toFixed(2)}" = ${linesPerColFull.toFixed(1)} lines/col (full)`
  );

  const pages = await preLayoutForTemplate({
    body: article.body,
    headline: article.title,
    deck: article.deck || null,
    language: article.language,
    hasTopByline: !!article.byline,
    hasHero: false,
    template: {
      trim_mm: t.geometry.trim_mm,
      margins_mm: t.geometry.margins_mm,
      columns: t.geometry.columns,
      gutter_mm: t.geometry.gutter_mm,
      typography: {
        headline_pt: t.typography.headline_pt,
        ...(t.typography.deck_pt !== undefined
          ? { deck_pt: t.typography.deck_pt }
          : {}),
        body_pt: t.typography.body_pt,
        body_leading_pt: t.typography.body_leading_pt,
      },
      page_count_range: t.page_count_range,
    },
  });

  console.log(`\nLayout produced ${pages.length} pages:`);
  for (let p = 0; p < pages.length; p += 1) {
    const cols = pages[p] ?? [];
    const colLines: string[] = [];
    let totalLines = 0;
    for (let c = 0; c < cols.length; c += 1) {
      const col = cols[c] ?? [];
      // Estimate: total chars in the col / 30 (approx chars per line)
      const charCount = col.reduce((a, x) => a + x.length, 0);
      const paraCount = col.length;
      const estLines = Math.ceil(charCount / 30);
      colLines.push(`col${c + 1}: ${paraCount} paras, ${charCount} chars, ~${estLines} est lines`);
      totalLines += estLines;
    }
    const cap = p === 0 ? "FIRST PAGE" : `${linesPerColFull.toFixed(0)}`;
    console.log(`  page ${p + 1} (cap ${cap} lines/col): avg ${(totalLines / cols.length).toFixed(0)} est lines/col`);
    for (const cl of colLines) console.log(`    ${cl}`);
  }
}

void main();
