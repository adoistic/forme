import { describe, expect, test } from "vitest";
import { parseClassifiedsJson } from "../../../../src/renderer/csv-import/parse-json.js";

// JSON classifieds import tests (T16). Pairs with parse.test.ts which
// covers the CSV path. Both share the same per-type Zod schemas so we
// only retest the JSON-specific concerns: array shape, parse errors,
// per-row schema fail isolation, mixed valid+invalid rows.

const validMatrimonialRow = {
  type: "matrimonial_with_photo",
  language: "en",
  weeksToRun: 2,
  billingReference: "INV-9001",
  fields: {
    name: "Aanya Sharma",
    age: 28,
    location: "Mumbai",
    contact_name: "Priya Sharma",
    contact_phones: ["+91 98765 43210"],
  },
};

const validObituaryRow = {
  type: "obituary",
  language: "hi",
  weeksToRun: 1,
  fields: {
    name_of_deceased: "Shanti Devi",
    date_of_death: "2026-04-18",
    age: 76,
    life_summary: "Beloved teacher.",
  },
};

describe("parseClassifiedsJson — happy path", () => {
  test("single valid row parses + returns parsed payload", () => {
    const result = parseClassifiedsJson({ json: JSON.stringify([validMatrimonialRow]) });
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(1);
    expect(result.invalidRows).toBe(0);
    const row = result.rows[0]!;
    expect(row.valid).toBe(true);
    expect(row.parsed?.type).toBe("matrimonial_with_photo");
    expect(row.parsed?.weeksToRun).toBe(2);
    expect(row.parsed?.billingReference).toBe("INV-9001");
  });

  test("multiple types in one array all parse", () => {
    const result = parseClassifiedsJson({
      json: JSON.stringify([validMatrimonialRow, validObituaryRow]),
    });
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(2);
    expect(result.invalidRows).toBe(0);
  });

  test("missing billingReference defaults to null", () => {
    const row = { ...validObituaryRow };
    const result = parseClassifiedsJson({ json: JSON.stringify([row]) });
    expect(result.rows[0]!.parsed?.billingReference).toBeNull();
  });

  test("empty array returns zero rows, no throw", () => {
    const result = parseClassifiedsJson({ json: "[]" });
    expect(result.totalRows).toBe(0);
    expect(result.validRows).toBe(0);
  });
});

describe("parseClassifiedsJson — top-level errors", () => {
  test("invalid JSON throws json_parse_error with reason", () => {
    let thrown: unknown;
    try {
      parseClassifiedsJson({ json: "{ this is not json" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeTruthy();
    const err = thrown as { code: string; context: { reason: string } };
    expect(err.code).toBe("json_parse_error");
    expect(err.context.reason).toBeTruthy();
  });

  test("non-array top-level throws json_parse_error", () => {
    expect(() =>
      parseClassifiedsJson({ json: JSON.stringify({ rows: [validMatrimonialRow] }) })
    ).toThrow();
  });

  test("size cap exceeded throws size_cap_exceeded", () => {
    const many = Array.from({ length: 1001 }, () => validMatrimonialRow);
    let thrown: unknown;
    try {
      parseClassifiedsJson({ json: JSON.stringify(many) });
    } catch (e) {
      thrown = e;
    }
    const err = thrown as { code: string };
    expect(err.code).toBe("size_cap_exceeded");
  });

  test("custom maxRows is honored", () => {
    const five = Array.from({ length: 5 }, () => validMatrimonialRow);
    expect(() => parseClassifiedsJson({ json: JSON.stringify(five), maxRows: 3 })).toThrow();
  });
});

describe("parseClassifiedsJson — per-row errors", () => {
  test("envelope shape error reports field path + message", () => {
    const bad = { ...validMatrimonialRow, language: "fr" };
    const result = parseClassifiedsJson({ json: JSON.stringify([bad]) });
    expect(result.invalidRows).toBe(1);
    const row = result.rows[0]!;
    expect(row.valid).toBe(false);
    expect(row.parsed).toBeUndefined();
    expect(row.issues.length).toBeGreaterThan(0);
    expect(row.issues[0]?.field).toBe("language");
  });

  test("per-type field error attached under fields.* path", () => {
    const bad = {
      ...validMatrimonialRow,
      fields: { ...validMatrimonialRow.fields, age: 5 },
    };
    const result = parseClassifiedsJson({ json: JSON.stringify([bad]) });
    expect(result.invalidRows).toBe(1);
    const issue = result.rows[0]!.issues[0]!;
    expect(issue.field).toMatch(/^fields\./);
  });

  test("unknown type fails on envelope, not on field schema lookup", () => {
    const bad = { ...validMatrimonialRow, type: "not_a_real_type" };
    const result = parseClassifiedsJson({ json: JSON.stringify([bad]) });
    expect(result.invalidRows).toBe(1);
    expect(result.rows[0]!.issues[0]?.field).toBe("type");
  });

  test("missing required envelope key reported", () => {
    const bad = {
      type: "obituary",
      fields: { name_of_deceased: "X", date_of_death: "2026-01-01" },
    };
    const result = parseClassifiedsJson({ json: JSON.stringify([bad]) });
    expect(result.invalidRows).toBe(1);
    // Either language or weeksToRun should surface in issues.
    const fields = result.rows[0]!.issues.map((i) => i.field);
    expect(fields.some((f) => f === "language" || f === "weeksToRun")).toBe(true);
  });
});

describe("parseClassifiedsJson — mixed valid + invalid", () => {
  test("each row is independently validated; counts add up", () => {
    const json = JSON.stringify([
      validMatrimonialRow,
      { ...validMatrimonialRow, fields: { name: "OnlyName" } }, // missing required fields
      validObituaryRow,
      { ...validObituaryRow, language: "fr" }, // bad envelope
    ]);
    const result = parseClassifiedsJson({ json });
    expect(result.totalRows).toBe(4);
    expect(result.validRows).toBe(2);
    expect(result.invalidRows).toBe(2);
    expect(result.rows[0]!.valid).toBe(true);
    expect(result.rows[1]!.valid).toBe(false);
    expect(result.rows[2]!.valid).toBe(true);
    expect(result.rows[3]!.valid).toBe(false);
  });

  test("row numbers are 1-indexed", () => {
    const json = JSON.stringify([validMatrimonialRow, validObituaryRow]);
    const result = parseClassifiedsJson({ json });
    expect(result.rows[0]!.rowNumber).toBe(1);
    expect(result.rows[1]!.rowNumber).toBe(2);
  });
});
