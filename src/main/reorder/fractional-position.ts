// Fractional position helpers for drag-reorder (v0.6 T13).
// REAL display_position lets a single drag rewrite one row instead of
// shifting every neighbor. The trade-off is precision: each midpoint
// halves the gap between two existing positions, so after enough drags
// in the same neighborhood the gap drops below the float epsilon. When
// that happens midpoint() returns null and the caller triggers a
// rebalance that re-spaces the table to integers.

/** Threshold below which `midpoint` returns null (rebalance trigger). */
export const REBALANCE_THRESHOLD = 1e-6;

/**
 * Compute the fractional position to insert between two existing positions.
 * If `before` or `after` is null, treats it as -Infinity / +Infinity
 * respectively (i.e. inserting at the head or tail of the list).
 *
 * Returns null when the gap drops below REBALANCE_THRESHOLD so the caller
 * knows it must rebalance the table before completing the reorder.
 */
export function midpoint(before: number | null, after: number | null): number | null {
  if (before === null && after === null) {
    // Empty list: just start at 1.
    return 1;
  }
  if (before === null && after !== null) {
    // Insert at head: take a step below `after`.
    return after - 1;
  }
  if (before !== null && after === null) {
    // Insert at tail: take a step above `before`.
    return before + 1;
  }
  // Both present — true midpoint. Rebalance needed when the gap is too small
  // to represent without losing precision in subsequent inserts.
  // (The non-null assertions are safe — guarded by the branches above.)
  const a = before as number;
  const b = after as number;
  if (b - a < REBALANCE_THRESHOLD) {
    return null;
  }
  return (a + b) / 2;
}

/**
 * Rebalance an ordered list of positions to evenly-spaced integers
 * starting at 1. Returns the new positions in the same order as the input.
 * Empty input returns an empty array.
 */
export function rebalance(positions: number[]): number[] {
  return positions.map((_, i) => i + 1);
}
