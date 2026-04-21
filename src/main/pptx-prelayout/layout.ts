// Article body line-breaking via pretext + Skia canvas measurement.
//
// Replaces the chars-per-line × lines-per-column heuristic in the PPTX
// builder, which over-estimated capacity and dropped text mid-word at
// column bottoms (visible in the v1 full-flow PDF).
//
// The renderer-route was considered (browser canvas is more accurate to
// PowerPoint's text engine) but adds an IPC round-trip on every export.
// Skia + pretext in main is fast enough and stays self-contained. Width
// drift between Skia and PowerPoint is absorbed by a 4% safety margin
// on the measurement column width.

import { installCanvasShim } from "./measure.js";

// Pretext + canvas shim are loaded lazily on first call so the main
// bundle can stay CJS (top-level await is rejected by Rolldown's CJS
// output). Cached after the first install.
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
  bodyFontFace: string; // "Fraunces" | "Mukta"
  bodyPt: number;
  bodyLeadingPt: number;
  columnCount: number;
  columnWidthIn: number;
  /** Body block height per page (page 0 first, then 1, …). */
  pageBodyHeightsIn: number[];
}

export interface PrelayoutOutput {
  /** pages[pageIdx][colIdx] = lines */
  pages: string[][][];
}

const PARAGRAPH_BREAK = "\u0000PARA\u0000";

/**
 * Lay out an article body into per-page-per-column lines.
 *
 * Uses pretext.prepareWithSegments + walkLineRanges at 96% of the column
 * width (4% safety margin so PowerPoint's slightly different text engine
 * never re-wraps a line back onto a second visual line).
 */
export async function preLayoutArticleBody(
  input: PrelayoutInput
): Promise<PrelayoutOutput> {
  const pretext = await getPretext();
  const fontSizePx = ptToPx(input.bodyPt);
  const fontStr = `${fontSizePx}px ${JSON.stringify(input.bodyFontFace)}`;
  const safeColPx = inToPx(input.columnWidthIn) * 0.96;

  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  const allLines: string[] = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    const prepared = pretext.prepareWithSegments(paragraphs[i] ?? "", fontStr);
    pretext.walkLineRanges(prepared, safeColPx, (range) => {
      const line = pretext.materializeLineRange(prepared, range);
      allLines.push(line.text);
    });
    if (i < paragraphs.length - 1) allLines.push(PARAGRAPH_BREAK);
  }

  // Pack lines into columns + pages
  const pages: string[][][] = [];
  let lineIdx = 0;
  let pageIdx = 0;
  while (lineIdx < allLines.length && pageIdx < input.pageBodyHeightsIn.length) {
    const heightIn = input.pageBodyHeightsIn[pageIdx] ?? 0;
    const linesPerCol = Math.max(
      1,
      Math.floor((heightIn * PT_PER_INCH) / input.bodyLeadingPt)
    );
    const cols: string[][] = [];
    for (let c = 0; c < input.columnCount; c += 1) {
      const col: string[] = [];
      while (col.length < linesPerCol && lineIdx < allLines.length) {
        const ln = allLines[lineIdx]!;
        if (ln === PARAGRAPH_BREAK) {
          if (col.length === 0) {
            lineIdx += 1;
            continue;
          }
          if (col.length === linesPerCol - 1) {
            lineIdx += 1;
            break;
          }
          col.push("");
          lineIdx += 1;
        } else {
          col.push(ln);
          lineIdx += 1;
        }
      }
      cols.push(col);
      if (lineIdx >= allLines.length) break;
    }
    while (cols.length < input.columnCount) cols.push([]);
    pages.push(cols);
    pageIdx += 1;
  }

  return { pages };
}

/**
 * Convenience: derive geometry from a template + article meta + emit
 * the pre-broken pages. The first page reserves space for headline,
 * deck, byline (top), and hero image — matching what the PPTX builder
 * places.
 */
export async function preLayoutForTemplate(args: {
  body: string;
  language: "en" | "hi" | "bilingual";
  hasDeck: boolean;
  hasTopByline: boolean;
  hasHero: boolean;
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
  const columnWidthIn = (pageContentWidthIn - gutterIn * (t.columns - 1)) / t.columns;

  // Furniture reservations on page 1 — match PPTX builder values exactly.
  const HEADLINE_LINES = 3;
  const DECK_LINES = 3;
  const headlineHeightIn = (t.typography.headline_pt * 1.15 * HEADLINE_LINES) / PT_PER_INCH;
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
    pageHeights.push(p === 0 ? firstPageBodyIn : pageContentHeightIn);
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
