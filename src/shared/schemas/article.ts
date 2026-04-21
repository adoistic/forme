import { z } from "zod";
import { LanguageSchema } from "./language.js";

// Per CEO plan Section 10 — 7 content types (no auto-detection, operator tags).
export const ContentTypeSchema = z.enum([
  "Article",
  "Poem",
  "Interview",
  "Photo Essay",
  "Opinion",
  "Brief",
  "Letter",
]);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const ArticleSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  headline: z.string().min(1).max(500),
  deck: z.string().max(800).nullable(),
  byline: z.string().max(200).nullable(),
  body: z.string().min(1),
  language: LanguageSchema,
  word_count: z.number().int().nonnegative(),
  content_type: ContentTypeSchema,
  pull_quote: z.string().max(500).nullable(),
  sidebar: z.string().max(2000).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Article = z.infer<typeof ArticleSchema>;

/**
 * Word count for the body. Handles Latin + Devanagari by splitting on whitespace
 * and filtering empty tokens. Good enough for auto-fit ranges.
 */
export function countWords(body: string): number {
  if (!body) return 0;
  return body
    .trim()
    .split(/\s+/u)
    .filter((w) => w.length > 0).length;
}
