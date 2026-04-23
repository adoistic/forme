/**
 * Shared BlockNote schema constants — referenced by both the renderer
 * (article body editor) and the main process (snapshot store) so a bump
 * here surfaces everywhere.
 *
 * Per CEO plan ER2-9: snapshots written under one schema version may not
 * be patch-compatible with deltas written under another. The snapshot
 * store compares the per-row `block_schema_version` against this constant
 * and forces a fresh fallback_full instead of attempting a delta when
 * they diverge.
 */

/**
 * Current BlockNote schema version. Bump when the block JSON shape
 * changes in a way that breaks forward compatibility (e.g., renamed
 * block types, restructured inline content). Snapshots written under an
 * older version trigger a fallback_full reconstruction instead of a
 * delta against the previous (incompatible) snapshot.
 */
export const BLOCKNOTE_SCHEMA_VERSION = 1;

/**
 * Allowed top-level block types in the v0.6 BlockNote schema. Anything
 * else gets normalized to a paragraph (defense against future schema
 * drift or malicious block JSON loaded from disk).
 */
export const ALLOWED_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
  "image",
] as const;

export type AllowedBlockType = (typeof ALLOWED_BLOCK_TYPES)[number];

export function isAllowedBlockType(t: string): t is AllowedBlockType {
  return (ALLOWED_BLOCK_TYPES as readonly string[]).includes(t);
}
