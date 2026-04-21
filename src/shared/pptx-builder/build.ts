import pptxgen from "pptxgenjs";
import type {
  PptxBuildInput,
  PptxBuildResult,
  PptxPlacement,
} from "./types.js";
import { loadBundledFonts } from "./fonts.js";

// Phase 2 PPTX builder per docs/eng-plan.md §4 + CEO plan §4.
// Produces a print-ready .pptx matching the template's geometry (trim + bleed).
//
// Phase 2 scope: Standard Feature A4 in English + Editorial Serif pairing.
// Phase 1 Pretext probe replaces the body-distribution heuristic with
// line-accurate pre-breaks.

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

export async function buildPptx(
  input: PptxBuildInput,
  outputPath: string
): Promise<PptxBuildResult> {
  const pres = new pptxgen();
  const warnings: string[] = [];

  const first = input.placements[0];
  if (!first) {
    throw new Error("buildPptx called with zero placements");
  }

  const template = first.template;
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

  // Fonts: attempt to load bundled TTFs. Missing fonts just fall through to
  // system fallback (same behavior as pre-embedding).
  const fonts = await loadBundledFonts();
  if (fonts.length === 0) {
    warnings.push(
      "No bundled fonts found — PPTX will reference Fraunces/Inter/Mukta by name only. Install them on the target machine or rerun with bundled fonts."
    );
  }

  let pageCount = 0;
  for (const placement of input.placements) {
    const added = addPlacementSlides(pres, placement);
    pageCount += added;
  }

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

function addPlacementSlides(pres: pptxgen, placement: PptxPlacement): number {
  const { template, article } = placement;
  const geo = template.geometry;
  const typ = template.typography;

  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const pt2in = (pt: number): number => pt / PT_PER_INCH;

  const bleedIn = mm2in(geo.bleed_mm);
  const marginLeft = mm2in(geo.margins_mm.left) + bleedIn;
  const marginRight = mm2in(geo.margins_mm.right) + bleedIn;
  const marginTop = mm2in(geo.margins_mm.top) + bleedIn;
  const marginBottom = mm2in(geo.margins_mm.bottom) + bleedIn;

  const trimWidthIn = mm2in(geo.trim_mm[0]);
  const trimHeightIn = mm2in(geo.trim_mm[1]);

  const pageContentWidth =
    trimWidthIn - mm2in(geo.margins_mm.left + geo.margins_mm.right);
  const pageContentHeight =
    trimHeightIn - mm2in(geo.margins_mm.top + geo.margins_mm.bottom);

  const columnCount = geo.columns;
  const gutterIn = mm2in(geo.gutter_mm);
  const columnWidth =
    (pageContentWidth - gutterIn * (columnCount - 1)) / columnCount;

  // Font-family selection: Mukta for pure Hindi, Fraunces for English body +
  // headlines. Bilingual uses Fraunces (better Latin) and relies on system
  // fallback for Devanagari glyphs — Phase 3 gate revisits this.
  const bodyFont = article.language === "hi" ? "Mukta" : "Fraunces";
  const displayFont = article.language === "hi" ? "Mukta" : "Fraunces";
  const sansFont = "Inter";

  // Estimate body capacity per page given font metrics.
  // Fraunces body_pt=10 with leading 14pt → chars-per-line ~ columnWidth/0.5em.
  const charsPerLine = Math.max(
    20,
    Math.floor((columnWidth * PT_PER_INCH) / (typ.body_pt * 0.52))
  );
  const bodyBlockHeightFirstPage = pageContentHeight - pt2in(160);
  const bodyBlockHeightOtherPages = pageContentHeight;
  const linesPerColFirstPage = Math.max(
    8,
    Math.floor((bodyBlockHeightFirstPage * PT_PER_INCH) / typ.body_leading_pt)
  );
  const linesPerColOtherPages = Math.max(
    10,
    Math.floor((bodyBlockHeightOtherPages * PT_PER_INCH) / typ.body_leading_pt)
  );
  const charsPerColFirstPage = charsPerLine * linesPerColFirstPage;
  const charsPerColOtherPages = charsPerLine * linesPerColOtherPages;

  // Decide actual page count from body length
  const body = article.body.trim();
  const neededCols = Math.ceil(
    estimateCharsNeeded(body) /
      Math.min(charsPerColFirstPage, charsPerColOtherPages)
  );
  const minPages = template.page_count_range[0];
  const maxPages = template.page_count_range[1];
  let pagesNeeded = Math.max(minPages, Math.ceil(neededCols / columnCount));
  pagesNeeded = Math.min(pagesNeeded, maxPages);
  // If the body is very short (fits in one column), still use minPages per spec
  if (estimateCharsNeeded(body) < charsPerColFirstPage && minPages === 1) {
    pagesNeeded = 1;
  }

  // Build ordered capacity list (one slot per column of each page)
  const capacities: number[] = [];
  for (let p = 0; p < pagesNeeded; p += 1) {
    const per = p === 0 ? charsPerColFirstPage : charsPerColOtherPages;
    for (let c = 0; c < columnCount; c += 1) capacities.push(per);
  }

  // Distribute body across the capacity slots, snapping to word boundaries
  const segments = distributeToColumns(body, capacities);

  // Emit slides
  for (let pageIdx = 0; pageIdx < pagesNeeded; pageIdx += 1) {
    const slide = pres.addSlide();
    const isFirstPage = pageIdx === 0;

    // Trim + bleed dashed guides (visible in edit mode, not print)
    drawTrimGuides(slide, bleedIn, trimWidthIn, trimHeightIn);

    let bodyStartY = marginTop;

    if (isFirstPage) {
      // Headline
      const headlineLines = Math.min(
        3,
        Math.ceil(
          article.headline.length /
            Math.max(10, Math.floor((pageContentWidth * PT_PER_INCH) / (typ.headline_pt * 0.45)))
        )
      );
      const headlineHeight = pt2in(typ.headline_pt * 1.1) * headlineLines;
      slide.addText(article.headline, {
        x: marginLeft,
        y: marginTop,
        w: pageContentWidth,
        h: headlineHeight,
        fontSize: typ.headline_pt,
        fontFace: displayFont,
        bold: true,
        color: "1A1A1A",
        valign: "top",
      });
      let cursorY = marginTop + headlineHeight + pt2in(10);

      // Deck (italic sans)
      if (article.deck) {
        const deckHeight = pt2in((typ.deck_pt ?? 16) * 1.35 * 2);
        slide.addText(article.deck, {
          x: marginLeft,
          y: cursorY,
          w: pageContentWidth,
          h: deckHeight,
          fontSize: typ.deck_pt ?? 16,
          fontFace: sansFont,
          italic: true,
          color: "5C5853",
          valign: "top",
        });
        cursorY += deckHeight + pt2in(6);
      }

      // Byline (small caps sans, rust)
      if (article.byline) {
        slide.addText(article.byline.toUpperCase(), {
          x: marginLeft,
          y: cursorY,
          w: pageContentWidth,
          h: pt2in(14),
          fontSize: 10,
          fontFace: sansFont,
          bold: true,
          color: "C96E4E",
          charSpacing: 3,
          valign: "top",
        });
        cursorY += pt2in(14) + pt2in(10);
      }

      // Optional hero image (full-width, modest height)
      if (article.heroImage) {
        const heroHeight = Math.min(
          pt2in(220),
          pageContentHeight - (cursorY - marginTop) - pt2in(typ.body_pt * 20)
        );
        if (heroHeight > pt2in(60)) {
          slide.addImage({
            data: `data:${article.heroImage.mimeType};base64,${article.heroImage.base64}`,
            x: marginLeft,
            y: cursorY,
            w: pageContentWidth,
            h: heroHeight,
          });
          cursorY += heroHeight + pt2in(10);
        }
      }

      bodyStartY = cursorY;
    }

    const bodyAvailableHeight = trimHeightIn - marginBottom - bodyStartY;

    // Emit one text box per column with its segment
    for (let col = 0; col < columnCount; col += 1) {
      const slotIdx = pageIdx * columnCount + col;
      const segment = segments[slotIdx];
      if (!segment) continue;
      const colX = marginLeft + col * (columnWidth + gutterIn);
      slide.addText(segment, {
        x: colX,
        y: bodyStartY,
        w: columnWidth,
        h: bodyAvailableHeight,
        fontSize: typ.body_pt,
        lineSpacing: typ.body_leading_pt,
        fontFace: bodyFont,
        color: "1A1A1A",
        valign: "top",
        paraSpaceAfter: 4,
      });
    }

    // Pull quote on page 2 center column, if supported + present
    if (
      article.pullQuote &&
      pageIdx === 1 &&
      template.supports_pull_quote &&
      columnCount >= 3
    ) {
      const pqX = marginLeft + (columnWidth + gutterIn);
      slide.addText(`"${article.pullQuote}"`, {
        x: pqX,
        y: bodyStartY + bodyAvailableHeight * 0.35,
        w: columnWidth,
        h: pt2in(80),
        fontSize: Math.max(18, typ.body_pt * 1.6),
        fontFace: displayFont,
        italic: true,
        color: "C96E4E",
        align: "center",
        valign: "middle",
      });
    }

    // Folio (page number centered at foot)
    slide.addText(`${placement.startingPageNumber + pageIdx}`, {
      x: bleedIn,
      y: bleedIn + trimHeightIn - pt2in(14),
      w: trimWidthIn,
      h: pt2in(12),
      fontSize: 9,
      fontFace: sansFont,
      align: "center",
      color: "9B958E",
    });
  }

  return pagesNeeded;
}

function drawTrimGuides(
  slide: pptxgen.Slide,
  bleedIn: number,
  trimWidthIn: number,
  trimHeightIn: number
): void {
  // Top + bottom trim lines
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
}

/**
 * Distribute body across column capacity slots. Each slot gets approximately
 * its pro-rata share of the body, snapped to word boundaries so we never cut
 * mid-word. If body is shorter than total capacity, trailing slots are empty.
 */
function distributeToColumns(body: string, capacities: number[]): string[] {
  const totalCap = capacities.reduce((a, b) => a + b, 0);
  if (body.length === 0 || totalCap === 0) return capacities.map(() => "");

  const totalCharsToAssign = Math.min(body.length, totalCap);

  // Allocate each slot its share of the body, capped by slot capacity
  const slotChars = capacities.map((cap) => {
    const share = Math.floor((cap / totalCap) * totalCharsToAssign);
    return Math.min(share, cap);
  });

  // Leftover from rounding goes into the last slot (will truncate if it
  // overshoots capacity — body length is capped earlier)
  let assigned = slotChars.reduce((a, b) => a + b, 0);
  let idx = 0;
  while (assigned < totalCharsToAssign && idx < slotChars.length) {
    if (slotChars[idx]! < capacities[idx]!) {
      slotChars[idx] = slotChars[idx]! + 1;
      assigned += 1;
    }
    idx += 1;
    if (idx >= slotChars.length) idx = 0;
  }

  // Carve + word-boundary snap
  const segments: string[] = [];
  let cursor = 0;
  for (let i = 0; i < slotChars.length; i += 1) {
    const want = slotChars[i] ?? 0;
    if (want === 0 || cursor >= body.length) {
      segments.push("");
      continue;
    }
    let end = Math.min(body.length, cursor + want);
    // Snap to word boundary unless we're at the exact end of body
    if (end < body.length) {
      while (end > cursor && !/\s/.test(body[end] ?? "") && !/\s/.test(body[end - 1] ?? "")) {
        end -= 1;
      }
      if (end === cursor) end = Math.min(body.length, cursor + want); // fallback
    }
    segments.push(body.slice(cursor, end).trim());
    cursor = end;
  }
  return segments;
}

/** Estimate effective char count (ignores excess whitespace clustering). */
function estimateCharsNeeded(body: string): number {
  // Add ~10% buffer for paragraph breaks + leading taking visual space
  return Math.ceil(body.length * 1.1);
}
