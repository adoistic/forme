import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePptx,
  findSoffice,
} from "../../../src/main/ooxml-validator/libreoffice.js";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const smokePptx = path.join(fixtureDir, "smoke.pptx");

// Resolve sofficeAvailable at module load so vitest's test.skipIf sees it.
// (beforeAll is async — vitest's skipIf is evaluated at declaration time.)
const sofficeBin = await findSoffice();
const sofficeAvailable = !!sofficeBin;

describe("findSoffice", () => {
  test("returns a string path when LibreOffice is installed", () => {
    if (sofficeAvailable) {
      expect(sofficeBin).toMatch(/soffice$/);
    } else {
      expect(sofficeBin).toBeNull();
    }
  });
});

describe.runIf(sofficeAvailable)("validatePptx — integration", () => {
  test(
    "valid pptx round-trips to PDF",
    async () => {
      const result = await validatePptx({ pptxPath: smokePptx });
      expect(result.valid).toBe(true);
      expect(result.pdfPath).toBeTruthy();
      expect(result.durationMs).toBeGreaterThan(0);
      const stat = await fs.stat(result.pdfPath!);
      expect(stat.size).toBeGreaterThan(0);
    },
    120_000
  );

  test(
    "nonexistent file throws ooxml_validation_error",
    async () => {
      await expect(
        validatePptx({ pptxPath: path.join(fixtureDir, "does-not-exist.pptx") })
      ).rejects.toMatchObject({ code: "ooxml_validation_error" });
    },
    30_000
  );
});

describe("validatePptx — without LibreOffice", () => {
  test("throws ooxml_validation_error for bogus binary path", async () => {
    await expect(
      validatePptx({
        pptxPath: smokePptx,
        sofficeBinary: "/definitely/not/here/soffice",
      })
    ).rejects.toMatchObject({ code: "ooxml_validation_error" });
  });
});
