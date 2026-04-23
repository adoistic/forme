import { describe, expect, test } from "vitest";
import {
  midpoint,
  rebalance,
  REBALANCE_THRESHOLD,
} from "../../../src/main/reorder/fractional-position.js";

describe("midpoint", () => {
  test("empty list returns 1", () => {
    expect(midpoint(null, null)).toBe(1);
  });

  test("inserting at head takes after - 1", () => {
    expect(midpoint(null, 5)).toBe(4);
  });

  test("inserting at tail takes before + 1", () => {
    expect(midpoint(2, null)).toBe(3);
  });

  test("inserting between two integers returns the midpoint", () => {
    expect(midpoint(1, 2)).toBe(1.5);
    expect(midpoint(1.5, 2)).toBe(1.75);
  });

  test("repeated bisection drives the gap toward the threshold", () => {
    const a = 1;
    let b = 2;
    for (let i = 0; i < 10; i += 1) {
      const m = midpoint(a, b);
      if (m === null) break;
      // Always insert just below b: a stays, b becomes the new midpoint.
      b = m;
    }
    // After 10 bisections we're nowhere near the threshold.
    expect(b - a).toBeGreaterThan(REBALANCE_THRESHOLD);
  });

  test("returns null when the gap drops below REBALANCE_THRESHOLD", () => {
    // Two positions arbitrarily close — caller must rebalance.
    expect(midpoint(1, 1 + REBALANCE_THRESHOLD / 2)).toBeNull();
  });

  test("returns a valid midpoint when gap is comfortably above threshold", () => {
    // Above the threshold the function still bisects.
    const result = midpoint(1, 1 + REBALANCE_THRESHOLD * 10);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(1 + (REBALANCE_THRESHOLD * 10) / 2);
  });
});

describe("rebalance", () => {
  test("empty input returns empty array", () => {
    expect(rebalance([])).toEqual([]);
  });

  test("returns evenly-spaced integers starting at 1", () => {
    expect(rebalance([0.1, 0.2, 0.5])).toEqual([1, 2, 3]);
  });

  test("preserves the input order (caller pre-sorts)", () => {
    // rebalance does not sort — it just re-positions in the order it
    // received. The caller is expected to sort before calling.
    const out = rebalance([5, 3, 9, 1]);
    expect(out).toEqual([1, 2, 3, 4]);
  });

  test("scales to large lists", () => {
    const input = Array.from({ length: 1000 }, (_, i) => i);
    const out = rebalance(input);
    expect(out[0]).toBe(1);
    expect(out[999]).toBe(1000);
  });
});

describe("REBALANCE_THRESHOLD", () => {
  test("is 1e-6", () => {
    expect(REBALANCE_THRESHOLD).toBe(1e-6);
  });
});
