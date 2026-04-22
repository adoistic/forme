import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseClassifiedsCsv } from "../../../../src/renderer/csv-import/parse.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/csv"
);

async function read(name: string): Promise<string> {
  return fs.readFile(path.join(fixturesDir, name), "utf8");
}

describe("parseClassifiedsCsv — matrimonial_with_photo", () => {
  test("counts valid, invalid, and duplicates", async () => {
    const csv = await read("matrimonial-with-photo.csv");
    const result = parseClassifiedsCsv({
      type: "matrimonial_with_photo",
      csv,
    });

    expect(result.totalRows).toBe(5);
    // validRows counts schema-valid rows; duplicate rows are still schema-valid.
    expect(result.validRows).toBe(4); // Aanya x2, Rohan, Priya (all schema-valid)
    expect(result.duplicateRows).toBe(1); // Aanya second entry marked duplicate
    expect(result.invalidRows).toBe(1); // "Bad Row" — no location/contact
  });

  test("valid row has parsed field set", async () => {
    const csv = await read("matrimonial-with-photo.csv");
    const result = parseClassifiedsCsv({
      type: "matrimonial_with_photo",
      csv,
    });
    const firstValid = result.rows.find((r) => r.valid);
    expect(firstValid).toBeTruthy();
    expect(firstValid?.parsed).toBeTruthy();
    expect(firstValid?.language).toBe("en");
    expect(firstValid?.weeks_to_run).toBe(3);
    expect(firstValid?.billing_reference).toBe("INV-0001");
  });

  test("invalid row has issues + no parsed", async () => {
    const csv = await read("matrimonial-with-photo.csv");
    const result = parseClassifiedsCsv({
      type: "matrimonial_with_photo",
      csv,
    });
    const invalid = result.rows.find((r) => !r.valid);
    expect(invalid).toBeTruthy();
    expect(invalid?.issues.length).toBeGreaterThan(0);
    expect(invalid?.parsed).toBeUndefined();
  });

  test("contact_phones string gets split into array", async () => {
    const csv =
      "name,age,location,contact_name,contact_phones,language,weeks_to_run\nTest,25,Mumbai,Self,+91 11111 00000;+91 22222 00000,en,1";
    const result = parseClassifiedsCsv({
      type: "matrimonial_with_photo",
      csv,
    });
    expect(result.validRows).toBe(1);
    const row = result.rows[0]!;
    const fields = row.fields as Record<string, unknown>;
    expect(Array.isArray(fields["contact_phones"])).toBe(true);
    expect((fields["contact_phones"] as string[]).length).toBe(2);
  });
});

describe("parseClassifiedsCsv — obituary", () => {
  test("parses both English and Hindi rows", async () => {
    const csv = await read("obituary.csv");
    const result = parseClassifiedsCsv({
      type: "obituary",
      csv,
    });
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(2);
    expect(result.rows[0]!.language).toBe("en");
    expect(result.rows[1]!.language).toBe("hi");
  });
});

describe("parseClassifiedsCsv — encoding + bom", () => {
  test("UTF-8 BOM is stripped transparently", async () => {
    const csv = await read("bom-encoded.csv");
    const result = parseClassifiedsCsv({
      type: "matrimonial_with_photo",
      csv,
    });
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(1);
  });
});

describe("parseClassifiedsCsv — limits + errors", () => {
  test("size cap enforced", () => {
    const header = "name,age,location,contact_name,contact_phones,language,weeks_to_run";
    const row = "Test,25,Mumbai,Self,+91 11111 00000,en,1";
    const rows = Array.from({ length: 1001 }, () => row).join("\n");
    const csv = `${header}\n${rows}`;
    expect(() => parseClassifiedsCsv({ type: "matrimonial_with_photo", csv })).toThrow();
  });

  test("custom maxRows respected", () => {
    const header = "name_of_deceased,date_of_death";
    const data = Array.from({ length: 10 }, (_, i) => `Person ${i},2026-04-${10 + (i % 20)}`).join(
      "\n"
    );
    const csv = `${header}\n${data}`;

    expect(() => parseClassifiedsCsv({ type: "obituary", csv, maxRows: 5 })).toThrow(
      /size_cap_exceeded|./
    );
  });

  test("duplicate on (phone + billing_ref) detected", () => {
    const csv =
      "name,age,location,contact_name,contact_phones,language,weeks_to_run,billing_reference\n" +
      "A,25,Mumbai,Self,+91 11111 00000,en,1,INV-1\n" +
      "B,26,Pune,Self,+91 11111 00000,en,1,INV-1\n";
    const result = parseClassifiedsCsv({
      type: "matrimonial_with_photo",
      csv,
    });
    expect(result.duplicateRows).toBe(1);
  });

  test("all rows accepted when phones differ", () => {
    const csv =
      "name,age,location,contact_name,contact_phones,language,weeks_to_run,billing_reference\n" +
      "A,25,Mumbai,Self,+91 11111 00000,en,1,INV-1\n" +
      "B,26,Pune,Self,+91 22222 00000,en,1,INV-2\n";
    const result = parseClassifiedsCsv({
      type: "matrimonial_with_photo",
      csv,
    });
    expect(result.duplicateRows).toBe(0);
    expect(result.validRows).toBe(2);
  });

  test("empty csv returns zero rows, no throw", () => {
    const result = parseClassifiedsCsv({
      type: "matrimonial_with_photo",
      csv: "name,age,location,contact_name,contact_phones,language,weeks_to_run\n",
    });
    expect(result.totalRows).toBe(0);
  });
});
