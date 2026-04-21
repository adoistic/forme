import { describe, expect, test } from "vitest";
import { describeDiff } from "../../../../src/main/snapshot-store/diff.js";
import type { SerializedIssue } from "../../../../src/main/snapshot-store/types.js";

function base(overrides: Partial<SerializedIssue> = {}): SerializedIssue {
  return {
    id: "issue-1",
    title: "Test Issue",
    issue_number: 1,
    issue_date: "2026-04-21",
    page_size: "A4",
    typography_pairing: "Editorial Serif",
    primary_language: "en",
    bw_mode: false,
    articles: [],
    classifieds: [],
    ads: [],
    placements: [],
    updated_at: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("describeDiff", () => {
  test("null prev → 'Created issue'", () => {
    const next = base({ title: "The Modi Issue" });
    expect(describeDiff(null, next)).toMatch(/^Created issue "The Modi Issue"/);
  });

  test("typography change → 'Changed typography pairing'", () => {
    const prev = base({ typography_pairing: "Editorial Serif" });
    const next = base({ typography_pairing: "News Sans" });
    expect(describeDiff(prev, next)).toBe("Changed typography pairing to News Sans");
  });

  test("page size change", () => {
    const prev = base({ page_size: "A4" });
    const next = base({ page_size: "A5" });
    expect(describeDiff(prev, next)).toBe("Changed page size to A5");
  });

  test("B&W mode toggle on", () => {
    const prev = base({ bw_mode: false });
    const next = base({ bw_mode: true });
    expect(describeDiff(prev, next)).toBe("Switched to black-and-white mode");
  });

  test("B&W mode toggle off", () => {
    const prev = base({ bw_mode: true });
    const next = base({ bw_mode: false });
    expect(describeDiff(prev, next)).toBe("Switched to color mode");
  });

  test("adding a single article → headline-specific message", () => {
    const prev = base();
    const next = base({
      articles: [
        { id: "a1", headline: "Modi visits Delhi", language: "en", word_count: 1200, content_type: "Article" },
      ],
    });
    expect(describeDiff(prev, next)).toBe("Added article: Modi visits Delhi");
  });

  test("adding multiple articles → count message", () => {
    const prev = base();
    const next = base({
      articles: [
        { id: "a1", headline: "One", language: "en", word_count: 100, content_type: "Article" },
        { id: "a2", headline: "Two", language: "en", word_count: 100, content_type: "Article" },
        { id: "a3", headline: "Three", language: "en", word_count: 100, content_type: "Article" },
      ],
    });
    expect(describeDiff(prev, next)).toBe("Added 3 articles");
  });

  test("removing a single article", () => {
    const article = { id: "a1", headline: "Going away", language: "en" as const, word_count: 100, content_type: "Article" };
    const prev = base({ articles: [article] });
    const next = base();
    expect(describeDiff(prev, next)).toBe("Removed article: Going away");
  });

  test("editing an article headline → 'Edited article'", () => {
    const prev = base({
      articles: [{ id: "a1", headline: "Old headline", language: "en", word_count: 100, content_type: "Article" }],
    });
    const next = base({
      articles: [{ id: "a1", headline: "New better headline", language: "en", word_count: 100, content_type: "Article" }],
    });
    expect(describeDiff(prev, next)).toBe("Edited article: New better headline");
  });

  test("adding classifieds of a single type", () => {
    const prev = base();
    const next = base({
      classifieds: [
        { id: "c1", type: "matrimonial_with_photo", language: "en", weeks_to_run: 3 },
        { id: "c2", type: "matrimonial_with_photo", language: "en", weeks_to_run: 3 },
        { id: "c3", type: "matrimonial_with_photo", language: "en", weeks_to_run: 3 },
      ],
    });
    expect(describeDiff(prev, next)).toBe("Added 3 matrimonial with photo classifieds");
  });

  test("adding classifieds of mixed types → generic count", () => {
    const prev = base();
    const next = base({
      classifieds: [
        { id: "c1", type: "matrimonial_with_photo", language: "en", weeks_to_run: 3 },
        { id: "c2", type: "obituary", language: "en", weeks_to_run: 1 },
      ],
    });
    expect(describeDiff(prev, next)).toBe("Added 2 classifieds");
  });

  test("removing classifieds", () => {
    const prev = base({
      classifieds: [
        { id: "c1", type: "matrimonial_with_photo", language: "en", weeks_to_run: 3 },
        { id: "c2", type: "obituary", language: "en", weeks_to_run: 1 },
      ],
    });
    const next = base();
    expect(describeDiff(prev, next)).toBe("Removed 2 classifieds");
  });

  test("placing an item on a single page", () => {
    const prev = base();
    const next = base({
      placements: [
        {
          id: "p1",
          page_number: 7,
          slot_index: 0,
          template_id: "standard_feature_a4",
          content_kind: "article",
          article_id: "a1",
          ad_id: null,
        },
      ],
    });
    expect(describeDiff(prev, next)).toBe("Placed on page 7");
  });

  test("reordering placements", () => {
    const p = (id: string, page: number) => ({
      id,
      page_number: page,
      slot_index: 0,
      template_id: "standard_feature_a4",
      content_kind: "article",
      article_id: id,
      ad_id: null,
    });
    const prev = base({ placements: [p("p1", 4), p("p2", 6), p("p3", 8)] });
    const next = base({ placements: [p("p1", 12), p("p2", 14), p("p3", 18)] });
    expect(describeDiff(prev, next)).toMatch(/Reordered pages 12-18/);
  });

  test("title rename", () => {
    const prev = base({ title: "Old" });
    const next = base({ title: "New Better Name" });
    expect(describeDiff(prev, next)).toBe(`Renamed issue to "New Better Name"`);
  });

  test("no material change → Auto-save", () => {
    const state = base();
    expect(describeDiff(state, state)).toBe("Auto-save");
  });

  test("headline > 40 chars is truncated with ellipsis", () => {
    const prev = base();
    const long =
      "A very long headline that definitely exceeds forty characters in total length";
    const next = base({
      articles: [{ id: "a1", headline: long, language: "en", word_count: 100, content_type: "Article" }],
    });
    const msg = describeDiff(prev, next);
    expect(msg).toMatch(/^Added article: /);
    expect(msg.length).toBeLessThan(long.length + 20);
    expect(msg).toContain("…");
  });
});
