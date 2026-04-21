import type { Template } from "@shared/schemas/template.js";
import type { Language } from "@shared/schemas/language.js";
import type { ContentType } from "@shared/schemas/article.js";
import {
  wordCountFitScore,
  imageCountFitScore,
  imageAspectBonus,
  pullQuoteBonus,
  sidebarBonus,
} from "./signals.js";

// Auto-fit scorer composition per docs/eng-plan.md §1 + CEO plan Section 9.3.
// Filter templates by hard constraints first; compute weighted score for the
// survivors; return ranked list with ambiguity flag when the top two are
// within 15% of each other.

export interface AutoFitCandidate {
  template: Template;
  score: number;
  breakdown: {
    wordCount: number;
    imageCount: number;
    imageAspect: number;
    pullQuote: number;
    sidebar: number;
  };
}

export interface AutoFitInput {
  word_count: number;
  language: Language;
  content_type: ContentType;
  image_count: number;
  image_aspects?: ("portrait" | "landscape" | "square")[];
  has_pull_quote: boolean;
  has_sidebar: boolean;
  page_size: "A4" | "A5";
}

export interface AutoFitResult {
  candidates: AutoFitCandidate[];
  /** Best candidate, or null when none pass the filters. */
  best: AutoFitCandidate | null;
  /** True when the top two candidates are within 15% of each other (per CEO §9.3 step 5). */
  ambiguous: boolean;
  /** Human-readable reason when `best` is null. */
  noMatchReason: string | null;
}

// Weights for the composed score. Base signals are normalized to 0..1; bonuses
// are additive and capped. Total max before cap ≈ 1.0 (word) + 0.8 (image) + 0.2
// + 0.15 + 0.15 ≈ 2.3. We normalize by dividing by 2.3.
const MAX_RAW_SCORE = 1.0 + 0.8 + 0.2 + 0.15 + 0.15;

export function scoreArticleAgainstTemplates(
  input: AutoFitInput,
  templates: Template[]
): AutoFitResult {
  // Filter: page size, content_type, language compatibility
  const viableForConstraints = templates.filter((t) => {
    if (t.page_size !== input.page_size) return false;
    if (t.content_type !== input.content_type) return false;
    if (!t.language_modes.includes(input.language)) return false;
    return true;
  });

  if (viableForConstraints.length === 0) {
    const reason = describeNoMatch(input, templates);
    return { candidates: [], best: null, ambiguous: false, noMatchReason: reason };
  }

  const candidates: AutoFitCandidate[] = [];
  for (const template of viableForConstraints) {
    const wc = wordCountFitScore(input, template);
    if (wc === null) continue;
    const ic = imageCountFitScore(input, template);
    if (ic === null) continue;

    const wcWeighted = wc * 1.0;
    const icWeighted = ic * 0.8;
    const aspectBonus = imageAspectBonus(input, template);
    const pqBonus = pullQuoteBonus(input, template);
    const sbBonus = sidebarBonus(input, template);

    const raw = wcWeighted + icWeighted + aspectBonus + pqBonus + sbBonus;
    const score = raw / MAX_RAW_SCORE;

    candidates.push({
      template,
      score,
      breakdown: {
        wordCount: wcWeighted,
        imageCount: icWeighted,
        imageAspect: aspectBonus,
        pullQuote: pqBonus,
        sidebar: sbBonus,
      },
    });
  }

  if (candidates.length === 0) {
    const reason = describeNoMatch(input, templates);
    return { candidates: [], best: null, ambiguous: false, noMatchReason: reason };
  }

  // Sort highest-first
  candidates.sort((a, b) => b.score - a.score);

  // Ambiguity per CEO §9.3 step 5: top 2 within 15%
  let ambiguous = false;
  if (candidates.length >= 2) {
    const top = candidates[0]!.score;
    const second = candidates[1]!.score;
    if (top > 0 && (top - second) / top < 0.15) ambiguous = true;
  }

  return {
    candidates,
    best: candidates[0]!,
    ambiguous,
    noMatchReason: null,
  };
}

/**
 * Describe why no templates matched in operator-friendly terms.
 * Used to populate the error message registry substitutions.
 */
function describeNoMatch(input: AutoFitInput, templates: Template[]): string {
  // Is the page size the problem?
  const pageSizeMatches = templates.filter((t) => t.page_size === input.page_size);
  if (pageSizeMatches.length === 0) {
    return `no templates for page size ${input.page_size}`;
  }

  const typeMatches = pageSizeMatches.filter((t) => t.content_type === input.content_type);
  if (typeMatches.length === 0) {
    return `no templates for content type "${input.content_type}" at ${input.page_size}`;
  }

  const langMatches = typeMatches.filter((t) => t.language_modes.includes(input.language));
  if (langMatches.length === 0) {
    return `no templates support language "${input.language}" for this content type`;
  }

  // Word count: all templates filtered on word count
  const wordCountBounds = langMatches.map((t) =>
    input.language === "hi" ? t.word_count_range.hi : t.word_count_range.en
  );
  const minOfMins = Math.min(...wordCountBounds.map((b) => b[0]));
  const maxOfMaxes = Math.max(...wordCountBounds.map((b) => b[1]));
  if (input.word_count < minOfMins) {
    return `article is ${input.word_count} words; shortest template needs ${minOfMins}`;
  }
  if (input.word_count > maxOfMaxes) {
    return `article is ${input.word_count} words; longest template supports ${maxOfMaxes}`;
  }

  // Image count
  const needsImage = langMatches.some((t) => input.image_count < t.required_images);
  if (needsImage) {
    const minImages = Math.min(...langMatches.map((t) => t.required_images));
    return `article has ${input.image_count} images; templates need at least ${minImages}`;
  }

  return "article does not match any template's image count range";
}
