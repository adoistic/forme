// CSV row coercion for the `classified:import-csv` IPC handler.
// Pure function, no I/O — extracted so it can be unit-tested without
// spinning up Electron, the DB, or the blob store.
//
// The bug this guards against: stale numeric-keys (expected_price,
// asking_price, rent_amount) used to live in the handler. Those fields
// are z.string() in src/shared/schemas/classified.ts so operators can
// write "₹8.5 lakh" or "Negotiable". The old code ran Number() on them,
// got NaN, and silently dropped the field. The classified imported
// "successfully" but the price disappeared in the exported PDF.

const STANDARD_KEYS = new Set([
  "type",
  "language",
  "weeks_to_run",
  "billing_reference",
  "photo_path", // resolved separately into photo_blob_hash
]);

// MUST match z.number() schema declarations in
// src/shared/schemas/classified.ts. If you add a numeric field there,
// add it here too — otherwise it will be stored as a string and Zod
// will reject the row at import time.
const NUMERIC_KEYS = new Set([
  "age", // matrimonial, job_wanted, obituary
  "year", // vehicles
  "kilometers", // vehicles
  "bedrooms", // property_sale, property_rent
  "built_up_area_sqft", // property_sale, property_rent
  "plot_area_sqft", // property_sale, property_rent
]);

const ARRAY_KEYS = new Set(["contact_phones", "sender_names"]);

/**
 * Coerce a CSV row's per-type fields into the shape the classified Zod
 * schemas expect. STRING-typed schema fields (expected_price, monthly_rent,
 * security_deposit, etc.) pass through untouched so labels like "₹8.5 lakh"
 * survive validation.
 *
 * Standard envelope keys (type, language, weeks_to_run, etc.) are skipped —
 * the handler reads those directly from the row.
 *
 * Empty cells are skipped. Numeric cells that fail Number() are skipped
 * (Zod will reject the row downstream if the field is required).
 */
export function coerceClassifiedRowFields(
  row: Record<string, string | undefined | null>
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (STANDARD_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    const trimmed = String(v).trim();
    if (trimmed === "") continue;
    if (NUMERIC_KEYS.has(k)) {
      const n = Number(trimmed);
      if (!Number.isNaN(n)) fields[k] = n;
      // If NaN: skip. Parse error in operator's CSV — Zod will catch
      // downstream for required numeric fields like vehicles.year.
    } else if (ARRAY_KEYS.has(k)) {
      fields[k] = trimmed
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      fields[k] = trimmed;
    }
  }
  return fields;
}
