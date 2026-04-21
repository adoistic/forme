import { describe, expect, test } from "vitest";
import {
  AdSlotTypeSchema,
  AD_SLOT_ASPECT,
  AD_SLOT_TRIM_WIDTH_MM,
  validateAdAspect,
  validateResolution,
} from "../../../../src/shared/schemas/ad.js";

describe("AdSlotTypeSchema", () => {
  test("includes all 11 slot types per CEO §15.1", () => {
    expect(AdSlotTypeSchema.options).toHaveLength(11);
  });

  test("aspect and width lookups exist for every slot type", () => {
    for (const slot of AdSlotTypeSchema.options) {
      expect(AD_SLOT_ASPECT[slot]).toBeGreaterThan(0);
      expect(AD_SLOT_TRIM_WIDTH_MM[slot]).toBeGreaterThan(0);
    }
  });
});

describe("validateAdAspect", () => {
  test("exact match passes", () => {
    const r = validateAdAspect("full_page", 2100, 2970);
    expect(r.ok).toBe(true);
  });

  test("within 1% tolerance passes", () => {
    const r = validateAdAspect("full_page", 2100, 2970 + 20); // ~0.67% off
    expect(r.ok).toBe(true);
  });

  test("outside 1% tolerance fails", () => {
    const r = validateAdAspect("full_page", 2100, 2970 + 100); // ~3.4% off
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.expected).toBeGreaterThan(0);
      expect(r.actual).toBeGreaterThan(0);
    }
  });

  test("half-page horizontal (2:1)", () => {
    // 2:1 ratio — expected 210/148.5 ≈ 1.414
    const r = validateAdAspect("half_page_horizontal", 2000, 1414);
    expect(r.ok).toBe(true);
  });

  test("strip (6:1) accepts long thin images", () => {
    // expected 210/35 = 6
    const r = validateAdAspect("strip", 1800, 300);
    expect(r.ok).toBe(true);
  });

  test("custom tolerance", () => {
    const strict = validateAdAspect("full_page", 2100, 2970 + 50, 0.001);
    expect(strict.ok).toBe(false);
    const loose = validateAdAspect("full_page", 2100, 2970 + 50, 0.05);
    expect(loose.ok).toBe(true);
  });
});

describe("validateResolution", () => {
  test("2480px wide for A4 210mm → 300 DPI (ok)", () => {
    // 210mm / 25.4 = 8.27in; 2480 / 8.27 ≈ 300 DPI
    expect(validateResolution(2480, 210)).toBe("ok");
  });

  test("1240px wide for A4 → ~150 DPI (warn)", () => {
    expect(validateResolution(1240, 210)).toBe("warn");
  });

  test("500px wide for A4 → ~60 DPI (reject)", () => {
    expect(validateResolution(500, 210)).toBe("reject");
  });

  test("half-page (105mm) at 300 DPI", () => {
    // 105mm = 4.13in; 300 DPI ≈ 1239px wide
    expect(validateResolution(1240, 105)).toBe("ok");
  });
});
