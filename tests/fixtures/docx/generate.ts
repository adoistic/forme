/**
 * Generates .docx test fixtures from code — run once via
 *   bun run tests/fixtures/docx/generate.ts
 *
 * The produced files are checked into tests/fixtures/docx/ and consumed by
 * tests/unit/main/docx-ingest/parse.test.ts.
 */
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.dirname(fileURLToPath(import.meta.url));

type FixtureSpec = {
  filename: string;
  headline: string;
  paragraphs: string[];
};

const fixtures: FixtureSpec[] = [
  {
    filename: "simple-english.docx",
    headline: "A Simple English Article",
    paragraphs: [
      "This is the first paragraph of a simple English article.",
      "It has several paragraphs with normal prose content that a magazine operator might import.",
      "The total length is around fifty words across three paragraphs so tests can validate word count.",
    ],
  },
  {
    filename: "simple-hindi.docx",
    headline: "एक साधारण हिंदी लेख",
    paragraphs: [
      "यह देवनागरी में लिखा गया एक सामान्य हिंदी लेख है।",
      "इसमें अनेक अनुच्छेद हैं जिनमें सामान्य गद्य सामग्री है।",
      "कुल लंबाई लगभग पचास शब्दों की है तीन अनुच्छेदों में बांटी गई है।",
    ],
  },
  {
    filename: "bilingual.docx",
    headline: "A Bilingual Editorial",
    paragraphs: [
      "This article mixes English with Hindi phrases.",
      "मेरा नाम राज है and I live in Delhi.",
      "The magazine publishes articles with both scripts from time to time.",
    ],
  },
  {
    filename: "empty.docx",
    headline: "",
    paragraphs: [],
  },
  {
    filename: "headline-only.docx",
    headline: "Just a Headline",
    paragraphs: [],
  },
];

async function main() {
  for (const fixture of fixtures) {
    const children: Paragraph[] = [];
    if (fixture.headline) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: fixture.headline })],
        })
      );
    }
    for (const para of fixture.paragraphs) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: para })],
        })
      );
    }
    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    const outPath = path.join(outDir, fixture.filename);
    await fs.writeFile(outPath, buffer);
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath} (${buffer.length} bytes)`);
  }
}

await main();
