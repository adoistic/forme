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

// Where the byline prints. Most news + features: "top" (runs under the deck).
// Editorials, op-eds, wire-credits: "end" (runs flush to the last column of
// the final page, em-dash + name).
export const BylinePositionSchema = z.enum(["top", "end"]);
export type BylinePosition = z.infer<typeof BylinePositionSchema>;

// Hero image placement on page 1 of an article.
//   below-headline — hero sits between the byline and the body (default;
//                    classic feature article). Image keeps its aspect ratio,
//                    capped so body has room.
//   above-headline — hero is the dominant visual at top of page 1, with
//                    the headline + deck + byline beneath. Image-led
//                    photo essay treatment.
//   full-bleed     — hero fills the entire trim (edge to edge, no margins).
//                    Headline, deck, byline overlay the lower portion of
//                    the image. The body starts on page 2.
export const HeroPlacementSchema = z.enum(["below-headline", "above-headline", "full-bleed"]);
export type HeroPlacement = z.infer<typeof HeroPlacementSchema>;

export const ArticleSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  headline: z.string().min(1).max(500),
  deck: z.string().max(800).nullable(),
  byline: z.string().max(200).nullable(),
  byline_position: BylinePositionSchema,
  hero_placement: HeroPlacementSchema,
  hero_caption: z.string().max(400).nullable(),
  hero_credit: z.string().max(200).nullable(),
  section: z.string().max(60).nullable(),
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
