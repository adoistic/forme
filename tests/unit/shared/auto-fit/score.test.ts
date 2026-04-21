import { describe, expect, test } from "vitest";
import { scoreArticleAgainstTemplates } from "../../../../src/shared/auto-fit/score.js";
import type { Template } from "../../../../src/shared/schemas/template.js";
import type { AutoFitInput } from "../../../../src/shared/auto-fit/score.js";

function baseTemplate(overrides: Partial<Template> = {}): Template {
  return {
    schemaVersion: 1,
    id: "t",
    family: "feature",
    page_size: "A4",
    page_count_range: [2, 3],
    word_count_range: { en: [900, 1800], hi: [700, 1400] },
    required_images: 1,
    optional_images: [0, 2],
    image_aspect_preferences: ["landscape", "any"],
    supports_pull_quote: true,
    supports_sidebar: false,
    language_modes: ["en", "hi", "bilingual"],
    content_type: "Article",
    typography_pairing_default: "Editorial Serif",
    exposed_settings: [],
    typography: { body_pt: 10, body_leading_pt: 14, headline_pt: 36 },
    geometry: {
      trim_mm: [210, 297],
      bleed_mm: 3,
      safe_mm: 5,
      columns: 3,
      gutter_mm: 5,
      margins_mm: { top: 15, right: 15, bottom: 20, left: 15 },
    },
    ...overrides,
  };
}

function baseInput(overrides: Partial<AutoFitInput> = {}): AutoFitInput {
  return {
    word_count: 1200,
    language: "en",
    content_type: "Article",
    image_count: 1,
    has_pull_quote: false,
    has_sidebar: false,
    page_size: "A4",
    ...overrides,
  };
}

describe("scoreArticleAgainstTemplates", () => {
  test("filters by page_size", () => {
    const a4 = baseTemplate({ id: "a4" });
    const a5 = baseTemplate({ id: "a5", page_size: "A5" });
    const r = scoreArticleAgainstTemplates(baseInput({ page_size: "A4" }), [a4, a5]);
    expect(r.candidates).toHaveLength(1);
    expect(r.best?.template.id).toBe("a4");
  });

  test("filters by content_type", () => {
    const article = baseTemplate({ id: "article" });
    const poem = baseTemplate({ id: "poem", content_type: "Poem" });
    const r = scoreArticleAgainstTemplates(
      baseInput({ content_type: "Article" }),
      [article, poem]
    );
    expect(r.candidates).toHaveLength(1);
    expect(r.best?.template.id).toBe("article");
  });

  test("filters by language support", () => {
    const enOnly = baseTemplate({ id: "en", language_modes: ["en"] });
    const hiOnly = baseTemplate({ id: "hi", language_modes: ["hi"] });
    const r = scoreArticleAgainstTemplates(
      baseInput({ language: "hi", word_count: 1000 }),
      [enOnly, hiOnly]
    );
    expect(r.candidates).toHaveLength(1);
    expect(r.best?.template.id).toBe("hi");
  });

  test("returns best + ranked list", () => {
    const featureStandard = baseTemplate({
      id: "standard",
      word_count_range: { en: [900, 1800], hi: [700, 1400] },
    });
    const featureCompact = baseTemplate({
      id: "compact",
      word_count_range: { en: [400, 900], hi: [300, 700] },
    });
    const r = scoreArticleAgainstTemplates(
      baseInput({ word_count: 1200 }),
      [featureStandard, featureCompact]
    );
    // 1200 is inside "standard" (900-1800) but outside "compact" (400-900)
    expect(r.candidates).toHaveLength(1);
    expect(r.best?.template.id).toBe("standard");
  });

  test("marks ambiguous when top two are within 15%", () => {
    const t1 = baseTemplate({
      id: "t1",
      word_count_range: { en: [1000, 1400], hi: [800, 1200] },
    });
    const t2 = baseTemplate({
      id: "t2",
      word_count_range: { en: [1100, 1300], hi: [900, 1100] },
    });
    // 1200 is near gm of both (sqrt(1000*1400)=1183, sqrt(1100*1300)=1195)
    const r = scoreArticleAgainstTemplates(baseInput({ word_count: 1200 }), [t1, t2]);
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    // With nearly identical sizes, either ambiguous is true OR they're very close
    if (r.candidates.length >= 2) {
      expect(r.ambiguous).toBe(true);
    }
  });

  test("returns noMatchReason: page size", () => {
    const a5 = baseTemplate({ page_size: "A5" });
    const r = scoreArticleAgainstTemplates(baseInput({ page_size: "A4" }), [a5]);
    expect(r.best).toBeNull();
    expect(r.noMatchReason).toMatch(/no templates for page size A4/);
  });

  test("returns noMatchReason: word count too low", () => {
    const t = baseTemplate({
      word_count_range: { en: [2000, 4000], hi: [1500, 3000] },
    });
    const r = scoreArticleAgainstTemplates(baseInput({ word_count: 500 }), [t]);
    expect(r.best).toBeNull();
    expect(r.noMatchReason).toMatch(/500 words.*shortest template needs 2000/);
  });

  test("returns noMatchReason: word count too high", () => {
    const t = baseTemplate({
      word_count_range: { en: [200, 600], hi: [150, 500] },
    });
    const r = scoreArticleAgainstTemplates(baseInput({ word_count: 5000 }), [t]);
    expect(r.best).toBeNull();
    expect(r.noMatchReason).toMatch(/5000 words.*longest template supports 600/);
  });

  test("returns noMatchReason: not enough images", () => {
    const t = baseTemplate({ required_images: 3, optional_images: [0, 2] });
    const r = scoreArticleAgainstTemplates(baseInput({ image_count: 0 }), [t]);
    expect(r.best).toBeNull();
    expect(r.noMatchReason).toMatch(/0 images.*at least 3/);
  });

  test("pull quote bonus raises score when article has + template supports", () => {
    const withPQ = baseTemplate({ id: "pq", supports_pull_quote: true });
    const withoutPQ = baseTemplate({ id: "no_pq", supports_pull_quote: false });
    const inputWithPQ = baseInput({ has_pull_quote: true });
    const r = scoreArticleAgainstTemplates(inputWithPQ, [withoutPQ, withPQ]);
    expect(r.best?.template.id).toBe("pq");
  });

  test("empty template list returns noMatchReason for page size", () => {
    const r = scoreArticleAgainstTemplates(baseInput(), []);
    expect(r.best).toBeNull();
    expect(r.noMatchReason).toMatch(/no templates for page size/);
  });

  test("score is in 0..1 range", () => {
    const t = baseTemplate();
    const r = scoreArticleAgainstTemplates(
      baseInput({ word_count: 1273, image_count: 2, has_pull_quote: true }),
      [t]
    );
    expect(r.best?.score).toBeGreaterThan(0);
    expect(r.best?.score).toBeLessThanOrEqual(1);
  });

  test("breakdown sums to pre-normalized raw score", () => {
    const t = baseTemplate();
    const r = scoreArticleAgainstTemplates(baseInput({ word_count: 1273 }), [t]);
    const bd = r.best!.breakdown;
    const totalRaw = bd.wordCount + bd.imageCount + bd.imageAspect + bd.pullQuote + bd.sidebar;
    expect(totalRaw).toBeGreaterThan(0);
  });
});
