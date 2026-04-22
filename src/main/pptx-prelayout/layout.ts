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
  const pretext = await getPretext();
  const fontSizePx = ptToPx(input.bodyPt);
  const fontStr = `${fontSizePx}px ${JSON.stringify(input.bodyFontFace)}`;
  // Measure at a fraction of column width to leave PowerPoint slack to
  // re-wrap. Devanagari needs MORE slack: Skia's measurement of Mukta
  // doesn't account for matra/conjunct stacking the same way LibreOffice
  // does, so Hindi text rendered ~6-8% wider than measured. We use 88%
  // for hi/bilingual (12% slack) vs 96% for Latin (4% slack).
  const safetyFactor =
    input.language === "hi" || input.language === "bilingual" ? 0.88 : 0.96;
  const measureColPx = inToPx(input.columnWidthIn) * safetyFactor;

  const measure = (text: string): number => {
    if (!text.trim()) return 0;
    const prepared = pretext.prepareWithSegments(text, fontStr);
    return pretext.measureLineStats(prepared, measureColPx).lineCount;
  };

  const sourceParagraphs = input.body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

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

  // Belt-and-braces line-count: take pretext's measurement, but floor it
  // to a character-width estimate so a paragraph never reports 0 lines
  // when it has visible text. Mukta on Skia sometimes returns 0/1 for
  // multi-line Devanagari paragraphs because Skia's shaper doesn't size
  // the conjuncts the same way LibreOffice's HarfBuzz pipeline does.
  // Without this floor, the last-page balancer fires too early and the
  // packer leaves half the article on the floor.
  //
  // Per-script character-width ratio (em-units per glyph):
  //   Latin (Inter/Fraunces) ≈ 0.45em average
  //   Devanagari (Mukta) ≈ 0.65em — wider base + conjuncts add stacking
  // Bilingual content gets the wider Devanagari ratio so we don't under-
  // estimate when Hindi paragraphs show up.
  const charWidthRatio =
    input.language === "hi" || input.language === "bilingual" ? 0.65 : 0.45;
  const charsPerLineFallback = Math.max(
    14,
    Math.floor(inToPx(input.columnWidthIn) / (fontSizePx * charWidthRatio))
  );
  const measured: MeasuredParagraph[] = rawParagraphs.map((p) => {
    const measuredLines = measure(p);
    const fallback = Math.max(1, Math.ceil(p.length / charsPerLineFallback));
    return { text: p, lines: Math.max(measuredLines, fallback) };
  });

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

  while (
    pageIdx < input.pageBodyHeightsIn.length &&
    (pendingParagraph !== null || measured.length > 0)
  ) {
    const heightIn = input.pageBodyHeightsIn[pageIdx] ?? 0;
    const fullLinesPerCol =
      (heightIn * PT_PER_INCH) / input.bodyLeadingPt;

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

    const cols: string[][] = [];
    for (let c = 0; c < input.columnCount; c += 1) {
      const col: string[] = [];
      let used = 0;
      const isLastCol = c === input.columnCount - 1;
      // Last col on the last page absorbs ANY remaining content.
      const colCap = isLastCol && onLastPage ? Infinity : linesPerCol + overshoot;

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
    // Even one sentence overflows the available space. If we have at
    // least HALF the column free, take the first sentence anyway and
    // accept the small overflow — better than leaving a 30%-empty col
    // because the next paragraph couldn't be cleanly split. If we have
    // less than half free, push the paragraph to the next column.
    if (linesAvailable >= 4 && sentences.length > 0) {
      const firstSentence = sentences[0]!;
      const firstLines = measure(firstSentence);
      const restText = sentences.slice(1).join(" ").trim();
      return {
        fitting: { text: firstSentence, lines: firstLines },
        rest: restText
          ? { text: restText, lines: measure(restText) }
          : null,
      };
    }
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
  language: "en" | "hi" | "bilingual";
  hasDeck: boolean;
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

  // Furniture reservations on page 1 — match PPTX builder values.
  const HEADLINE_LINES = 3;
  const DECK_LINES = 3;
  const headlineHeightIn =
    (t.typography.headline_pt * 1.15 * HEADLINE_LINES) / PT_PER_INCH;
  const deckHeightIn = args.hasDeck
    ? ((t.typography.deck_pt ?? 16) * 1.35 * DECK_LINES) / PT_PER_INCH
    : 0;
  const bylineHeightIn = args.hasTopByline ? (14 + 10) / PT_PER_INCH : 0;
  const heroHeightIn = args.hasHero ? 220 / PT_PER_INCH + 20 / PT_PER_INCH : 0;
  const paddingIn = (10 + 6 + 10) / PT_PER_INCH;
  const firstPageBodyIn = Math.max(
    0,
    pageContentHeightIn -
      headlineHeightIn -
      deckHeightIn -
      bylineHeightIn -
      heroHeightIn -
      paddingIn
  );

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
