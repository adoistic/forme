// Error code → user-facing message registry.
// Keep messages plain, operator-voice (DESIGN.md §13): explain + suggest.
// Internal-only errors (like db_busy on first try) can use terser text since
// they rarely surface to the operator.

export const errorMessages: Record<string, string> = {
  // File ingest
  unsupported_file_type: "We couldn't read that file. Supported types are .docx and .txt.",
  corrupt_archive: "This file looks corrupted. Try re-exporting from Word.",
  empty_body: "This article has no body text. Edit it to add content.",
  docx_media_extraction_error:
    "We imported the text but couldn't extract {count} embedded images. Upload them separately.",
  language_ambiguous: "We couldn't detect the language. Assumed English; click to change.",

  // Image ingest
  resolution_warning:
    "This image is {dpi} DPI at print size. It may look soft. Upload a higher-res version?",
  resolution_below_hard_min: "This image is {dpi} DPI. Too low for print. Override anyway?",
  color_profile_converted: "Image color profile was converted to sRGB.",
  corrupt_image: "This image file is corrupt. Try a fresh export from your source.",
  file_too_large: "This image is {size}. Import anyway? (It may be slow.)",

  // Ad ingest
  ad_aspect_mismatch:
    "This slot expects {expected_aspect}. Your image is {actual_aspect}. Please supply a correctly proportioned creative.",
  ad_resolution_error: "This ad is below 300 DPI at print size. Override or re-upload?",
  dps_gutter_warning:
    "The center of this double-page spread looks busy — faces or text may be cut by the gutter.",
  cover_strip_too_short: "This cover strip is too short — expected at least 30mm tall.",

  // Pretext / fonts
  font_not_loaded: "Required fonts are missing. Reinstall fonts?",
  column_too_narrow:
    "This template's column is too narrow for the chosen font. Pick a different template or pairing.",
  glyph_missing:
    "Some characters in this article don't have glyphs in {font}. Review the marked positions.",

  // Auto-fit
  no_viable_template: "No template fits this article. {reason}",
  article_too_long:
    "This article is {words} words. The longest template supports {max}. Split into Part 1 / Part 2?",
  article_too_short: "This article is {words} words. Try News Brief or Short Piece template?",
  image_count_mismatch: "Article has {article_images} images; templates need {template_images}.",
  ambiguous_match: "Multiple templates fit almost equally. Pick one.",

  // PPTX generate
  template_incomplete: "Can't export: {article_title} is missing {field}. Fix?",
  font_subset_too_large:
    "Font subset is larger than expected. Embed full font? (file size larger.)",
  blob_missing: "Image missing from asset store. Replace or mark for review?",
  ooxml_validation_error:
    "Export blocked — the PPTX file failed validation. Bug report generated at {path}.",
  disk_full: "Ran out of disk space. Clear some files and try again.",
  invalid_export_path: "That file path isn't valid. Try another?",

  // Database
  db_busy: "Saving... retrying.",
  db_corrupt: "Your project database is damaged. Restore from backup?",
  db_migration_failed: "Couldn't update the project database. Restore from the latest backup?",

  // Crash recovery
  lock_ambiguous: "Recover from prior session? (May be incomplete)",
  snapshot_corrupt: "Most recent snapshot is corrupt. Restore from {earlier_timestamp}?",
  blob_hash_mismatch: "Image {filename} has been corrupted.",
  restore_failed: "Couldn't restore that snapshot. Try another?",
  snapshot_stale: "That snapshot was deleted. The list will refresh.",

  // Article edit (v0.6)
  article_body_required: "Article body can't be empty. Delete the article instead.",
  not_found: "Couldn't find that {resource}. It may have been deleted.",

  // CSV import
  encoding_error: "Row {row} is not valid UTF-8. Re-save as UTF-8 and retry.",
  csv_parse_error: "Row {row} has unbalanced quotes. Fix and re-import.",
  row_validation_error: "Row {row}: {field} is invalid.",
  size_cap_exceeded: "This CSV has {rows} rows. Max 1000; split into two?",
  field_validation_error: "{field} on row {row} is invalid.",
  image_reference_not_found: "Image '{filename}' on row {row} is not in the Content Library.",
  duplicate_entry: "Row {row} looks like an existing classified ({name} / {phone}).",

  // Classifieds packing
  entry_too_tall:
    "This classified is too tall for a single column. It will run as an Extended Notice (full-width page).",
  packing_overflow:
    "Classifieds section overflows the allocated pages. Moving overflow to a new page.",

  // OOXML / LibreOffice validator
  libreoffice_not_installed:
    "LibreOffice isn't installed. Forme uses it to validate exports. Please install from https://www.libreoffice.org/.",
  libreoffice_timeout: "Validation took too long. Try a smaller issue or re-run the check.",

  // IPC / system
  unknown_error: "Something went wrong. Export diagnostics from Help menu and share with support.",
  ipc_handler_missing: "Internal error: no handler registered for this request.",
  ipc_handler_threw: "Internal error in '{channel}'.",
} as const;

/**
 * Resolve a StructuredError to a user-facing message.
 * Substitutes {placeholders} from the error context.
 */
export function resolveMessage(code: string, context: Record<string, unknown> = {}): string {
  const template = errorMessages[code];
  if (!template) {
    return errorMessages["unknown_error"] ?? "Something went wrong.";
  }
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = context[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}
