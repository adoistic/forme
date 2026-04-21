import { describe, expect, test } from "vitest";
import { ArticleSchema, ContentTypeSchema, countWords } from "../../../../src/shared/schemas/article.js";
import { randomUUID } from "node:crypto";

describe("countWords", () => {
  test("counts English words by whitespace", () => {
    expect(countWords("The quick brown fox")).toBe(4);
  });

  test("counts Devanagari words", () => {
    expect(countWords("मोदी ने दिल्ली का दौरा किया")).toBe(6);
  });

  test("handles multiple spaces + newlines", () => {
    expect(countWords("word1\n\n\tword2   word3")).toBe(3);
  });

  test("empty + whitespace → 0", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });
});

describe("ContentTypeSchema", () => {
  test("accepts all 7 canonical content types", () => {
    const types = ["Article", "Poem", "Interview", "Photo Essay", "Opinion", "Brief", "Letter"];
    for (const t of types) {
      expect(() => ContentTypeSchema.parse(t)).not.toThrow();
    }
  });

  test("rejects unknown types", () => {
    expect(() => ContentTypeSchema.parse("Essay")).toThrow();
    expect(() => ContentTypeSchema.parse("article")).toThrow(); // case-sensitive
  });
});

describe("ArticleSchema", () => {
  const validArticle = {
    id: randomUUID(),
    issue_id: randomUUID(),
    headline: "Test headline",
    deck: null,
    byline: "by Someone",
    byline_position: "top" as const,
    body: "Body text of some length.",
    language: "en" as const,
    word_count: 5,
    content_type: "Article" as const,
    pull_quote: null,
    sidebar: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  test("parses a valid article", () => {
    expect(() => ArticleSchema.parse(validArticle)).not.toThrow();
  });

  test("rejects empty body", () => {
    expect(() => ArticleSchema.parse({ ...validArticle, body: "" })).toThrow();
  });

  test("rejects empty headline", () => {
    expect(() => ArticleSchema.parse({ ...validArticle, headline: "" })).toThrow();
  });

  test("rejects negative word_count", () => {
    expect(() => ArticleSchema.parse({ ...validArticle, word_count: -5 })).toThrow();
  });

  test("accepts nullable deck + byline + pull_quote + sidebar", () => {
    const article = {
      ...validArticle,
      deck: null,
      byline: null,
      pull_quote: null,
      sidebar: null,
    };
    expect(() => ArticleSchema.parse(article)).not.toThrow();
  });

  test("rejects non-uuid id", () => {
    expect(() => ArticleSchema.parse({ ...validArticle, id: "not-a-uuid" })).toThrow();
  });
});
