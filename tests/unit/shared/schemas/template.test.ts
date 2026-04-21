import { describe, expect, test } from "vitest";
import { TemplateSchema } from "../../../../src/shared/schemas/template.js";

const baseTemplate = {
  schemaVersion: 1 as const,
  id: "standard_feature_a4",
  family: "feature" as const,
  page_size: "A4" as const,
  page_count_range: [2, 3] as [number, number],
  word_count_range: {
    en: [900, 1800] as [number, number],
    hi: [700, 1400] as [number, number],
  },
  required_images: 1,
  optional_images: [0, 2] as [number, number],
  image_aspect_preferences: ["landscape" as const, "any" as const],
  supports_pull_quote: true,
  supports_sidebar: false,
  language_modes: ["en" as const, "hi" as const, "bilingual" as const],
  content_type: "Article" as const,
  typography_pairing_default: "Editorial Serif",
  exposed_settings: ["include_pull_quote", "ad_slots_on_article"],
  typography: {
    body_pt: 10,
    body_leading_pt: 14,
    headline_pt: 36,
    caption_pt: 9,
    deck_pt: 18,
  },
  geometry: {
    trim_mm: [210, 297] as [number, number],
    bleed_mm: 3,
    safe_mm: 5,
    columns: 3,
    gutter_mm: 5,
    margins_mm: { top: 15, right: 15, bottom: 20, left: 15 },
  },
};

describe("TemplateSchema", () => {
  test("parses a complete template", () => {
    expect(() => TemplateSchema.parse(baseTemplate)).not.toThrow();
  });

  test("rejects schemaVersion != 1", () => {
    expect(() => TemplateSchema.parse({ ...baseTemplate, schemaVersion: 2 })).toThrow();
  });

  test("rejects reversed word_count_range (en)", () => {
    const bad = {
      ...baseTemplate,
      word_count_range: { en: [1800, 900], hi: [700, 1400] },
    };
    expect(() => TemplateSchema.parse(bad)).toThrow(/word_count_range.en/);
  });

  test("rejects reversed page_count_range", () => {
    const bad = { ...baseTemplate, page_count_range: [5, 2] };
    expect(() => TemplateSchema.parse(bad)).toThrow(/page_count_range/);
  });

  test("rejects reversed optional_images range", () => {
    const bad = { ...baseTemplate, optional_images: [5, 0] };
    expect(() => TemplateSchema.parse(bad)).toThrow(/optional_images/);
  });

  test("requires at least one language mode", () => {
    expect(() => TemplateSchema.parse({ ...baseTemplate, language_modes: [] })).toThrow();
  });

  test("rejects unknown family", () => {
    expect(() =>
      TemplateSchema.parse({ ...baseTemplate, family: "not_a_family" })
    ).toThrow();
  });

  test("allows zero required_images", () => {
    const t = { ...baseTemplate, required_images: 0, optional_images: [0, 0] as [number, number] };
    expect(() => TemplateSchema.parse(t)).not.toThrow();
  });
});
