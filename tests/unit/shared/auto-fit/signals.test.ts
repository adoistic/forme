import { describe, expect, test } from "vitest";
import {
  wordCountFitScore,
  imageCountFitScore,
  imageAspectBonus,
  pullQuoteBonus,
  sidebarBonus,
} from "../../../../src/shared/auto-fit/signals.js";
import type { Template } from "../../../../src/shared/schemas/template.js";

const standardFeatureA4: Template = {
  schemaVersion: 1,
  id: "standard_feature_a4",
  family: "feature",
  page_size: "A4",
  page_count_range: [2, 3],
  word_count_range: {
    en: [900, 1800],
    hi: [700, 1400],
  },
  required_images: 1,
  optional_images: [0, 2],
  image_aspect_preferences: ["landscape", "any"],
  supports_pull_quote: true,
  supports_sidebar: false,
  language_modes: ["en", "hi", "bilingual"],
  content_type: "Article",
  typography_pairing_default: "Editorial Serif",
  exposed_settings: [],
  typography: {
    body_pt: 10,
    body_leading_pt: 14,
    headline_pt: 36,
  },
  geometry: {
    trim_mm: [210, 297],
    bleed_mm: 3,
    safe_mm: 5,
    columns: 3,
    gutter_mm: 5,
    margins_mm: { top: 15, right: 15, bottom: 20, left: 15 },
  },
};

describe("wordCountFitScore", () => {
  test("below min returns null (filtered)", () => {
    expect(wordCountFitScore({ word_count: 500, language: "en" }, standardFeatureA4)).toBeNull();
  });

  test("above max returns null (filtered)", () => {
    expect(wordCountFitScore({ word_count: 3000, language: "en" }, standardFeatureA4)).toBeNull();
  });

  test("at exact min returns a score < 1 (edge of range)", () => {
    const s = wordCountFitScore({ word_count: 900, language: "en" }, standardFeatureA4);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(0);
    expect(s!).toBeLessThan(1);
  });

  test("at geometric mean returns 1.0", () => {
    // sqrt(900 * 1800) = sqrt(1_620_000) ≈ 1273
    const s = wordCountFitScore({ word_count: 1273, language: "en" }, standardFeatureA4);
    expect(s).toBeCloseTo(1, 1);
  });

  test("Hindi uses hi range", () => {
    // hi range: 700–1400. 1200 should be inside for hi but out for en is false (1200<1800 so it's in en).
    // Try 1500: in en (900-1800), out of hi (>1400)
    const en = wordCountFitScore({ word_count: 1500, language: "en" }, standardFeatureA4);
    expect(en).not.toBeNull();
    const hi = wordCountFitScore({ word_count: 1500, language: "hi" }, standardFeatureA4);
    expect(hi).toBeNull();
  });

  test("bilingual uses widest envelope", () => {
    // Widest envelope: min of mins (700) → max of maxes (1800)
    const s1 = wordCountFitScore({ word_count: 800, language: "bilingual" }, standardFeatureA4);
    expect(s1).not.toBeNull();
    const s2 = wordCountFitScore({ word_count: 1900, language: "bilingual" }, standardFeatureA4);
    expect(s2).toBeNull();
  });
});

describe("imageCountFitScore", () => {
  test("below required returns null", () => {
    expect(imageCountFitScore({ image_count: 0 }, standardFeatureA4)).toBeNull();
  });

  test("above optional_max returns null", () => {
    // required=1, optional=[0,2] → total max is 1+2=3; 4 images → null
    expect(imageCountFitScore({ image_count: 4 }, standardFeatureA4)).toBeNull();
  });

  test("exactly required returns a score", () => {
    // 1 image, beyond = 0 which is optMin; linear decay; score > 0
    const s = imageCountFitScore({ image_count: 1 }, standardFeatureA4);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(0);
    expect(s!).toBeLessThanOrEqual(1);
  });

  test("at midpoint of optional range returns 1.0", () => {
    // required=1, optional=[0,2], midpoint = (0+2)/2 = 1. So total = 1+1 = 2 images.
    const s = imageCountFitScore({ image_count: 2 }, standardFeatureA4);
    expect(s).toBe(1);
  });
});

describe("imageAspectBonus", () => {
  test("matching aspect returns small positive lift", () => {
    const s = imageAspectBonus({ image_aspects: ["landscape"] }, standardFeatureA4);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(0.2);
  });

  test("no preferences in article returns 0", () => {
    const s = imageAspectBonus({}, standardFeatureA4);
    expect(s).toBe(0);
  });

  test("any preference gives 0.1 baseline", () => {
    // Template prefers ["landscape", "any"] — article with "portrait" still scores via "any"
    const s = imageAspectBonus({ image_aspects: ["portrait"] }, standardFeatureA4);
    expect(s).toBe(0.1);
  });
});

describe("pullQuoteBonus", () => {
  test("article has, template supports → +0.15", () => {
    expect(pullQuoteBonus({ has_pull_quote: true }, standardFeatureA4)).toBe(0.15);
  });

  test("article has, template doesn't support → 0 (no penalty)", () => {
    const noPQ: Template = { ...standardFeatureA4, supports_pull_quote: false };
    expect(pullQuoteBonus({ has_pull_quote: true }, noPQ)).toBe(0);
  });

  test("article doesn't have → 0", () => {
    expect(pullQuoteBonus({ has_pull_quote: false }, standardFeatureA4)).toBe(0);
  });
});

describe("sidebarBonus", () => {
  test("template doesn't support sidebar → 0", () => {
    // standardFeatureA4.supports_sidebar = false
    expect(sidebarBonus({ has_sidebar: true }, standardFeatureA4)).toBe(0);
  });

  test("template supports + article has → +0.15", () => {
    const withSidebar: Template = { ...standardFeatureA4, supports_sidebar: true };
    expect(sidebarBonus({ has_sidebar: true }, withSidebar)).toBe(0.15);
  });
});
