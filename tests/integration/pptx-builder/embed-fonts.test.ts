import { describe, expect, test, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import { buildPptx } from "../../../src/shared/pptx-builder/build.js";
import { loadTemplateFile } from "../../../src/main/templates/loader.js";
import { loadBundledFonts } from "../../../src/shared/pptx-builder/fonts.js";

const repoRoot = process.cwd();
const standardFeatureA4 = path.join(repoRoot, "templates/standard-feature-a4.json");

let workDir: string;

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-embed-fonts-"));
});

afterAll(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe("buildPptx → font embedding", () => {
  test("inserts /ppt/fonts/ entries + embeddedFontLst when bundled fonts exist", async () => {
    const fonts = await loadBundledFonts();
    if (fonts.length === 0) {
      // Repo not built with fonts; skip rather than fail.
      return;
    }

    const template = await loadTemplateFile(standardFeatureA4);
    const outPath = path.join(workDir, "embed.pptx");
    const result = await buildPptx(
      {
        issueTitle: "Embed test",
        issueNumber: 1,
        issueDate: "2026-04-22",
        publicationName: "Forme",
        placements: [
          {
            articleId: "embed-1",
            template,
            startingPageNumber: 1,
            article: {
              headline: "Embedding test",
              deck: null,
              byline: "By embed",
              body:
                "This article exists only to confirm the post-write font embedding step succeeds. " +
                "No bundle, no embed; with a bundle, the resulting pptx contains font streams.",
              language: "en",
            },
          },
        ],
      },
      outPath
    );
    expect(result.bytes).toBeGreaterThan(1000);

    // Open the .pptx zip + verify the embed parts
    const buf = await fs.readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const fntdataFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith("ppt/fonts/") && f.endsWith(".fntdata")
    );
    expect(fntdataFiles.length).toBe(fonts.length);

    const presXml = await zip.file("ppt/presentation.xml")!.async("string");
    expect(presXml).toContain("<p:embeddedFontLst>");
    // Each unique typeface should appear once
    const typefaces = new Set(fonts.map((f) => f.fontName));
    for (const tf of typefaces) {
      expect(presXml).toContain(`typeface="${tf}"`);
    }

    const ctXml = await zip.file("[Content_Types].xml")!.async("string");
    expect(ctXml).toContain('Extension="fntdata"');
    expect(ctXml).toContain("obfuscatedFont");

    const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    expect(relsXml).toContain("rIdFormeFont1");
    // One relationship per font face
    const matches = relsXml.match(/rIdFormeFont\d+/g) ?? [];
    expect(matches.length).toBe(fonts.length);
  });
});
