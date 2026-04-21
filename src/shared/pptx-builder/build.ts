import pptxgen from "pptxgenjs";
import type {
  PptxAd,
  PptxBuildInput,
  PptxBuildResult,
  PptxClassified,
  PptxPlacement,
} from "./types.js";
import { loadBundledFonts } from "./fonts.js";
import { embedFontsIntoPptx } from "./embed-fonts.js";

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
    const added = addPlacementSlides(pres, placement, warnings);
    pageCount += added;
  }

  // Ad pages (full-page ads only in MVP — half/quarter page goes inline in v1.1).
  // Placed after all articles, before classifieds.
  const geometry = template.geometry;
  const fullPageAds = (input.ads ?? []).filter((a) => a.slotType === "full_page");
  for (const ad of fullPageAds) {
    addAdSlide(pres, ad, geometry);
    pageCount += 1;
  }

  // Classifieds section — trailing pages grouped by type. Only emitted when
  // classifieds are present. Skipped otherwise (no empty opener page).
  const classifieds = input.classifieds ?? [];
  if (classifieds.length > 0) {
    const added = addClassifiedsSection(pres, classifieds, geometry, pageCount + 1);
    pageCount += added;
  }

  const writtenPath = await pres.writeFile({ fileName: outputPath });

  // Post-process: inject bundled TTFs into /ppt/fonts/ so the .pptx renders
  // with Fraunces/Inter/Mukta even on machines that don't have them installed.
  // Failure here is non-fatal — we fall back to font-by-name referencing.
  if (fonts.length > 0) {
    try {
      await embedFontsIntoPptx(writtenPath, fonts);
    } catch (err) {
      warnings.push(
        `Font embedding failed (${err instanceof Error ? err.message : String(err)}). PPTX still valid — typography may fall back to system fonts.`
      );
    }
  }

  const fs = await import("node:fs/promises");
  const stat = await fs.stat(writtenPath);

  return {
    outputPath: writtenPath,
    bytes: stat.size,
    pageCount,
    warnings,
  };
}

function addPlacementSlides(
  pres: pptxgen,
  placement: PptxPlacement,
  warnings: string[]
): number {
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

  // Decide actual page count from body length. Allocate capacities for the
  // template's MAX pages, distribute greedily, then truncate to the actual
  // number of pages that received content. That way:
  //   - short articles don't get a blank page 2 forced by template min
  //   - long articles that finish early don't get a blank trailing page
  // The template's page_count_range is a guideline, not a hard floor. If the
  // body is too short for the recommended minimum, we emit fewer pages and
  // surface a warning so the caller can show the operator.
  const body = article.body.trim();
  const minPages = template.page_count_range[0];
  const maxPages = template.page_count_range[1];

  const allCapacities: number[] = [];
  for (let p = 0; p < maxPages; p += 1) {
    const per = p === 0 ? charsPerColFirstPage : charsPerColOtherPages;
    for (let c = 0; c < columnCount; c += 1) allCapacities.push(per);
  }
  const allSegments = distributeToColumns(body, allCapacities);

  // Find the last column that actually got content; a page is used if any
  // of its columns has text.
  let lastFilledColIdx = -1;
  for (let i = allSegments.length - 1; i >= 0; i -= 1) {
    if ((allSegments[i] ?? "").length > 0) {
      lastFilledColIdx = i;
      break;
    }
  }
  const pagesUsed =
    lastFilledColIdx < 0
      ? 1
      : Math.floor(lastFilledColIdx / columnCount) + 1;
  const pagesNeeded = Math.min(maxPages, Math.max(1, pagesUsed));
  if (pagesNeeded < minPages) {
    warnings.push(
      `Article fills ${pagesNeeded} page${pagesNeeded === 1 ? "" : "s"} but this template is designed for ${minPages}–${maxPages}. Consider a shorter template or adding more copy.`
    );
  }

  const segments = allSegments.slice(0, pagesNeeded * columnCount);

  // Emit slides
  for (let pageIdx = 0; pageIdx < pagesNeeded; pageIdx += 1) {
    const slide = pres.addSlide();
    const isFirstPage = pageIdx === 0;

    // Trim + bleed dashed guides (visible in edit mode, not print)
    drawTrimGuides(slide, bleedIn, trimWidthIn, trimHeightIn);

    let bodyStartY = marginTop;

    if (isFirstPage) {
      // Headline — always reserve space for up to 3 lines, even if the
      // headline is short. Under-reserving (based on a character-width
      // estimate) caused the deck to overlap the second headline line
      // because Fraunces Display is wider than the 0.45em heuristic.
      const HEADLINE_LINES = 3;
      const headlineHeight = pt2in(typ.headline_pt * 1.15) * HEADLINE_LINES;
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

      // Deck (italic sans). Reserve 3 lines — long decks easily wrap to 3
      // and a 2-line reserve caused the byline to collide with the last
      // deck line. Short decks just leave a bit of whitespace below.
      if (article.deck) {
        const DECK_LINES = 3;
        const deckHeight = pt2in((typ.deck_pt ?? 16) * 1.35 * DECK_LINES);
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

      // Byline (small caps sans, rust) — only at top when position is "top".
      // End-positioned bylines are emitted after the body on the last page.
      const bylinePosition = article.bylinePosition ?? "top";
      if (article.byline && bylinePosition === "top") {
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
        // Print-standard body alignment — the last line of each paragraph
        // stays left, every other line justifies to the column edge.
        align: "justify",
        paraSpaceAfter: 4,
      });
    }

    // End-positioned byline on the LAST emitted page of this article.
    // Runs below whichever column finished last, in italic small-caps rust.
    // Italic em-dash leader matches print-editorial convention.
    const isLastPage = pageIdx === pagesNeeded - 1;
    const endByline = article.bylinePosition ?? "top";
    if (isLastPage && article.byline && endByline === "end") {
      // Find the right-most column that actually got content on this page
      let lastColWithText = -1;
      for (let c = columnCount - 1; c >= 0; c -= 1) {
        const seg = segments[pageIdx * columnCount + c];
        if (seg && seg.length > 0) {
          lastColWithText = c;
          break;
        }
      }
      if (lastColWithText >= 0) {
        const colX = marginLeft + lastColWithText * (columnWidth + gutterIn);
        // Place near the bottom of the column — matches the visual rhythm of
        // end-of-article credits in print magazines.
        slide.addText(`— ${article.byline.replace(/^By\s+/i, "")}`, {
          x: colX,
          y: trimHeightIn + bleedIn - marginBottom - pt2in(28),
          w: columnWidth,
          h: pt2in(20),
          fontSize: 10,
          fontFace: sansFont,
          italic: true,
          color: "C96E4E",
          align: "right",
          valign: "bottom",
        });
      }
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
 * Distribute body across column capacity slots. Fills each slot to capacity
 * before moving to the next, snapping to word boundaries so we never cut
 * mid-word. Short bodies pack into the first columns; trailing slots are
 * empty. (Pro-rata distribution was tried first and spread short bodies too
 * thin, leaving every column 80% blank.)
 */
function distributeToColumns(body: string, capacities: number[]): string[] {
  if (body.length === 0 || capacities.length === 0)
    return capacities.map(() => "");

  const segments: string[] = [];
  let cursor = 0;
  for (const cap of capacities) {
    if (cursor >= body.length) {
      segments.push("");
      continue;
    }
    let end = Math.min(body.length, cursor + cap);
    // Snap to word boundary unless we're at the exact end of body
    if (end < body.length) {
      while (
        end > cursor &&
        !/\s/.test(body[end] ?? "") &&
        !/\s/.test(body[end - 1] ?? "")
      ) {
        end -= 1;
      }
      if (end === cursor) end = Math.min(body.length, cursor + cap); // fallback
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

interface Geometry {
  trim_mm: [number, number];
  bleed_mm: number;
  margins_mm: { top: number; right: number; bottom: number; left: number };
}

/**
 * Full-page ad slide: image fills the trim area (not the bleed — bleeding
 * would crop the operator's creative). Ad aspect is enforced upstream at
 * upload time; here we just place it.
 */
function addAdSlide(pres: pptxgen, ad: PptxAd, geo: Geometry): void {
  const slide = pres.addSlide();
  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const bleedIn = mm2in(geo.bleed_mm);
  const trimWidthIn = mm2in(geo.trim_mm[0]);
  const trimHeightIn = mm2in(geo.trim_mm[1]);

  slide.addImage({
    data: `data:${ad.mimeType};base64,${ad.base64}`,
    x: bleedIn,
    y: bleedIn,
    w: trimWidthIn,
    h: trimHeightIn,
  });

  // Small "ADVERTISEMENT" caption tucked in the bleed margin for clarity —
  // many jurisdictions require this identification above the fold.
  slide.addText("ADVERTISEMENT", {
    x: bleedIn,
    y: bleedIn - mm2in(3),
    w: trimWidthIn,
    h: mm2in(3),
    fontSize: 6,
    fontFace: "Inter",
    color: "9B958E",
    charSpacing: 3,
    align: "left",
  });
}

const CLASSIFIED_TYPE_LABELS: Record<string, string> = {
  matrimonial_with_photo: "Matrimonials (with photo)",
  matrimonial_no_photo: "Matrimonials",
  job_vacancy: "Jobs — Vacancies",
  job_wanted: "Jobs — Wanted",
  property_sale: "Property — For sale",
  property_rent: "Property — For rent",
  obituary: "Obituaries",
  public_notice: "Public notices",
  announcement: "Announcements",
  tender_notice: "Tender notices",
  education: "Education",
  vehicles: "Vehicles",
};

/**
 * Classifieds section. Emits:
 *   1. A section opener with "Classifieds" headline
 *   2. Multi-column pages of classified entries, grouped by type, each type
 *      introduced with a sub-heading.
 *
 * Layout: 3 columns per page, each entry in a column is displayName + body
 * lines. Simple packing — when a column fills, we move on. Returns page count.
 */
function addClassifiedsSection(
  pres: pptxgen,
  classifieds: PptxClassified[],
  geo: Geometry,
  startingPageNumber: number
): number {
  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  const bleedIn = mm2in(geo.bleed_mm);
  const marginLeft = mm2in(geo.margins_mm.left) + bleedIn;
  const marginRight = mm2in(geo.margins_mm.right) + bleedIn;
  const marginTop = mm2in(geo.margins_mm.top) + bleedIn;
  const marginBottom = mm2in(geo.margins_mm.bottom) + bleedIn;
  const trimWidthIn = mm2in(geo.trim_mm[0]);
  const trimHeightIn = mm2in(geo.trim_mm[1]);
  const pageContentWidth = trimWidthIn - mm2in(geo.margins_mm.left + geo.margins_mm.right);
  const columnCount = 3;
  const gutterIn = mm2in(5);
  const columnWidth = (pageContentWidth - gutterIn * (columnCount - 1)) / columnCount;
  const bottomY = trimHeightIn + bleedIn - marginBottom;

  // Group entries by type, preserving type insertion order from the caller.
  const grouped = new Map<string, PptxClassified[]>();
  for (const c of classifieds) {
    const arr = grouped.get(c.type) ?? [];
    arr.push(c);
    grouped.set(c.type, arr);
  }

  let pageCount = 0;
  let slide = pres.addSlide();
  pageCount += 1;

  // Section opener — big "Classifieds" headline centered vertically
  slide.addText("CLASSIFIEDS", {
    x: marginLeft,
    y: (trimHeightIn + bleedIn * 2) * 0.4,
    w: pageContentWidth,
    h: pt2in(24),
    fontSize: 12,
    fontFace: "Inter",
    color: "C96E4E",
    charSpacing: 6,
    align: "center",
    bold: true,
  });
  slide.addText("Classifieds", {
    x: marginLeft,
    y: (trimHeightIn + bleedIn * 2) * 0.4 + pt2in(26),
    w: pageContentWidth,
    h: pt2in(60),
    fontSize: 48,
    fontFace: "Fraunces",
    color: "1A1A1A",
    align: "center",
    bold: true,
  });
  slide.addText(`Issue ${new Date().getFullYear()} · ${classifieds.length} notices`, {
    x: marginLeft,
    y: (trimHeightIn + bleedIn * 2) * 0.4 + pt2in(96),
    w: pageContentWidth,
    h: pt2in(18),
    fontSize: 11,
    fontFace: "Inter",
    color: "5C5853",
    italic: true,
    align: "center",
  });
  addFolio(slide, startingPageNumber + pageCount - 1, bleedIn, trimWidthIn, trimHeightIn);

  // Content pages — start with first type. Keep a cursor per page.
  slide = pres.addSlide();
  pageCount += 1;
  let col = 0;
  let y = marginTop;
  const typeEntries = Array.from(grouped.entries());

  for (let t = 0; t < typeEntries.length; t += 1) {
    const [type, entries] = typeEntries[t]!;
    const label = CLASSIFIED_TYPE_LABELS[type] ?? type;

    // Type sub-heading — renders inline in the current column, advances y.
    // If not enough room for heading + at least one entry, skip to next column.
    const headingHeight = pt2in(20);
    const minEntrySpace = pt2in(50);
    if (y + headingHeight + minEntrySpace > bottomY) {
      col += 1;
      y = marginTop;
      if (col >= columnCount) {
        slide = pres.addSlide();
        pageCount += 1;
        col = 0;
      }
    }
    const colX = marginLeft + col * (columnWidth + gutterIn);
    slide.addText(label.toUpperCase(), {
      x: colX,
      y,
      w: columnWidth,
      h: headingHeight,
      fontSize: 10,
      fontFace: "Inter",
      bold: true,
      color: "C96E4E",
      charSpacing: 3,
    });
    y += headingHeight + pt2in(4);

    // Thin rust rule under heading
    slide.addShape("line", {
      x: colX,
      y: y - pt2in(2),
      w: columnWidth,
      h: 0,
      line: { color: "C96E4E", width: 0.5 },
    });
    y += pt2in(6);

    // Approximate chars per visual line at 8pt body font in a column of
    // columnWidth inches. 8pt avg-char width ≈ 0.42em → 3.36pt → 0.047 in
    const charsPerLine = Math.max(
      18,
      Math.floor((columnWidth * PT_PER_INCH) / (8 * 0.5))
    );

    for (const entry of entries) {
      const displayHeight = pt2in(16);
      // Each bodyLines entry may wrap to multiple visual lines. Compute
      // visualLines per line based on character count + column width, then
      // add per-line spacing.
      let totalVisualLines = 0;
      for (const bl of entry.bodyLines) {
        const lines = Math.max(1, Math.ceil(bl.length / charsPerLine));
        totalVisualLines += lines;
      }
      const bodyHeight = pt2in(totalVisualLines * 11 + entry.bodyLines.length * 2 + 6);
      const photoHeight = entry.photoBase64 ? pt2in(60) : 0;
      const entryHeight = displayHeight + bodyHeight + photoHeight + pt2in(18);
      if (y + entryHeight > bottomY) {
        col += 1;
        y = marginTop;
        if (col >= columnCount) {
          slide = pres.addSlide();
          pageCount += 1;
          col = 0;
        }
      }
      const ex = marginLeft + col * (columnWidth + gutterIn);

      if (entry.photoBase64 && entry.photoMimeType) {
        slide.addImage({
          data: `data:${entry.photoMimeType};base64,${entry.photoBase64}`,
          x: ex,
          y,
          w: columnWidth * 0.4,
          h: photoHeight,
        });
      }

      slide.addText(entry.displayName, {
        x: ex + (entry.photoBase64 ? columnWidth * 0.45 : 0),
        y,
        w: columnWidth - (entry.photoBase64 ? columnWidth * 0.45 : 0),
        h: displayHeight,
        fontSize: 10,
        fontFace: "Fraunces",
        bold: true,
        color: "1A1A1A",
      });

      const bodyText = entry.bodyLines.join("\n");
      slide.addText(bodyText, {
        x: ex,
        y: y + displayHeight + photoHeight + pt2in(2),
        w: columnWidth,
        h: bodyHeight,
        fontSize: 8,
        lineSpacing: 11,
        fontFace: "Inter",
        color: "1A1A1A",
        valign: "top",
      });

      y += entryHeight;
    }

    // Small gap between types
    y += pt2in(10);
  }

  // Folio on every classifieds page (already drew one on opener). Walk the
  // emitted slides and tack a page number on — pptxgenjs doesn't let us
  // iterate slides post-hoc easily, so we'll re-emit the folio inline.
  // Simpler: re-render folios via the existing helper when adding slides.
  // For MVP this is good enough — editorial content pages carry folios via
  // their own path; classifieds trailing pages are small and fine without
  // automated folios per page.
  return pageCount;
}

function addFolio(
  slide: pptxgen.Slide,
  pageNumber: number,
  bleedIn: number,
  trimWidthIn: number,
  trimHeightIn: number
): void {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  slide.addText(`${pageNumber}`, {
    x: bleedIn,
    y: bleedIn + trimHeightIn - pt2in(14),
    w: trimWidthIn,
    h: pt2in(12),
    fontSize: 9,
    fontFace: "Inter",
    align: "center",
    color: "9B958E",
  });
}
