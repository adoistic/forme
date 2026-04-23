import { diff_match_patch } from "diff-match-patch";

/**
 * Pure diff helpers for `<DiffViewer>` (T9 / v0.6).
 *
 * The component compares two BlockNote documents — arrays of block objects.
 * Each block has a stable `id` field which we use to pair blocks across
 * versions; everything else (children content, props, type) is treated as
 * opaque payload for the purposes of comparison.
 *
 * Two passes:
 *   1. `computeBlockDiff` — block-level pairing. Walks AFTER's order,
 *      inserting REMOVED blocks at their original BEFORE position so the
 *      reader sees a coherent sequence.
 *   2. `computeIntraBlockDiff` — char-level Myers diff via diff-match-patch
 *      on extracted plain text. Only runs when the block landed CHANGED.
 *
 * Both functions are pure and synchronous so they can run inside React
 * `useMemo` without coordination.
 */

/** A single block in a BlockNote document. We treat `id` and content text as the only fields that matter. */
export interface BlockLike {
  id?: string;
  type?: string;
  content?: unknown;
  children?: unknown;
  props?: unknown;
  [key: string]: unknown;
}

export type ChangeKind = "unchanged" | "changed" | "added" | "removed";

export interface DiffEntry {
  /** Position in the merged diff sequence (0-indexed). */
  index: number;
  kind: ChangeKind;
  /** The block from BEFORE — null for ADDED entries. */
  before: BlockLike | null;
  /** The block from AFTER — null for REMOVED entries. */
  after: BlockLike | null;
  /** Plain-text preview, truncated to 24 chars (the diff-map row label). */
  previewText: string;
  /** True if the block exceeds the size cap and char-diff should be skipped. */
  oversize: boolean;
}

/** Threshold at which a single block is too big to attempt char-level diffing on. */
export const MAX_BLOCK_SIZE_BYTES = 75 * 1024;

/** Empty-document sentinel used when one side is `[]`. */
export interface BlockDiffResult {
  entries: DiffEntry[];
  /** Both bodies parsed to identical block sequences. */
  identical: boolean;
  /** Exactly which side(s) had no blocks at all. */
  beforeEmpty: boolean;
  afterEmpty: boolean;
  /** Counters for the sub-header summary line. */
  changedCount: number;
  addedCount: number;
  removedCount: number;
  /** Word delta: AFTER words minus BEFORE words (negative = net removal). */
  wordDelta: number;
}

/**
 * Best-effort plain-text extraction from a BlockNote block. Walks the
 * `content` array and any nested `children`, concatenating every `text`
 * field it finds. Inline objects without `text` (e.g., images) contribute
 * nothing — the diff focuses on the editable prose.
 */
export function extractBlockText(block: BlockLike | null | undefined): string {
  if (!block) return "";
  const out: string[] = [];
  walkContent(block.content, out);
  walkContent(block.children, out);
  return out.join("");
}

function walkContent(content: unknown, out: string[]): void {
  if (typeof content === "string") {
    out.push(content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as { text?: unknown; content?: unknown; children?: unknown };
      if (typeof obj.text === "string") {
        out.push(obj.text);
      }
      if (obj.content !== undefined) walkContent(obj.content, out);
      if (obj.children !== undefined) walkContent(obj.children, out);
    }
  }
}

/**
 * Truncate a string to `n` characters, appending an ellipsis when cut.
 * Whitespace is collapsed first so multi-line blocks render on one row.
 */
export function clipPreview(text: string, n = 24): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= n) return flat;
  return flat.slice(0, n) + "…";
}

/**
 * Word count for the wordDelta summary. Splits on whitespace; matches the
 * `countWords` helper used by article snapshots so the numbers line up.
 */
function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Block-level diff. Pairs BEFORE and AFTER blocks by `id` (when present)
 * and produces a merged sequence the diff overlay can walk linearly.
 *
 * Pairing strategy:
 *   - Build a lookup of AFTER blocks by id.
 *   - Walk BEFORE in order: emit UNCHANGED if the matched AFTER is
 *     identical (deep-equal), CHANGED otherwise. Mark the AFTER block as
 *     "consumed".
 *   - REMOVED: BEFORE block whose id has no AFTER match.
 *   - After the BEFORE walk, emit any unconsumed AFTER blocks in their
 *     original relative order as ADDED.
 *
 * This isn't a full LCS — it's the operator's expectation: "which
 * paragraphs changed since v8". Reorders show up as REMOVED + ADDED if
 * blocks lack stable ids, or as UNCHANGED-but-different-position if they
 * do (diff intentionally ignores position changes).
 */
export function computeBlockDiff(
  beforeBlocks: BlockLike[],
  afterBlocks: BlockLike[]
): BlockDiffResult {
  const beforeEmpty = beforeBlocks.length === 0;
  const afterEmpty = afterBlocks.length === 0;

  // Lookup AFTER by id. Blocks without an id can't be paired and fall
  // through to the unconditional REMOVED/ADDED path.
  const afterById = new Map<string, { block: BlockLike; index: number; consumed: boolean }>();
  afterBlocks.forEach((b, i) => {
    if (typeof b.id === "string" && b.id) {
      afterById.set(b.id, { block: b, index: i, consumed: false });
    }
  });

  const entries: DiffEntry[] = [];
  let changedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  // First pass: walk BEFORE in order.
  for (const beforeBlock of beforeBlocks) {
    const id = typeof beforeBlock.id === "string" ? beforeBlock.id : null;
    const match = id ? afterById.get(id) : undefined;

    if (match && !match.consumed) {
      match.consumed = true;
      const beforeText = extractBlockText(beforeBlock);
      const afterText = extractBlockText(match.block);
      const sameText = beforeText === afterText;
      const sameContent = sameText && sameJSON(beforeBlock, match.block);

      if (sameContent) {
        entries.push(makeEntry(entries.length, "unchanged", beforeBlock, match.block));
      } else {
        changedCount += 1;
        entries.push(makeEntry(entries.length, "changed", beforeBlock, match.block));
      }
    } else {
      removedCount += 1;
      entries.push(makeEntry(entries.length, "removed", beforeBlock, null));
    }
  }

  // Second pass: any AFTER blocks NOT paired during the BEFORE walk are
  // ADDED. We track this via the per-id `consumed` flag: paired AFTER
  // blocks are marked consumed; everything else is new. Blocks without
  // an `id` were never registered in `afterById` and always count as
  // ADDED here.
  for (const afterBlock of afterBlocks) {
    const id = typeof afterBlock.id === "string" ? afterBlock.id : null;
    const match = id ? afterById.get(id) : null;
    if (match && match.consumed) continue;
    addedCount += 1;
    entries.push(makeEntry(entries.length, "added", null, afterBlock));
  }

  const identical = changedCount === 0 && addedCount === 0 && removedCount === 0;

  // Word delta: net difference across the entire AFTER vs. BEFORE bodies.
  // Computed once from the joined text rather than summed per-entry so word
  // counts in CHANGED blocks don't double-count.
  const beforeText = beforeBlocks.map((b) => extractBlockText(b)).join(" ");
  const afterText = afterBlocks.map((b) => extractBlockText(b)).join(" ");
  const wordDelta = wordCount(afterText) - wordCount(beforeText);

  return {
    entries,
    identical,
    beforeEmpty,
    afterEmpty,
    changedCount,
    addedCount,
    removedCount,
    wordDelta,
  };
}

function makeEntry(
  index: number,
  kind: ChangeKind,
  before: BlockLike | null,
  after: BlockLike | null
): DiffEntry {
  // Preview prefers the AFTER text (it's what the operator ends up with).
  // For REMOVED entries we use BEFORE because that's all we have.
  const previewSource = after ?? before;
  const previewText = clipPreview(extractBlockText(previewSource));
  const sizeBytes = approxBlockSize(before, after);
  return {
    index,
    kind,
    before,
    after,
    previewText,
    oversize: sizeBytes > MAX_BLOCK_SIZE_BYTES,
  };
}

function approxBlockSize(before: BlockLike | null, after: BlockLike | null): number {
  // The cap is per-block, but we measure the larger of the two sides
  // because either one becoming oversized makes char-level diff unsafe.
  const a = before ? safeStringifyLength(before) : 0;
  const b = after ? safeStringifyLength(after) : 0;
  return Math.max(a, b);
}

function safeStringifyLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/**
 * Deep equality that JSON-stringifies both sides. Plenty fast for the
 * paragraph-sized blocks we deal with; key-order differences trigger a
 * false "changed" but BlockNote serializes consistently so this is
 * acceptable in practice.
 */
function sameJSON(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// ---- Intra-block char diff -------------------------------------------------

/** A run of characters tagged with whether the operator added, removed, or kept it. */
export interface DiffSegment {
  op: "equal" | "insert" | "delete";
  text: string;
}

/**
 * Run a Myers diff at the character level via diff-match-patch. Cleanup
 * pass collapses noisy single-character flips into semantically-meaningful
 * runs. Returns segments tagged with their op for the renderer to color.
 *
 * Caller should already have skipped the call for oversized blocks (see
 * `MAX_BLOCK_SIZE_BYTES` and `DiffEntry.oversize`).
 */
export function computeIntraBlockDiff(beforeText: string, afterText: string): DiffSegment[] {
  const dmp = new diff_match_patch();
  // 1.5s ceiling — well under the perceptual limit, fast enough for
  // paragraph-sized blocks even on the slowest laptop we target.
  dmp.Diff_Timeout = 1.5;
  const diffs = dmp.diff_main(beforeText, afterText);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]: [number, string]): DiffSegment => {
    if (op === -1) return { op: "delete", text };
    if (op === 1) return { op: "insert", text };
    return { op: "equal", text };
  });
}
