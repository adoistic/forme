// Article body layout via pretext + Skia canvas measurement.
//
// Replaces the old chars-per-line × lines-per-column heuristic.
//
// Output shape: per-page-per-column arrays of *paragraphs* (not visual
// lines). Each entry becomes one PPTX paragraph that PowerPoint wraps
// and justifies internally — non-final lines of every paragraph stretch
// to the column edge, last line stays left, the way print body copy
// has worked since the 1500s. Long paragraphs that don't fit in the
// remaining column are split at a sentence boundary; the trailing half
// becomes its own paragraph in the next column.
//
// We use pretext only for MEASUREMENT (count visual lines per paragraph
// at the column width). Actual line-by-line wrapping is left to
// PowerPoint so it can justify properly.

import { installCanvasShim } from "./measure.js";
import { computeFirstPageGeometry } from "@shared/pptx-builder/first-page-geometry.js";
// Hyphen library + Knuth-Liang patterns for English + Hindi. Used to
// insert SOFT HYPHENS (U+00AD) into body words so PowerPoint can break
// long words across line ends — the same way every print magazine does.
// Soft hyphens are invisible unless the line breaks at that point.
import createHyphenator from "hyphen";
import enUsPatterns from "hyphen/patterns/en-us";
import hiPatterns from "hyphen/patterns/hi";

const SOFT_HYPHEN = "\u00AD";
const hyphenateEn = createHyphenator(enUsPatterns, {
  hyphenChar: SOFT_HYPHEN,
});
const hyphenateHi = createHyphenator(hiPatterns, {
  hyphenChar: SOFT_HYPHEN,
});

let pretextModule: typeof import("@chenglou/pretext") | null = null;
async function getPretext(): Promise<typeof import("@chenglou/pretext")> {
  if (pretextModule) return pretextModule;
  await installCanvasShim();
  pretextModule = await import("@chenglou/pretext");
  return pretextModule;
}

const PT_PER_INCH = 72;
const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

function ptToPx(pt: number): number {
  return (pt * PX_PER_INCH) / PT_PER_INCH;
}
function inToPx(inches: number): number {
  return inches * PX_PER_INCH;
}
function mmToIn(mm: number): number {
  return mm / MM_PER_INCH;
}

export interface PrelayoutInput {
  body: string;
  language: "en" | "hi" | "bilingual";
  bodyFontFace: string;
  bodyPt: number;
  bodyLeadingPt: number;
  columnCount: number;
  columnWidthIn: number;
  /** Body block height per page (page 0 first, then 1, …). */
  pageBodyHeightsIn: number[];
}

export interface PrelayoutOutput {
  /** pages[pageIdx][colIdx] = paragraphs */
  pages: string[][][];
}

interface MeasuredParagraph {
  text: string;
  lines: number;
}

/**
 * Lay out an article body into per-page-per-column paragraph arrays.
 *
 * Each output entry becomes one PPTX paragraph. Long paragraphs that
 * don't fit in the remaining column are sentence-split; the spillover
 * becomes the first paragraph of the next column.
 */
export async function preLayoutArticleBody(
  input: PrelayoutInput
): Promise<PrelayoutOutput> {
  // Use pretext for body line measurement. Pretext is browser-canvas-
  // accurate against the registered Fraunces/Mukta TTFs in @napi-rs/canvas
  // (Skia). Trust its count — no artificial safety-factor narrowing,
  // no character-width fallback that would inflate the count. The earlier
  // safety factor was over-counting by 4-12% which left the column 20-40%
  // empty after PowerPoint actually rendered.
  const pretext = await getPretext();
  const fontSizePx = ptToPx(input.bodyPt);
  const fontStr = `${fontSizePx}px ${JSON.stringify(input.bodyFontFace)}`;
  const colWidthPx = inToPx(input.columnWidthIn);

  const isDevanagari = (text: string): boolean => {
    const dev = text.match(/[\u0900-\u097F]/g);
    return dev !== null && dev.length / Math.max(1, text.length) > 0.1;
  };

  const measure = (text: string): number => {
    if (!text.trim()) return 0;
    const prepared = pretext.prepareWithSegments(text, fontStr);
    const lines = pretext.measureLineStats(prepared, colWidthPx).lineCount;
    if (!isDevanagari(text)) {
      // Latin: pretext + Skia + Fraunces matches PowerPoint render.
      // Fall back to char-width only on a 0-line result.
      if (lines > 0) return lines;
      const charsPerLine = Math.max(
        14,
        Math.floor(colWidthPx / (fontSizePx * 0.45))
      );
      return Math.ceil(text.length / charsPerLine);
    }
    // Devanagari: Skia's Mukta shaper systematically under-counts by
    // ~1-2 lines per paragraph because it doesn't expand stacked matras
    // and conjuncts the way LibreOffice's HarfBuzz does. Take the max
    // of pretext + a 0.50em char-width estimate so we plan for the
    // larger value and don't overflow the body bottom.
    const charsPerLine = Math.max(
      14,
      Math.floor(colWidthPx / (fontSizePx * 0.50))
    );
    const fallback = Math.ceil(text.length / charsPerLine);
    return Math.max(lines, fallback);
  };

  // Insert SOFT HYPHENS (\u00AD) so PowerPoint can break long words across
  // line ends — exactly what print-magazine body type does. Pretext sees
  // the soft hyphens as discretionary break points (browser-canvas-accurate
  // line counting). PowerPoint and LibreOffice render the hyphen ONLY at
  // the line end where the break actually happens — invisible everywhere
  // else. This single change densifies justified body type by 10-20%
  // without changing the visible text content.
  const hyphenate = (text: string): string => {
    if (!text) return text;
    return isDevanagari(text) ? hyphenateHi(text) : hyphenateEn(text);
  };

  const sourceParagraphs = input.body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .map((p) => hyphenate(p));

  // Wikipedia plaintext (and many other sources) sometimes has a single
  // 10K-char paragraph for the entire article body. Magazine readers
  // expect visible paragraph breaks every few sentences. Split any
  // paragraph longer than 5 sentences into chunks of 3-5 sentences each.
  // Sentence boundaries: . ! ? (Latin), । (Devanagari), 。 (CJK), ؟ (Arabic).
  const SENTENCES_PER_PARAGRAPH = 4;
  const SENTENCE_BOUNDARY = /(?<=[.!?।。؟])\s+|(?<=।)/;
  const rawParagraphs: string[] = [];
  for (const p of sourceParagraphs) {
    const sentences = p
      .split(SENTENCE_BOUNDARY)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (sentences.length <= SENTENCES_PER_PARAGRAPH + 1) {
      rawParagraphs.push(p);
      continue;
    }
    for (let i = 0; i < sentences.length; i += SENTENCES_PER_PARAGRAPH) {
      const chunk = sentences.slice(i, i + SENTENCES_PER_PARAGRAPH).join(" ");
      if (chunk.length > 0) rawParagraphs.push(chunk);
    }
  }

  const measured: MeasuredParagraph[] = rawParagraphs.map((p) => ({
    text: p,
    lines: measure(p),
  }));

  // PARAGRAPH_GAP_PT is the actual vertical space PowerPoint will emit
  // between paragraphs (paraSpaceAfter, in points). The packer subtracts
  // it from per-col capacity for every paragraph break — that way the
  // visual line-count and the math agree to a single point.
  //
  // The user's mental model: emit an empty 4pt-high "spacer paragraph"
  // between every two real paragraphs. We do exactly that visually
  // (PowerPoint renders paraSpaceAfter as the gap). 4pt is small enough
  // to read as paragraph break without making cols look loose.
  const PARAGRAPH_GAP_PT = 4;
  const PARAGRAPH_GAP_LINES = PARAGRAPH_GAP_PT / input.bodyLeadingPt;
  const pages: string[][][] = [];
  let pageIdx = 0;
  let pendingParagraph: MeasuredParagraph | null = null;

  // Helper to compute remaining body lines (used to detect the LAST page
  // and balance its columns instead of fill-greedy). Includes the
  // paragraph-gap overhead so the balancer's target is honest.
  const remainingLines = (): number => {
    const pendingLn = pendingParagraph?.lines ?? 0;
    const measuredLn = measured.reduce((acc, m) => acc + m.lines, 0);
    const paraCount =
      (pendingParagraph ? 1 : 0) + measured.length;
    const gapOverhead = Math.max(0, paraCount - 1) * PARAGRAPH_GAP_LINES;
    return pendingLn + measuredLn + gapOverhead;
  };

  const DEBUG = process.env.LAYOUT_DEBUG === "1";
  while (
    pageIdx < input.pageBodyHeightsIn.length &&
    (pendingParagraph !== null || measured.length > 0)
  ) {
    const heightIn = input.pageBodyHeightsIn[pageIdx] ?? 0;
    // PowerPoint applies paraSpaceAfter (4pt) to EVERY paragraph,
    // including the last in a column. The packer counts gaps between
    // paragraphs (N-1 gaps for N paras) but PowerPoint emits N gaps,
    // so the actual rendered height exceeds our planned height by 4pt
    // per column. Subtract that one extra gap from the per-page capacity
    // so the bottom of the textbox stays inside the trim margin.
    const trailingGapIn = PARAGRAPH_GAP_PT / PT_PER_INCH;
    const usableHeightIn = Math.max(0, heightIn - trailingGapIn);
    const fullLinesPerCol =
      (usableHeightIn * PT_PER_INCH) / input.bodyLeadingPt;
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.error(
        `[layout] page ${pageIdx + 1}: heightIn=${heightIn.toFixed(2)}, fullLinesPerCol=${fullLinesPerCol.toFixed(1)}, measured.length=${measured.length}, pending=${pendingParagraph ? "yes" : "no"}`
      );
    }

    // Last-page detection: if all remaining content fits within one
    // page's worth of capacity (colCount × fullLinesPerCol), we're on
    // the last page — set the per-col target to ceil(remaining / colCount)
    // so the last page's columns are balanced. Without this the greedy
    // packer fills col 1 to capacity and col 3 ends up much shorter.
    const remaining = remainingLines();
    const onLastPage = remaining <= fullLinesPerCol * input.columnCount;
    const balancedTarget = Math.min(
      fullLinesPerCol,
      remaining / input.columnCount + 0.5 // half-line of slack
    );
    const linesPerCol = onLastPage ? balancedTarget : fullLinesPerCol;
    // On balanced pages, allow the packer to overshoot the target by up
    // to 35% of it (or 4 lines, whichever is larger) before splitting.
    // Without this, cols 2 underfills any time the next paragraph won't
    // fit exactly — col 3 then ends up TALLER than col 2. Allowing
    // overshoot trades a tiny imbalance for a much more even visual.
    const overshoot = onLastPage
      ? Math.max(4, linesPerCol * 0.35)
      : 0;
    // Cap overshoot at the page's actual line capacity. The balancer
    // intentionally lets cols 1+2 grow past balancedTarget so col 3
    // doesn't end up taller, but the previous "+overshoot" arm could
    // exceed fullLinesPerCol on a short last page — pushing the bottom
    // ~2 lines of cols 1+2 past the body bottom into the footer area.
    // Never let any col plan beyond what physically fits on the page.
    const safeColCap = Math.min(linesPerCol + overshoot, fullLinesPerCol);

    const cols: string[][] = [];
    for (let c = 0; c < input.columnCount; c += 1) {
      const col: string[] = [];
      let used = 0;
      const isLastCol = c === input.columnCount - 1;
      // Last col on the last page absorbs whatever's left, but still
      // capped at the page's physical capacity (no overflow).
      const colCap = isLastCol && onLastPage ? fullLinesPerCol : safeColCap;

      if (pendingParagraph) {
        const fit = fitParagraph(pendingParagraph, colCap - used, measure);
        if (fit.fitting) {
          col.push(fit.fitting.text);
          used += fit.fitting.lines + PARAGRAPH_GAP_LINES;
        }
        pendingParagraph = fit.rest;
      }

      while (used < colCap && measured.length > 0 && !pendingParagraph) {
        const next = measured[0]!;
        const gap = col.length > 0 ? PARAGRAPH_GAP_LINES : 0;
        const projected = used + next.lines + gap;
        // Acceptance rules (in priority order):
        //   1) Last col on last page: take everything (the only place
        //      we let cols overflow with no cap)
        //   2) Otherwise: fits inside cap (target + overshoot)
        //   3) Otherwise: split at sentence boundary
        const acceptWhole =
          (isLastCol && onLastPage) || projected <= colCap;
        if (acceptWhole) {
          measured.shift();
          col.push(next.text);
          used += next.lines + gap;
        } else {
          measured.shift();
          const fit = fitParagraph(next, colCap - used, measure);
          if (fit.fitting) {
            col.push(fit.fitting.text);
            used += fit.fitting.lines + gap;
          }
          pendingParagraph = fit.rest;
        }
      }

      if (DEBUG) {
        console.error(
          `[layout]   col ${c + 1}: ${col.length} paras, used=${used.toFixed(1)}/${colCap === Infinity ? "inf" : colCap.toFixed(1)} lines, pending after=${pendingParagraph ? `${pendingParagraph.lines}L` : "no"}`
        );
      }
      cols.push(col);
      if (!pendingParagraph && measured.length === 0) break;
    }

    while (cols.length < input.columnCount) cols.push([]);
    pages.push(cols);
    pageIdx += 1;
  }

  return { pages };
}

/**
 * Try to fit a paragraph into `linesAvailable` visual lines by greedily
 * accepting sentences. Returns `{ fitting }` for the part that fits
 * (or null if even the first sentence overflows) and `rest` for the
 * spillover.
 */
function fitParagraph(
  para: MeasuredParagraph,
  linesAvailable: number,
  measure: (text: string) => number
): { fitting: MeasuredParagraph | null; rest: MeasuredParagraph | null } {
  if (linesAvailable <= 0) return { fitting: null, rest: para };

  // Already fits as-is
  if (para.lines <= linesAvailable) {
    return { fitting: para, rest: null };
  }

  // Sentence-split; walk forward greedily. The split set covers Latin
  // sentence punctuation (.!?), Devanagari danda (।), Chinese/Japanese
  // full stops (。), and the Arabic/Urdu full stop (؟ ! .). Without the
  // Devanagari danda, Hindi paragraphs were one indivisible chunk and
  // never split, leaving 10K characters of body text untouched.
  let sentences = para.text.split(/(?<=[.!?।。؟])\s+/);
  // If still a single chunk (no recognized punctuation), fall back to
  // splitting on Devanagari danda even without trailing space — Hindi
  // text is sometimes typeset with no space after the danda.
  if (sentences.length <= 1) {
    sentences = para.text
      .split(/(?<=।)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (sentences.length <= 1) {
    // Truly indivisible; place whole paragraph + accept the slight
    // overflow rather than dropping content. Rare in practice.
    return { fitting: para, rest: null };
  }

  let acc = "";
  let accLines = 0;
  let i = 0;
  for (; i < sentences.length; i += 1) {
    const candidate = acc ? `${acc} ${sentences[i]}` : sentences[i];
    const candidateLines = measure(candidate ?? "");
    if (candidateLines <= linesAvailable) {
      acc = candidate ?? "";
      accLines = candidateLines;
    } else {
      break;
    }
  }

  if (!acc) {
    // Even the first sentence overflows the available space. The earlier
    // "take it anyway if linesAvailable >= 4" rule was the source of
    // pages overflowing into the footer: a 20-line first sentence
    // would get force-placed into a 4-line gap, spilling 16 lines past
    // the textbox. Push the whole paragraph forward instead — accept a
    // short col bottom rather than a corrupted page bottom.
    return { fitting: null, rest: para };
  }

  const rest = sentences.slice(i).join(" ").trim();
  return {
    fitting: { text: acc, lines: accLines },
    rest: rest ? { text: rest, lines: measure(rest) } : null,
  };
}

/**
 * Convenience: derive geometry from a template + article meta + emit
 * the per-page-per-column paragraph arrays.
 */
export async function preLayoutForTemplate(args: {
  body: string;
  /** Headline text — needed to estimate first-page furniture height. */
  headline: string;
  /** Deck text or null — needed to estimate first-page furniture height. */
  deck: string | null;
  language: "en" | "hi" | "bilingual";
  hasTopByline: boolean;
  hasHero: boolean;
  /**
   * "full-bleed" reserves the entire first page for the hero image — body
   * starts on page 2. "above-headline" / "below-headline" both leave
   * room for body on page 1.
   */
  heroPlacement?: "below-headline" | "above-headline" | "full-bleed";
  template: {
    trim_mm: [number, number];
    margins_mm: { top: number; right: number; bottom: number; left: number };
    columns: number;
    gutter_mm: number;
    typography: {
      headline_pt: number;
      deck_pt?: number;
      body_pt: number;
      body_leading_pt: number;
    };
    page_count_range: [number, number];
  };
}): Promise<string[][][]> {
  const t = args.template;
  const trimHeightIn = mmToIn(t.trim_mm[1]);
  const pageContentHeightIn =
    trimHeightIn - mmToIn(t.margins_mm.top + t.margins_mm.bottom);
  const pageContentWidthIn =
    mmToIn(t.trim_mm[0]) - mmToIn(t.margins_mm.left + t.margins_mm.right);
  const gutterIn = mmToIn(t.gutter_mm);
  const columnWidthIn =
    (pageContentWidthIn - gutterIn * (t.columns - 1)) / t.columns;

  // First-page body height — uses the SAME formulas the PPTX builder
  // uses to position the body container. Single source of truth in
  // first-page-geometry.ts. Without this, a 1-line headline like "कबीर"
  // got reserved 3 lines worth of height, leaving the body container
  // ~2 inches (~11 lines) under-filled per column.
  const firstPageDeck =
    args.deck && args.deck.trim().length > 0 ? args.deck : null;
  const { bodyHeightIn: firstPageBodyIn } = computeFirstPageGeometry({
    headline: args.headline,
    deck: firstPageDeck,
    hasTopByline: args.hasTopByline,
    hasHero: args.hasHero,
    heroPlacement: args.heroPlacement ?? "below-headline",
    trim_mm: t.trim_mm,
    margins_mm: t.margins_mm,
    typography: {
      headline_pt: t.typography.headline_pt,
      ...(t.typography.deck_pt !== undefined
        ? { deck_pt: t.typography.deck_pt }
        : {}),
    },
  });

  const pageHeights: number[] = [];
  for (let p = 0; p < t.page_count_range[1]; p += 1) {
    if (p === 0) {
      // Full-bleed reserves the entire first page for the hero image.
      pageHeights.push(args.heroPlacement === "full-bleed" ? 0 : firstPageBodyIn);
    } else {
      pageHeights.push(pageContentHeightIn);
    }
  }

  const fontFace = args.language === "hi" ? "Mukta" : "Fraunces";

  const out = await preLayoutArticleBody({
    body: args.body,
    language: args.language,
    bodyFontFace: fontFace,
    bodyPt: t.typography.body_pt,
    bodyLeadingPt: t.typography.body_leading_pt,
    columnCount: t.columns,
    columnWidthIn,
    pageBodyHeightsIn: pageHeights,
  });
  return out.pages;
}
