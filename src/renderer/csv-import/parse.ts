import Papa from "papaparse";
import { z } from "zod";
import type { ClassifiedType, FieldsFor } from "@shared/schemas/classified.js";
import { ClassifiedTypeSchema, FieldSchemaByType } from "@shared/schemas/classified.js";
import { makeError, type StructuredError } from "@shared/errors/structured.js";
import type { Language } from "@shared/schemas/language.js";

// CSV import for classifieds per docs/eng-plan.md §1 + CEO plan Accepted Scope #5.
// Per-type CSV templates, UTF-8 with or without BOM (Windows Excel artifact tolerated),
// size cap 1000 rows, duplicate detection on (phone + billing_reference).

export interface CsvRow<T extends ClassifiedType> {
  rowNumber: number; // 1-indexed, excluding header
  valid: boolean;
  fields: unknown; // raw parsed object (may fail validation)
  parsed?: FieldsFor<T>; // set only when valid
  issues: CsvIssue[];
  duplicate: boolean;
  language: Language;
  weeks_to_run: number;
  billing_reference: string | null;
}

export interface CsvIssue {
  field: string;
  code: string;
  message: string;
}

export interface CsvImportResult<T extends ClassifiedType> {
  type: T;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  rows: CsvRow<T>[];
}

export interface CsvImportOptions {
  /** Required — which classified type the CSV is for. */
  type: ClassifiedType;
  /** CSV contents as a UTF-8 string. Caller decodes. */
  csv: string;
  /** Max rows; over this the entire import is rejected. Default 1000 per CEO §14. */
  maxRows?: number;
}

const DEFAULT_MAX = 1000;
const BOM = "\uFEFF";

/**
 * Strip UTF-8 BOM (common artifact from Windows Excel) and parse.
 * Rejects non-UTF-8 content (detectable via invalid byte sequences), but the
 * caller is responsible for decoding — this function operates on a string.
 */
export function parseClassifiedsCsv<T extends ClassifiedType>(
  options: CsvImportOptions
): CsvImportResult<T> {
  const { type, csv, maxRows = DEFAULT_MAX } = options;

  // Type safety: confirm type is one of the 12 known
  const typeCheck = ClassifiedTypeSchema.safeParse(type);
  if (!typeCheck.success) {
    throw makeError("field_validation_error", "error", {
      field: "type",
      row: 0,
      reason: "unknown classified type",
    });
  }

  const stripped = csv.startsWith(BOM) ? csv.slice(1) : csv;

  // PapaParse with header row; dynamicTyping to convert numeric strings
  const parsed = Papa.parse<Record<string, unknown>>(stripped, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  // Fail hard on CSV parse errors
  if (parsed.errors.length > 0 && parsed.errors[0]) {
    const first = parsed.errors[0];
    const err: StructuredError = makeError("csv_parse_error", "error", {
      row: (first.row ?? 0) + 1,
      reason: first.message,
    });
    throw err;
  }

  const rawRows = parsed.data;

  if (rawRows.length > maxRows) {
    throw makeError("size_cap_exceeded", "error", {
      rows: rawRows.length,
      max: maxRows,
    });
  }

  const schema = FieldSchemaByType[type] as z.ZodTypeAny;

  // Duplicate detection on (contact phone + billing_reference) — ASCII safe
  const seenKeys = new Set<string>();
  const dupKey = (row: Record<string, unknown>): string => {
    const phone = extractPhone(row);
    const billing = row["billing_reference"] ?? row["billing"] ?? "";
    return `${phone}|${String(billing).trim()}`;
  };

  const rows: CsvRow<T>[] = rawRows.map((raw, idx) => {
    const rowNumber = idx + 1;
    const { language, weeks_to_run, billing_reference, fields } = splitUniversalFields(raw);

    const validation = schema.safeParse(fields);
    const issues: CsvIssue[] = [];
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        issues.push({
          field: issue.path.join(".") || "(root)",
          code: issue.code,
          message: issue.message,
        });
      }
    }

    const key = dupKey(raw);
    const isDup = key.trim() !== "|" && seenKeys.has(key);
    if (!isDup && key.trim() !== "|") seenKeys.add(key);

    const row: CsvRow<T> = {
      rowNumber,
      valid: validation.success,
      fields,
      issues,
      duplicate: isDup,
      language,
      weeks_to_run,
      billing_reference,
    };
    if (validation.success) {
      row.parsed = validation.data as FieldsFor<T>;
    }
    return row;
  });

  const result: CsvImportResult<T> = {
    type: type as T,
    totalRows: rows.length,
    validRows: rows.filter((r) => r.valid).length,
    invalidRows: rows.filter((r) => !r.valid).length,
    duplicateRows: rows.filter((r) => r.duplicate).length,
    rows,
  };

  return result;
}

/**
 * Extract + normalize universal fields (language, weeks_to_run, billing_reference)
 * from a parsed row. Also splits them out of `fields` so per-type validation sees
 * only type-specific keys.
 */
function splitUniversalFields(raw: Record<string, unknown>): {
  language: Language;
  weeks_to_run: number;
  billing_reference: string | null;
  fields: Record<string, unknown>;
} {
  const fields = { ...raw };
  let language: Language = "en";
  if (typeof raw["language"] === "string") {
    const l = String(raw["language"]).trim().toLowerCase();
    if (l === "hi" || l === "hindi") language = "hi";
    else if (l === "en" || l === "english") language = "en";
    delete fields["language"];
  }
  let weeks_to_run = 1;
  const weeksRaw = raw["weeks_to_run"] ?? raw["weeks"];
  if (typeof weeksRaw === "number") {
    weeks_to_run = Math.max(0, Math.min(52, Math.floor(weeksRaw)));
  } else if (typeof weeksRaw === "string") {
    const parsed = Number.parseInt(weeksRaw, 10);
    if (!Number.isNaN(parsed)) weeks_to_run = Math.max(0, Math.min(52, parsed));
  }
  delete fields["weeks_to_run"];
  delete fields["weeks"];

  let billing_reference: string | null = null;
  const billingRaw = raw["billing_reference"] ?? raw["billing"];
  if (typeof billingRaw === "string" && billingRaw.trim().length > 0) {
    billing_reference = billingRaw.trim();
  }
  delete fields["billing_reference"];
  delete fields["billing"];

  // Normalize contact_phones if it's a string (split on ; or ,)
  if (typeof fields["contact_phones"] === "string") {
    const list = String(fields["contact_phones"])
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    fields["contact_phones"] = list;
  }

  // Parse sender_names the same way for announcement type
  if (typeof fields["sender_names"] === "string") {
    const list = String(fields["sender_names"])
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    fields["sender_names"] = list;
  }

  return { language, weeks_to_run, billing_reference, fields };
}

function extractPhone(raw: Record<string, unknown>): string {
  const phones = raw["contact_phones"];
  if (typeof phones === "string") {
    const first = phones.split(/[;,]/)[0];
    return first ? first.trim() : "";
  }
  if (Array.isArray(phones) && phones.length > 0) {
    return String(phones[0]).trim();
  }
  if (typeof raw["contact_phone"] === "string") {
    return raw["contact_phone"].trim();
  }
  return "";
}
