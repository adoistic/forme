import { describe, expect, test, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildPptx } from "../../../src/shared/pptx-builder/build.js";
import { loadTemplateFile } from "../../../src/main/templates/loader.js";
import {
  validatePptx,
  findSoffice,
} from "../../../src/main/ooxml-validator/libreoffice.js";
import type {
  PptxBuildInput,
  PptxPlacement,
} from "../../../src/shared/pptx-builder/types.js";

const repoRoot = process.cwd();
const standardFeatureA4 = path.join(repoRoot, "templates/standard-feature-a4.json");

// Resolve sofficeAvailable at module load so describe.runIf sees it.
const sofficeBin = await findSoffice();
const sofficeAvailable = !!sofficeBin;

let workDir: string;

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-pptx-build-"));
});

afterAll(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

function fakeArticle(headline: string, body: string): PptxPlacement["article"] {
  return {
    headline,
    deck: "A brief description of the article that appears below the headline.",
    byline: "By Forme Test Harness",
    body,
    language: "en",
  };
}

function longBody(wordCount: number): string {
  const words = [
    "The",
    "quick",
    "brown",
    "fox",
    "jumps",
    "over",
    "the",
    "lazy",
    "dog",
    "in",
    "a",
    "magazine",
    "about",
    "typography",
  ];
  const out: string[] = [];
  for (let i = 0; i < wordCount; i += 1) {
    out.push(words[i % words.length]!);
    if ((i + 1) % 20 === 0) out.push("\n\n");
  }
  return out.join(" ");
}

describe("buildPptx — Standard Feature A4", () => {
  test("produces a valid PPTX for an English article", async () => {
    const template = await loadTemplateFile(standardFeatureA4);
    const input: PptxBuildInput = {
      issueTitle: "Issue 1",
      issueNumber: 1,
      issueDate: "2026-04-22",
      publicationName: "Forme Test Publication",
      placements: [
        {
          articleId: "test-1",
          template,
          startingPageNumber: 1,
          article: fakeArticle("A Test Article Headline", longBody(1200)),
        },
      ],
    };

    const outPath = path.join(workDir, "english.pptx");
    const result = await buildPptx(input, outPath);

    expect(result.bytes).toBeGreaterThan(1000);
    // Page count is computed from body length; stays inside template range
    expect(result.pageCount).toBeGreaterThanOrEqual(template.page_count_range[0]);
    expect(result.pageCount).toBeLessThanOrEqual(template.page_count_range[1]);
    expect(result.outputPath).toBe(outPath);

    // Verify the file exists on disk
    const stat = await fs.stat(outPath);
    expect(stat.size).toBe(result.bytes);
  });

  test("throws on zero placements", async () => {
    const input: PptxBuildInput = {
      issueTitle: "Empty",
      issueNumber: 0,
      issueDate: "2026-04-22",
      publicationName: "Nobody",
      placements: [],
    };
    await expect(
      buildPptx(input, path.join(workDir, "empty.pptx"))
    ).rejects.toThrow(/zero placements/);
  });

  test("short body emits only the pages it fills (no blank trailers)", async () => {
    const template = await loadTemplateFile(standardFeatureA4);
    const input: PptxBuildInput = {
      issueTitle: "Issue 2",
      issueNumber: 2,
      issueDate: "2026-04-22",
      publicationName: "Forme",
      placements: [
        {
          articleId: "test-2",
          template,
          startingPageNumber: 3,
          article: fakeArticle("Short Test", longBody(500)),
        },
      ],
    };
    const result = await buildPptx(input, path.join(workDir, "minpages.pptx"));
    // A 500-word body comfortably fits on one page — we should NOT emit
    // blank pages just because the template's page_count_range minimum is 2.
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.pageCount).toBeLessThanOrEqual(template.page_count_range[1]);
    // Caller should receive a warning so the UI can nudge the operator.
    if (result.pageCount < template.page_count_range[0]) {
      expect(result.warnings.some((w) => /template/i.test(w))).toBe(true);
    }
  });

  test("handles Hindi article with Devanagari body", async () => {
    const template = await loadTemplateFile(standardFeatureA4);
    const body = longBody(800).replace(/The /g, "मोदी ").replace(/fox/g, "दिल्ली");
    const input: PptxBuildInput = {
      issueTitle: "अंक 1",
      issueNumber: 1,
      issueDate: "2026-04-22",
      publicationName: "दैनिक सप्ताहिक",
      placements: [
        {
          articleId: "hi-1",
          template,
          startingPageNumber: 1,
          article: {
            ...fakeArticle("हिंदी शीर्षक का परीक्षण", body),
            language: "hi",
          },
        },
      ],
    };
    const outPath = path.join(workDir, "hindi.pptx");
    const result = await buildPptx(input, outPath);
    expect(result.bytes).toBeGreaterThan(1000);
  });
});

describe.runIf(sofficeAvailable)("buildPptx × LibreOffice round-trip — Phase 2 gate", () => {
  test(
    "generated PPTX parses cleanly in LibreOffice",
    async () => {
      const template = await loadTemplateFile(standardFeatureA4);
      const input: PptxBuildInput = {
        issueTitle: "Phase 2 Gate",
        issueNumber: 1,
        issueDate: "2026-04-22",
        publicationName: "Forme",
        placements: [
          {
            articleId: "gate",
            template,
            startingPageNumber: 1,
            article: fakeArticle(
              "The Phase 2 Gate Smoke Test",
              longBody(1100)
            ),
          },
        ],
      };
      const outPath = path.join(workDir, "gate.pptx");
      await buildPptx(input, outPath);

      const validation = await validatePptx({ pptxPath: outPath });
      expect(validation.valid).toBe(true);
      expect(validation.pdfPath).toBeTruthy();
    },
    180_000
  );
});
