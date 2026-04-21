import { z } from "zod";

// 11 ad slot types per CEO plan Section 15.
// Each has a canonical aspect ratio (width/height) and a set of allowed print
// sizes. The renderer uses these to validate uploads.

export const AdSlotTypeSchema = z.enum([
  "full_page",
  "double_page_spread",
  "half_page_horizontal",
  "half_page_vertical",
  "quarter_page",
  "strip",
  "vertical_strip",
  "eighth_page",
  "cover_strip",
  "corner_bookmark",
  "section_sponsor_strip",
]);
export type AdSlotType = z.infer<typeof AdSlotTypeSchema>;

/** Aspect ratio = width / height for the trim-size slot. */
export const AD_SLOT_ASPECT: Record<AdSlotType, number> = {
  full_page: 210 / 297, // A4 portrait
  double_page_spread: 420 / 297, // wide landscape (A4 × 2)
  half_page_horizontal: 210 / 148.5,
  half_page_vertical: 105 / 297,
  quarter_page: 105 / 148.5,
  strip: 210 / 35,
  vertical_strip: 40 / 297,
  eighth_page: 105 / 74.25,
  cover_strip: 210 / 35,
  corner_bookmark: 60 / 60, // ~square triangle bounding box
  section_sponsor_strip: 210 / 20,
};

export const AdRecordSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid().nullable(),
  slot_type: AdSlotTypeSchema,
  position_label: z.string().min(1).max(120),
  bw_flag: z.boolean(),
  kind: z.enum(["commercial", "house", "sponsor_strip"]),
  creative_blob_hash: z.string().length(64),
  creative_filename: z.string(),
  billing_reference: z.string().nullable(),
  created_at: z.string(),
});
export type AdRecord = z.infer<typeof AdRecordSchema>;

/**
 * Check an uploaded image's aspect ratio against the slot requirement.
 * Tolerance: 1% per CEO plan §15.3.
 */
export function validateAdAspect(
  slot: AdSlotType,
  imageWidth: number,
  imageHeight: number,
  tolerance = 0.01
): { ok: true } | { ok: false; expected: number; actual: number } {
  const expected = AD_SLOT_ASPECT[slot];
  const actual = imageWidth / imageHeight;
  const diff = Math.abs(actual - expected) / expected;
  if (diff <= tolerance) return { ok: true };
  return { ok: false, expected, actual };
}

/**
 * Check resolution against 300 DPI hard requirement per CEO §4.8.
 *
 * Returns:
 *   "ok"     — >= 300 DPI at print size (print-quality)
 *   "warn"   — 150 <= DPI < 300 (may look soft)
 *   "reject" — DPI < 150 (hard minimum, blocks export without override)
 *
 * Threshold is compared with a 0.5 DPI tolerance so that standard
 * "300 DPI A4" image dimensions (2480×3508) pass despite floating-point
 * rounding — 2480px / (210mm/25.4) = 299.97 DPI, which every printer
 * accepts as 300.
 */
export function validateResolution(
  imageWidthPx: number,
  slotWidthMM: number
): "ok" | "warn" | "reject" {
  const mmToInch = 25.4;
  const slotWidthInch = slotWidthMM / mmToInch;
  const dpi = imageWidthPx / slotWidthInch;
  if (dpi >= 299.5) return "ok";
  if (dpi >= 149.5) return "warn";
  return "reject";
}

/** Slot-width in mm for DPI calculation. */
export const AD_SLOT_TRIM_WIDTH_MM: Record<AdSlotType, number> = {
  full_page: 210,
  double_page_spread: 420,
  half_page_horizontal: 210,
  half_page_vertical: 105,
  quarter_page: 105,
  strip: 210,
  vertical_strip: 40,
  eighth_page: 105,
  cover_strip: 210,
  corner_bookmark: 60,
  section_sponsor_strip: 210,
};
