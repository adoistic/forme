import { z } from "zod";
import {
  ClassifiedTypeSchema,
  FieldSchemaByType,
  type ClassifiedType,
  type FieldsFor,
} from "@shared/schemas/classified.js";
import { LanguageSchema } from "@shared/schemas/language.js";
import { makeError, type StructuredError } from "@shared/errors/structured.js";

// JSON classifieds import (T16). Operator-supplied JSON arrives as a string
// — either pasted into a textarea or read from a file picker — and we
// validate it against the same per-type Zod schemas the CSV importer uses,
// so the renderer stays the single source of truth for "valid classified".

/**
 * One entry in the operator's JSON array. Mirrors AddClassifiedInput minus
 * `issueId` (set by the caller from the current issue context).
 */
export interface JsonRowInput {
  type: ClassifiedType;
  language: "en" | "hi";
  weeksToRun: number;
  billingReference?: string | null;
  fields: Record<string, unknown>;
}

export interface JsonImportRow {
  /** 1-indexed position within the array. */
  rowNumber: number;
  valid: boolean;
  /** Set only when the row passed both shape and per-type validation. */
  parsed?: {
    type: ClassifiedType;
    language: "en" | "hi";
    weeksToRun: number;
    billingReference: string | null;
    fields: FieldsFor<ClassifiedType>;
  };
  issues: JsonImportIssue[];
}

export interface JsonImportIssue {
  field: string;
  message: string;
}

export interface JsonImportResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: JsonImportRow[];
}

const DEFAULT_MAX = 1000;

/**
 * Outer envelope for one row. Per-type field validation is done in a second
 * pass against FieldSchemaByType so we can attach the type name to the
 * error message.
 */
const RowEnvelopeSchema = z.object({
  type: ClassifiedTypeSchema,
  language: LanguageSchema.refine((l) => l === "en" || l === "hi", {
    message: "language must be 'en' or 'hi'",
  }),
  weeksToRun: z.number().int().min(0).max(52),
  billingReference: z.string().max(200).nullable().optional(),
  fields: z.record(z.string(), z.unknown()),
});

export interface JsonImportOptions {
  /** Raw JSON string (the file contents or pasted text). */
  json: string;
  /** Max rows; over this the entire import is rejected. Default 1000. */
  maxRows?: number;
}

/**
 * Parse + validate a JSON array of classified rows. Throws a StructuredError
 * for parse / shape / size failures (the entire import is unusable). Returns
 * a row-by-row result for any per-type validation failures so the renderer
 * can list them next to each entry.
 */
export function parseClassifiedsJson(options: JsonImportOptions): JsonImportResult {
  const { json, maxRows = DEFAULT_MAX } = options;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const err: StructuredError = makeError("json_parse_error", "error", {
      reason: e instanceof Error ? e.message : String(e),
    });
    throw err;
  }

  if (!Array.isArray(parsed)) {
    throw makeError("json_parse_error", "error", {
      reason: "expected a JSON array of classified rows at the top level",
    });
  }

  if (parsed.length > maxRows) {
    throw makeError("size_cap_exceeded", "error", {
      rows: parsed.length,
      max: maxRows,
    });
  }

  const rows: JsonImportRow[] = parsed.map((raw, idx) => {
    const rowNumber = idx + 1;
    const issues: JsonImportIssue[] = [];

    const envelope = RowEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      for (const issue of envelope.error.issues) {
        issues.push({
          field: issue.path.join(".") || "(root)",
          message: issue.message,
        });
      }
      return { rowNumber, valid: false, issues };
    }

    const e = envelope.data as JsonRowInput;
    const fieldSchema = FieldSchemaByType[e.type] as z.ZodTypeAny;
    const fieldsCheck = fieldSchema.safeParse(e.fields);
    if (!fieldsCheck.success) {
      for (const issue of fieldsCheck.error.issues) {
        issues.push({
          field: ["fields", ...issue.path].join("."),
          message: issue.message,
        });
      }
      return { rowNumber, valid: false, issues };
    }

    return {
      rowNumber,
      valid: true,
      parsed: {
        type: e.type,
        language: e.language as "en" | "hi",
        weeksToRun: e.weeksToRun,
        billingReference: e.billingReference ?? null,
        fields: fieldsCheck.data as FieldsFor<ClassifiedType>,
      },
      issues: [],
    };
  });

  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.valid).length,
    invalidRows: rows.filter((r) => !r.valid).length,
    rows,
  };
}
