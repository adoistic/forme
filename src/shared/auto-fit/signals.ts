import type { Template } from "@shared/schemas/template.js";
import type { Language } from "@shared/schemas/language.js";

// Auto-fit signal functions per docs/eng-plan.md §1 + CEO plan Section 9.
// Each signal returns a normalized 0..1 score. Composition lives in score.ts.
//
// Eng review §1 locked: "pure functions per signal. wordCountFitScore(),
// imageCountFitScore(), pullQuoteBonus(), sidebarBonus(). Composed in
// autoFitScore(). Unit-tested exhaustively."

export interface ArticleSignalInput {
  word_count: number;
  language: Language;
  image_count: number;
  image_aspects?: ("portrait" | "landscape" | "square")[];
  has_pull_quote: boolean;
  has_sidebar: boolean;
}

/**
 * Geometric-mean scoring: highest when word count sits at the geometric mean
 * of the template's range; decays toward 0 at the edges; null when outside.
 * Per CEO plan §9.3.
 */
export function wordCountFitScore(
  article: Pick<ArticleSignalInput, "word_count" | "language">,
  template: Template
): number | null {
  // bilingual uses whichever range the content leans into; for auto-fit we
  // use the minimum of the two ranges as the wider envelope.
  const range =
    article.language === "hi"
      ? template.word_count_range.hi
      : article.language === "bilingual"
        ? [
            Math.min(template.word_count_range.en[0], template.word_count_range.hi[0]),
            Math.max(template.word_count_range.en[1], template.word_count_range.hi[1]),
          ]
        : template.word_count_range.en;

  const [min, max] = range as [number, number];
  const wc = article.word_count;

  if (wc < min || wc > max) return null; // filtered out — not a viable match

  // Geometric mean of [min, max]
  const gm = Math.sqrt(min * max);
  // Distance from gm normalized against half-range
  const halfRange = (max - min) / 2;
  const distance = Math.abs(wc - gm);
  // Score: 1.0 at gm, decays smoothly to ~0.2 at edges
  const score = Math.max(0, 1 - Math.pow(distance / Math.max(halfRange, 1), 2) * 0.8);
  return clamp(score, 0, 1);
}

/**
 * Image count fit: templates declare required_images + optional_images=[min, max].
 * The article's total images must satisfy required AND fit within optional range.
 */
export function imageCountFitScore(
  article: Pick<ArticleSignalInput, "image_count">,
  template: Template
): number | null {
  const req = template.required_images;
  const [optMin, optMax] = template.optional_images;
  const ic = article.image_count;

  if (ic < req) return null; // not enough images
  const beyond = ic - req;
  if (beyond < optMin || beyond > optMax) return null;

  // Full score if beyond = (optMin + optMax)/2, linear decay toward edges
  if (optMax === optMin) return 1;
  const midpoint = (optMin + optMax) / 2;
  const range = (optMax - optMin) / 2;
  const distance = Math.abs(beyond - midpoint);
  const score = 1 - (distance / Math.max(range, 1)) * 0.4;
  return clamp(score, 0, 1);
}

/**
 * Image aspect preference bonus. Small additive lift (0..0.2) for matches.
 */
export function imageAspectBonus(
  article: Pick<ArticleSignalInput, "image_aspects">,
  template: Template
): number {
  const prefs = template.image_aspect_preferences;
  if (prefs.length === 0 || !article.image_aspects || article.image_aspects.length === 0) {
    return 0;
  }
  if (prefs.includes("any")) return 0.1;
  const matches = article.image_aspects.filter((a) => prefs.includes(a as (typeof prefs)[number]));
  const ratio = matches.length / article.image_aspects.length;
  return ratio * 0.2;
}

/**
 * Pull quote bonus. Article has a pull quote AND template supports it → +0.15.
 * Article has a pull quote AND template does NOT support → 0 (no penalty; the
 * quote is simply dropped from the rendered output).
 */
export function pullQuoteBonus(
  article: Pick<ArticleSignalInput, "has_pull_quote">,
  template: Template
): number {
  if (article.has_pull_quote && template.supports_pull_quote) return 0.15;
  return 0;
}

/**
 * Sidebar bonus. Same logic as pull quote.
 */
export function sidebarBonus(
  article: Pick<ArticleSignalInput, "has_sidebar">,
  template: Template
): number {
  if (article.has_sidebar && template.supports_sidebar) return 0.15;
  return 0;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
