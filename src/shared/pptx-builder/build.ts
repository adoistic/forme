import pptxgen from "pptxgenjs";
import type {
  PptxBuildInput,
  PptxBuildResult,
  PptxPlacement,
} from "./types.js";
import type { Template } from "@shared/schemas/template.js";

// Phase 2 PPTX builder per docs/eng-plan.md §4 + CEO plan §4.
// Produces a print-ready .pptx matching the template's geometry (trim + bleed).
// Pre-breaks lines per the Pretext-mapper output so PowerPoint can't re-wrap.
//
// Phase 2 scope: Standard Feature A4 in English + Editorial Serif pairing.
// Other templates fan out from here in Phases 4-10.

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

export async function buildPptx(
  input: PptxBuildInput,
  outputPath: string
): Promise<PptxBuildResult> {
  const pres = new pptxgen();
  const warnings: string[] = [];

  // First placement's template defines the page geometry. Mixed page sizes in
  // one issue are out of scope for MVP (CEO §5.1 — page size locked at issue
  // creation).
  const first = input.placements[0];
  if (!first) {
    throw new Error("buildPptx called with zero placements");
  }

  const template = first.template;
  // Slide size = trim + bleed on all sides, converted mm → inches
  const { trim_mm, bleed_mm } = template.geometry;
  const slideWidthIn = (trim_mm[0] + bleed_mm * 2) / MM_PER_INCH;
  const slideHeightIn = (trim_mm[1] + bleed_mm * 2) / MM_PER_INCH;

  pres.defineLayout({
    name: `FORME_${template.id}`,
    width: slideWidthIn,
    height: slideHeightIn,
  });
  pres.layout = `FORME_${template.id}`;

  pres.title = input.issueTitle;
  pres.subject = `${input.publicationName} — Issue ${input.issueNumber ?? "?"}`;
  pres.author = input.publicationName;

  // Emit one spread per placement as a sequence of slides. Phase 2 scope:
  // one template + one article = 2-3 slides per the template's page_count_range.
  let pageCount = 0;
  for (const placement of input.placements) {
    const added = addPlacementSlides(pres, placement, warnings);
    pageCount += added;
  }

  // Write the file. pptxgenjs returns the absolute path it wrote to.
  const writtenPath = await pres.writeFile({ fileName: outputPath });
  const fs = await import("node:fs/promises");
  const stat = await fs.stat(writtenPath);

  return {
    outputPath: writtenPath,
    bytes: stat.size,
    pageCount,
    warnings,
  };
}

/**
 * Emit slides for a single placement. Returns number of slides added.
 *
 * Phase 2 first-template strategy: produce N page-count slides where the
 * headline + deck + byline sit on page 1 with the hero image, and the body
 * flows across pages 2-3 via paragraph-per-line primitives (the approach
 * chosen in eng-plan §4 — paragraph-per-line first, text-box-per-line fallback
 * if Phase 1 probe shows drift).
 */
function addPlacementSlides(
  pres: pptxgen,
  placement: PptxPlacement,
  _warnings: string[]
): number {
  const { template, article } = placement;
  const geo = template.geometry;
  const typ = template.typography;

  // Inch-space helpers
  const mm2in = (mm: number) => mm / MM_PER_INCH;
  const pt2in = (pt: number) => pt / PT_PER_INCH;
  const bleedIn = mm2in(geo.bleed_mm);
  const marginTop = mm2in(geo.margins_mm.top) + bleedIn;
  const marginLeft = mm2in(geo.margins_mm.left) + bleedIn;
  const marginRight = mm2in(geo.margins_mm.right) + bleedIn;
  const marginBottom = mm2in(geo.margins_mm.bottom) + bleedIn;

  const trimWidthIn = mm2in(geo.trim_mm[0]);
  const trimHeightIn = mm2in(geo.trim_mm[1]);
  const pageContentWidth = trimWidthIn - mm2in(geo.margins_mm.left + geo.margins_mm.right);
  const pageContentHeight = trimHeightIn - mm2in(geo.margins_mm.top + geo.margins_mm.bottom);

  const columnCount = geo.columns;
  const gutterIn = mm2in(geo.gutter_mm);
  const columnWidth = (pageContentWidth - gutterIn * (columnCount - 1)) / columnCount;

  // Determine page count: start with min of range + extend by body length
  // estimation. Phase 2 placeholder — Phase 1 probe will wire Pretext for
  // real measurement. For the smoke test we use page_count_range[0].
  const pagesForBody = Math.max(template.page_count_range[0], 1);
  let slidesAdded = 0;

  for (let pageIdx = 0; pageIdx < pagesForBody; pageIdx += 1) {
    const slide = pres.addSlide();

    // Draw bleed + trim guide rules (visible in PowerPoint edit mode only)
    slide.addShape("line", {
      x: bleedIn,
      y: bleedIn,
      w: trimWidthIn,
      h: 0,
      line: { color: "D4CBB8", width: 0.25, dashType: "dash" },
    });
    slide.addShape("line", {
      x: bleedIn,
      y: bleedIn + trimHeightIn,
      w: trimWidthIn,
      h: 0,
      line: { color: "D4CBB8", width: 0.25, dashType: "dash" },
    });

    // First page: headline + deck + byline + hero image at top
    const isFirstPage = pageIdx === 0;
    let bodyStartY = marginTop;

    if (isFirstPage) {
      slide.addText(article.headline, {
        x: marginLeft,
        y: marginTop,
        w: pageContentWidth,
        h: pt2in(typ.headline_pt * 1.2 * headlineLineCount(article.headline, pageContentWidth, typ.headline_pt)),
        fontSize: typ.headline_pt,
        fontFace: "Fraunces",
        bold: true,
        color: "1A1A1A",
        valign: "top",
      });

      const headlineHeight = pt2in(typ.headline_pt * 1.25) * headlineLineCount(article.headline, pageContentWidth, typ.headline_pt);
      let cursorY = marginTop + headlineHeight + pt2in(8);

      if (article.deck) {
        slide.addText(article.deck, {
          x: marginLeft,
          y: cursorY,
          w: pageContentWidth,
          h: pt2in((typ.deck_pt ?? 16) * 1.3 * 2),
          fontSize: typ.deck_pt ?? 16,
          fontFace: "Inter",
          italic: true,
          color: "5C5853",
        });
        cursorY += pt2in((typ.deck_pt ?? 16) * 1.3 * 2) + pt2in(6);
      }

      if (article.byline) {
        slide.addText(article.byline, {
          x: marginLeft,
          y: cursorY,
          w: pageContentWidth,
          h: pt2in(12 * 1.3),
          fontSize: 11,
          fontFace: "Inter",
          bold: true,
          color: "C96E4E",
          charSpacing: 1.5,
        });
        cursorY += pt2in(12 * 1.3) + pt2in(8);
      }

      // Hero image if present — full-width, reasonable height
      if (article.heroImage) {
        const heroHeight = Math.min(
          pt2in(240),
          pageContentHeight - (cursorY - marginTop) - pt2in(typ.body_pt * 30)
        );
        if (heroHeight > pt2in(60)) {
          slide.addImage({
            data: `data:${article.heroImage.mimeType};base64,${article.heroImage.base64}`,
            x: marginLeft,
            y: cursorY,
            w: pageContentWidth,
            h: heroHeight,
          });
          cursorY += heroHeight + pt2in(12);
        }
      }

      bodyStartY = cursorY;
    }

    // Body text flows across columns below the header area (first page) or
    // from margin-top on continuation pages. Phase 2 stub: emit the whole body
    // as one three-column text block and trust PowerPoint's flow. The
    // Pretext-mapper replacement in Phase 1 probe will pre-break line-by-line.
    const bodyAvailableHeight = trimHeightIn - marginBottom - bodyStartY;
    const colsThisPage = columnCount;
    for (let col = 0; col < colsThisPage; col += 1) {
      const colX = marginLeft + col * (columnWidth + gutterIn);
      // Approximate the portion of body to place on this column: split the
      // body into N parts. For the smoke test this is a coarse split; real
      // line-accurate splitting happens in Phase 1 probe.
      const segment = bodySegmentForColumn(article.body, pageIdx, col, pagesForBody, colsThisPage);
      if (!segment) continue;
      slide.addText(segment, {
        x: colX,
        y: bodyStartY,
        w: columnWidth,
        h: bodyAvailableHeight,
        fontSize: typ.body_pt,
        lineSpacing: typ.body_leading_pt,
        fontFace: article.language === "hi" ? "Mukta" : "Fraunces",
        color: "1A1A1A",
        valign: "top",
        paraSpaceAfter: 4,
      });
    }

    // Pull quote (page 2 of a 3-page article, center column)
    if (article.pullQuote && pageIdx === 1 && template.supports_pull_quote) {
      slide.addText(`"${article.pullQuote}"`, {
        x: marginLeft + (columnWidth + gutterIn),
        y: bodyStartY + bodyAvailableHeight / 3,
        w: columnWidth,
        h: pt2in(60),
        fontSize: typ.body_pt * 1.6,
        fontFace: "Fraunces",
        italic: true,
        color: "C96E4E",
        align: "center",
        valign: "middle",
      });
    }

    // Folio (page number) — bottom center, outside the content area
    slide.addText(`${placement.startingPageNumber + pageIdx}`, {
      x: bleedIn,
      y: trimHeightIn + bleedIn - pt2in(14),
      w: trimWidthIn,
      h: pt2in(12),
      fontSize: 9,
      fontFace: "Inter",
      align: "center",
      color: "9B958E",
    });

    slidesAdded += 1;
  }

  return slidesAdded;
}

/**
 * Rough estimate of how many lines a headline will take at a given width.
 * Used only for vertical positioning of the deck/byline below the headline.
 * Pretext will replace this in Phase 1 probe.
 */
function headlineLineCount(
  headline: string,
  widthIn: number,
  fontSizePt: number
): number {
  // Rough: at ~0.5 em per character width and 72pt=1in, how many fit per line
  const avgCharWidthIn = (fontSizePt * 0.5) / PT_PER_INCH;
  const charsPerLine = Math.max(10, Math.floor(widthIn / avgCharWidthIn));
  const lineCount = Math.ceil(headline.length / charsPerLine);
  return Math.max(1, Math.min(lineCount, 3));
}

/**
 * Phase 2 stub: split the article body into (pages * columns) roughly equal
 * segments and return the segment for this (page, column). Pretext replaces
 * this in Phase 1 probe with line-accurate pre-breaks.
 */
function bodySegmentForColumn(
  body: string,
  pageIdx: number,
  columnIdx: number,
  pageCount: number,
  columnCount: number
): string {
  const firstPageHasHeader = true;
  // Reserve fewer characters on page 1 since header area takes space
  const columnsPerPage = columnCount;
  const totalCols = pageCount * columnsPerPage;
  const thisColAbsolute = pageIdx * columnsPerPage + columnIdx;

  // Page 1 column space is smaller; weight that in
  const weights: number[] = [];
  for (let p = 0; p < pageCount; p += 1) {
    for (let c = 0; c < columnsPerPage; c += 1) {
      const w = p === 0 && firstPageHasHeader ? 0.5 : 1;
      weights.push(w);
    }
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const cumWeights = weights.map(
    (() => {
      let acc = 0;
      return (w: number) => {
        acc += w;
        return acc / totalWeight;
      };
    })()
  );

  const startFrac = thisColAbsolute === 0 ? 0 : cumWeights[thisColAbsolute - 1]!;
  const endFrac = cumWeights[thisColAbsolute] ?? 1;
  const start = Math.floor(body.length * startFrac);
  const end = Math.floor(body.length * endFrac);
  if (start >= end) return "";
  // Snap to word boundaries to avoid mid-word cuts
  let snapStart = start;
  while (snapStart > 0 && !/\s/.test(body[snapStart - 1] ?? "")) snapStart -= 1;
  let snapEnd = end;
  while (snapEnd < body.length && !/\s/.test(body[snapEnd] ?? "")) snapEnd += 1;
  return body.slice(snapStart, snapEnd).trim();
  // NB: Phase 1 probe replaces all of this with Pretext measurements.
  // This stub merely produces SOMETHING so the E2E + LibreOffice validator
  // can sanity-check the OOXML output end-to-end.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _unused = totalCols;
}
