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
  // Measure at 96% of column width — gives PowerPoint 4% slack to wrap
  // without surprising us by needing one extra line.
  const measureColPx = inToPx(input.columnWidthIn) * 0.96;

  const measure = (text: string): number => {
    if (!text.trim()) return 0;
    const prepared = pretext.prepareWithSegments(text, fontStr);
    return pretext.measureLineStats(prepared, measureColPx).lineCount;
  };

  const rawParagraphs = input.body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  const measured: MeasuredParagraph[] = rawParagraphs.map((p) => ({
    text: p,
    lines: measure(p),
  }));

  // Pack paragraphs into columns. After-paragraph gap counts as 1 line so
  // the visual rhythm matches what PowerPoint will render with
  // paraSpaceAfter ≈ leading.
  const PARAGRAPH_GAP_LINES = 1;
  const pages: string[][][] = [];
  let pageIdx = 0;
  let pendingParagraph: MeasuredParagraph | null = null;

  while (
    pageIdx < input.pageBodyHeightsIn.length &&
    (pendingParagraph !== null || measured.length > 0)
  ) {
    const heightIn = input.pageBodyHeightsIn[pageIdx] ?? 0;
    const linesPerCol = Math.max(
      1,
      Math.floor((heightIn * PT_PER_INCH) / input.bodyLeadingPt)
    );
    const cols: string[][] = [];

    for (let c = 0; c < input.columnCount; c += 1) {
      const col: string[] = [];
      let used = 0;

      // 1) Resume any paragraph spilled from the previous column.
      if (pendingParagraph) {
        const fit = fitParagraph(
          pendingParagraph,
          linesPerCol - used,
          measure
        );
        if (fit.fitting) {
          col.push(fit.fitting.text);
          used += fit.fitting.lines + PARAGRAPH_GAP_LINES;
        }
        pendingParagraph = fit.rest;
      }

      // 2) Pull fresh paragraphs.
      while (used < linesPerCol && measured.length > 0 && !pendingParagraph) {
        const next = measured[0]!;
        if (next.lines + (col.length > 0 ? PARAGRAPH_GAP_LINES : 0) <= linesPerCol - used) {
          // Whole paragraph fits.
          measured.shift();
          col.push(next.text);
          used += next.lines + PARAGRAPH_GAP_LINES;
        } else {
          // Try splitting.
          measured.shift();
          const fit = fitParagraph(next, linesPerCol - used, measure);
          if (fit.fitting) {
            col.push(fit.fitting.text);
            used += fit.fitting.lines + PARAGRAPH_GAP_LINES;
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

  // Sentence-split; walk forward greedily.
  const sentences = para.text.split(/(?<=[.!?])\s+/);
  if (sentences.length <= 1) {
    // Can't split further; place whole paragraph + accept the slight
    // overflow rather than dropping content. PowerPoint will clip the
    // visual tail; rare in practice for body copy with normal sentence
    // length.
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
    // Even one sentence overflows the available space. Push the whole
    // paragraph to the next column and let it use a full column there.
    return { fitting: null, rest: para };
  }

  const rest = sentences.slice(i).join(" ").trim();
  return {
    fitting: { text: acc, lines: accLines },
    rest: rest
      ? { text: rest, lines: measure(rest) }
      : null,
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
