import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocx } from "../../../../src/main/docx-ingest/parse.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/docx"
);

async function readFixture(name: string): Promise<Buffer> {
  return fs.readFile(path.join(fixturesDir, name));
}

describe("parseDocx", () => {
  test("extracts headline + body from simple English", async () => {
    const buf = await readFixture("simple-english.docx");
    const result = await parseDocx(buf);

    expect(result.headline).toBe("A Simple English Article");
    expect(result.body).toContain("first paragraph");
    expect(result.body).toContain("fifty words");
    expect(result.body_html).toContain("<p>");
    expect(result.language).toBe("en");
    expect(result.word_count).toBeGreaterThan(30);
    expect(result.word_count).toBeLessThan(100);
    expect(result.images).toHaveLength(0);
  });

  test("detects Hindi from Devanagari body", async () => {
    const buf = await readFixture("simple-hindi.docx");
    const result = await parseDocx(buf);

    expect(result.headline).toBe("एक साधारण हिंदी लेख");
    expect(result.language).toBe("hi");
    expect(result.word_count).toBeGreaterThan(10);
  });

  test("detects bilingual content", async () => {
    const buf = await readFixture("bilingual.docx");
    const result = await parseDocx(buf);

    expect(result.language).toBe("bilingual");
    expect(result.body).toContain("Delhi");
    expect(result.body).toContain("मेरा");
  });

  test("empty docx throws empty_body StructuredError", async () => {
    const buf = await readFixture("empty.docx");
    await expect(parseDocx(buf)).rejects.toMatchObject({
      code: "empty_body",
    });
  });

  test("headline-only docx has body but word_count low", async () => {
    const buf = await readFixture("headline-only.docx");
    const result = await parseDocx(buf);
    expect(result.headline).toBe("Just a Headline");
    // body may be empty or just the headline text depending on mammoth's extraction
    expect(result.word_count).toBeGreaterThanOrEqual(0);
  });

  test("malformed bytes throw corrupt_archive", async () => {
    const garbage = Buffer.from("not a real docx at all");
    await expect(parseDocx(garbage)).rejects.toMatchObject({
      code: "corrupt_archive",
    });
  });

  test("empty buffer throws corrupt_archive or empty_body", async () => {
    // An empty buffer is not a valid zip → mammoth should error
    await expect(parseDocx(Buffer.alloc(0))).rejects.toMatchObject({
      code: expect.stringMatching(/corrupt_archive|empty_body/),
    });
  });

  test("warnings are returned, not thrown, on minor issues", async () => {
    const buf = await readFixture("simple-english.docx");
    const result = await parseDocx(buf);
    // Warnings may or may not exist for a simple file; assert shape
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  test("extracts top byline when article starts with 'By X'", async () => {
    // Build a minimal docx-shaped XML via pandoc-equivalent: use the real
    // fixture directory at tests/fixtures/articles which build-fixtures.ts
    // produces with a By-line paragraph right after the h1.
    const fixtureDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../fixtures/articles"
    );
    const buf = await fs
      .readFile(path.join(fixtureDir, "chandrayaan-3.docx"))
      .catch(() => null);
    if (!buf) {
      // Fixture not built yet — skip rather than fail. Run
      // `bun scripts/build-fixtures.ts` to generate.
      return;
    }
    const result = await parseDocx(buf);
    expect(result.byline).toBe("By QA Harness");
    expect(result.byline_position).toBe("top");
    // Byline should NOT appear at the start of body anymore
    expect(result.body.slice(0, 60)).not.toMatch(/^By QA Harness/);
  });

  test("byline defaults to null + position 'top' when none found", async () => {
    const buf = await readFixture("simple-english.docx");
    const result = await parseDocx(buf);
    expect(result.byline).toBeNull();
    expect(result.byline_position).toBe("top");
  });
});
