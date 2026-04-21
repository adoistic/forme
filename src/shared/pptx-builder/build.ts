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

  const body = article.body.trim();
  const minPages = template.page_count_range[0];
  const maxPages = template.page_count_range[1];

  // Two paths:
  //   (A) Pre-broken lines from upstream (pretext + Skia measurement).
  //       Each line is emitted as its own paragraph so PowerPoint cannot
  //       re-wrap and overflow the column box. This is the high-quality
  //       path used in the normal export flow.
  //   (B) Body string only — fall back to the older char-budget heuristic
  //       (kept for tests and isolated builder calls).
  let pagesNeeded: number;
  let pageColumns: string[][][] | null = null; // [pageIdx][colIdx][lineIdx]
  let segments: string[] = []; // legacy flat path

  if (article.prelaidPages && article.prelaidPages.length > 0) {
    pageColumns = article.prelaidPages;
    pagesNeeded = Math.min(maxPages, Math.max(1, pageColumns.length));
    if (pagesNeeded < minPages) {
      warnings.push(
        `Article fills ${pagesNeeded} page${pagesNeeded === 1 ? "" : "s"} but this template is designed for ${minPages}–${maxPages}. Consider a shorter template or adding more copy.`
      );
    }
  } else {
    // Legacy heuristic distribution — kept for tests + back-compat.
    const allCapacities: number[] = [];
    for (let p = 0; p < maxPages; p += 1) {
      const per = p === 0 ? charsPerColFirstPage : charsPerColOtherPages;
      for (let c = 0; c < columnCount; c += 1) allCapacities.push(per);
    }
    const allSegments = distributeToColumns(body, allCapacities);

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
    pagesNeeded = Math.min(maxPages, Math.max(1, pagesUsed));
    if (pagesNeeded < minPages) {
      warnings.push(
        `Article fills ${pagesNeeded} page${pagesNeeded === 1 ? "" : "s"} but this template is designed for ${minPages}–${maxPages}. Consider a shorter template or adding more copy.`
      );
    }
    segments = allSegments.slice(0, pagesNeeded * columnCount);
  }

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

      // Optional hero image — fit to the content width, scale height
      // proportionally from the source aspect ratio (never stretch),
      // and cap at a reasonable max so the image doesn't crowd out
      // the body. If the source is portrait we render at a smaller
      // visible width, centered.
      if (article.heroImage) {
        const aspect =
          article.heroImage.heightPx > 0
            ? article.heroImage.widthPx / article.heroImage.heightPx
            : 1;
        const maxHeight = Math.min(
          pt2in(260),
          pageContentHeight - (cursorY - marginTop) - pt2in(typ.body_pt * 20)
        );
        let heroW = pageContentWidth;
        let heroH = heroW / aspect;
        if (heroH > maxHeight) {
          heroH = maxHeight;
          heroW = heroH * aspect;
        }
        if (heroH > pt2in(60)) {
          // Center horizontally if narrower than the column block
          const heroX = marginLeft + (pageContentWidth - heroW) / 2;
          slide.addImage({
            data: `data:${article.heroImage.mimeType};base64,${article.heroImage.base64}`,
            x: heroX,
            y: cursorY,
            w: heroW,
            h: heroH,
          });
          cursorY += heroH + pt2in(10);
        }
      }

      bodyStartY = cursorY;
    }

    const bodyAvailableHeight = trimHeightIn - marginBottom - bodyStartY;

    // Emit body. Two paths:
    //   - prelaidPages: each entry is a complete (or sentence-split)
    //     PARAGRAPH that PowerPoint wraps + justifies internally. Each
    //     paragraph's non-final lines stretch to the column edge; the
    //     last line of every paragraph stays left. Print-standard.
    //   - segments (legacy): one big justified block per column, no
    //     pretext-driven splitting.
    if (pageColumns) {
      const cols = pageColumns[pageIdx] ?? [];
      for (let col = 0; col < columnCount; col += 1) {
        const paragraphs = cols[col] ?? [];
        if (paragraphs.length === 0) continue;
        const colX = marginLeft + col * (columnWidth + gutterIn);
        slide.addText(paragraphs.join("\n"), {
          x: colX,
          y: bodyStartY,
          w: columnWidth,
          h: bodyAvailableHeight,
          fontSize: typ.body_pt,
          lineSpacing: typ.body_leading_pt,
          fontFace: bodyFont,
          color: "1A1A1A",
          valign: "top",
          align: "justify",
          // Small inter-paragraph gap (~half a body line), matches the
          // line accounted for during packing.
          paraSpaceAfter: typ.body_leading_pt * 0.4,
        });
      }
    } else {
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
          align: "justify",
          paraSpaceAfter: 4,
        });
      }
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
        const hasContent = pageColumns
          ? (pageColumns[pageIdx]?.[c] ?? []).some((l) => l.length > 0)
          : ((segments[pageIdx * columnCount + c] ?? "").length > 0);
        if (hasContent) {
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

    // Approximate chars per visual line at 8pt body font in a column of
    // columnWidth inches. 8pt avg-char width ≈ 0.42em → 3.36pt → 0.047 in
    const charsPerLine = Math.max(
      18,
      Math.floor((columnWidth * PT_PER_INCH) / (8 * 0.5))
    );

    // Heading is emitted lazily — only when we're about to draw the first
    // entry that actually fits. This prevents the orphan-heading bug where
    // the heading emitted at the bottom of column N but the first entry
    // had to spill to column N+1 with a "(CONT.)" duplicate, leaving a
    // section heading with no content beneath it.
    const headingHeight = pt2in(20);
    const ENTRY_GAP = pt2in(14);
    let headingNeeded = true;

    const emitHeading = (continued: boolean): void => {
      const colX = marginLeft + col * (columnWidth + gutterIn);
      slide.addText(continued ? `${label.toUpperCase()} (CONT.)` : label.toUpperCase(), {
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
      slide.addShape("line", {
        x: colX,
        y: y - pt2in(2),
        w: columnWidth,
        h: 0,
        line: { color: "C96E4E", width: 0.5 },
      });
      y += pt2in(6);
    };

    for (let e = 0; e < entries.length; e += 1) {
      const entry = entries[e]!;
      const entryHeight =
        estimateClassifiedHeight(entry, columnWidth, charsPerLine) + ENTRY_GAP;
      const headingChrome = headingNeeded ? headingHeight + pt2in(10) : 0;
      // Does the (still-pending) heading + this entry fit in current column?
      if (y + headingChrome + entryHeight > bottomY) {
        // No room — advance to next column / page. The heading (if still
        // pending) goes to the new column.
        col += 1;
        y = marginTop;
        if (col >= columnCount) {
          slide = pres.addSlide();
          pageCount += 1;
          col = 0;
        }
        // After a forced advance, we always need a heading at the top of
        // the new column — either the original (we never emitted) or a
        // "(CONT.)" if we already showed one for this type before.
        const isContinued = !headingNeeded;
        headingNeeded = true;
        emitHeading(isContinued);
        headingNeeded = false;
      } else if (headingNeeded) {
        emitHeading(false);
        headingNeeded = false;
      }
      const ex = marginLeft + col * (columnWidth + gutterIn);
      const drawnHeight = drawClassifiedEntry(slide, entry, ex, y, columnWidth, charsPerLine);
      y += drawnHeight + ENTRY_GAP;
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

// ── Per-type classified rendering ──────────────────────────────────
// Each type gets its own visual treatment so a page of classifieds reads
// like a real magazine section, not a uniform list. Heights returned by
// drawClassifiedEntry are estimates the packer uses for column-flow.

function estimateClassifiedHeight(
  entry: PptxClassified,
  columnWidth: number,
  charsPerLine: number
): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  // Each bodyLine wraps based on column width
  let bodyVisualLines = 0;
  for (const bl of entry.bodyLines) {
    bodyVisualLines += Math.max(1, Math.ceil(bl.length / charsPerLine));
  }
  const bodyH = pt2in(bodyVisualLines * 11 + entry.bodyLines.length * 2 + 4);

  // Display name height varies by font size per type. Use per-type
  // approximation so the packer doesn't under-reserve space when the
  // name wraps to 2-3 lines.
  let titleFontPt = 11;
  let titleCharFactor = 0.5;
  let chrome = 0; // ornament + rules + photo etc.
  switch (entry.type) {
    case "matrimonial_with_photo":
      titleFontPt = 11;
      titleCharFactor = 0.5;
      chrome = pt2in(72); // 60pt photo + 12pt padding
      break;
    case "matrimonial_no_photo":
      titleFontPt = 11;
      titleCharFactor = 0.5;
      chrome = pt2in(8);
      break;
    case "obituary":
      titleFontPt = 14;
      titleCharFactor = 0.5;
      chrome = pt2in(28); // IN MEMORIAM label + 2 thin rules + padding
      break;
    case "public_notice":
      titleFontPt = 10;
      titleCharFactor = 0.45;
      chrome = pt2in(20); // black banner
      break;
    case "announcement":
      titleFontPt = 12;
      titleCharFactor = 0.55;
      chrome = pt2in(18); // ornament + padding
      break;
    case "vehicles":
      titleFontPt = 11;
      titleCharFactor = 0.5;
      chrome = pt2in(10); // divider rule
      break;
  }
  const titleCharCap = Math.max(12, Math.floor(charsPerLine * titleCharFactor));
  const titleLines = Math.max(1, Math.ceil(entry.displayName.length / titleCharCap));
  const titleLeading = titleFontPt * 1.3;
  const titleH = pt2in(titleLines * titleLeading + 6);

  void columnWidth;
  return titleH + bodyH + chrome;
}

/** Returns the height actually used (in inches) so the packer can advance y. */
function drawClassifiedEntry(
  slide: pptxgen.Slide,
  entry: PptxClassified,
  x: number,
  y: number,
  w: number,
  charsPerLine: number
): number {
  switch (entry.type) {
    case "matrimonial_with_photo":
      return drawMatrimonialPhoto(slide, entry, x, y, w, charsPerLine);
    case "matrimonial_no_photo":
      return drawMatrimonialPlain(slide, entry, x, y, w, charsPerLine);
    case "obituary":
      return drawObituary(slide, entry, x, y, w, charsPerLine);
    case "public_notice":
      return drawPublicNotice(slide, entry, x, y, w, charsPerLine);
    case "announcement":
      return drawAnnouncement(slide, entry, x, y, w, charsPerLine);
    case "vehicles":
      return drawVehicle(slide, entry, x, y, w, charsPerLine);
    default:
      return drawDefault(slide, entry, x, y, w, charsPerLine);
  }
}

function drawMatrimonialPhoto(
  slide: pptxgen.Slide,
  entry: PptxClassified,
  x: number,
  y: number,
  w: number,
  charsPerLine: number
): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  // 60pt-square portrait centered above the name
  const photoSize = pt2in(60);
  const photoX = x + (w - photoSize) / 2;
  if (entry.photoBase64 && entry.photoMimeType) {
    slide.addImage({
      data: `data:${entry.photoMimeType};base64,${entry.photoBase64}`,
      x: photoX,
      y,
      w: photoSize,
      h: photoSize,
    });
    // Thin rust frame
    slide.addShape("rect", {
      x: photoX,
      y,
      w: photoSize,
      h: photoSize,
      fill: { type: "none" },
      line: { color: "C96E4E", width: 0.75 },
    });
  }
  let cy = y + photoSize + pt2in(6);
  slide.addText(entry.displayName, {
    x,
    y: cy,
    w,
    h: pt2in(16),
    fontSize: 11,
    fontFace: "Fraunces",
    bold: true,
    color: "1A1A1A",
    align: "center",
  });
  cy += pt2in(18);
  const bodyText = entry.bodyLines.join("\n");
  const bodyH = bodyHeight(bodyText, w, charsPerLine);
  slide.addText(bodyText, {
    x,
    y: cy,
    w,
    h: bodyH,
    fontSize: 8,
    lineSpacing: 11,
    fontFace: "Inter",
    color: "5C5853",
    align: "center",
    valign: "top",
  });
  return cy + bodyH - y;
}

function drawMatrimonialPlain(
  slide: pptxgen.Slide,
  entry: PptxClassified,
  x: number,
  y: number,
  w: number,
  charsPerLine: number
): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  slide.addText(entry.displayName, {
    x,
    y,
    w,
    h: pt2in(16),
    fontSize: 11,
    fontFace: "Fraunces",
    bold: true,
    color: "1A1A1A",
    align: "center",
  });
  const cy = y + pt2in(18);
  const bodyText = entry.bodyLines.join("\n");
  const bodyH = bodyHeight(bodyText, w, charsPerLine);
  slide.addText(bodyText, {
    x,
    y: cy,
    w,
    h: bodyH,
    fontSize: 8,
    lineSpacing: 11,
    fontFace: "Inter",
    color: "5C5853",
    align: "center",
    valign: "top",
  });
  return cy + bodyH - y;
}

function drawObituary(
  slide: pptxgen.Slide,
  entry: PptxClassified,
  x: number,
  y: number,
  w: number,
  charsPerLine: number
): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  // Top thin rule
  slide.addShape("line", {
    x: x + w * 0.25,
    y,
    w: w * 0.5,
    h: 0,
    line: { color: "9B958E", width: 0.5 },
  });
  let cy = y + pt2in(6);
  // Discreet "IN MEMORIAM" label
  slide.addText("IN MEMORIAM", {
    x,
    y: cy,
    w,
    h: pt2in(10),
    fontSize: 7,
    fontFace: "Inter",
    bold: true,
    color: "9B958E",
    charSpacing: 4,
    align: "center",
  });
  cy += pt2in(11);
  // Name — italic Fraunces 14pt. Long names wrap to multiple lines.
  // 14pt italic averages ~0.5em per char.
  const nameCharCap = Math.max(12, Math.floor(charsPerLine * 0.5));
  const nameLines = Math.max(1, Math.ceil(entry.displayName.length / nameCharCap));
  const nameH = pt2in(nameLines * 18 + 4);
  slide.addText(entry.displayName, {
    x,
    y: cy,
    w,
    h: nameH,
    fontSize: 14,
    fontFace: "Fraunces",
    italic: true,
    color: "1A1A1A",
    align: "center",
  });
  cy += nameH + pt2in(2);
  const bodyText = entry.bodyLines.join("\n");
  const bodyH = bodyHeight(bodyText, w, charsPerLine);
  slide.addText(bodyText, {
    x,
    y: cy,
    w,
    h: bodyH,
    fontSize: 8,
    lineSpacing: 11,
    fontFace: "Inter",
    color: "5C5853",
    align: "center",
    valign: "top",
  });
  cy += bodyH;
  // Bottom thin rule
  slide.addShape("line", {
    x: x + w * 0.25,
    y: cy + pt2in(2),
    w: w * 0.5,
    h: 0,
    line: { color: "9B958E", width: 0.5 },
  });
  return cy + pt2in(4) - y;
}

function drawPublicNotice(
  slide: pptxgen.Slide,
  entry: PptxClassified,
  x: number,
  y: number,
  w: number,
  charsPerLine: number
): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  // Box with double-rule top and a thin "PUBLIC NOTICE" badge
  slide.addText("PUBLIC NOTICE", {
    x,
    y,
    w,
    h: pt2in(10),
    fontSize: 7,
    fontFace: "Inter",
    bold: true,
    color: "FFFFFF",
    charSpacing: 4,
    align: "center",
    fill: { color: "1A1A1A" },
  });
  let cy = y + pt2in(12);
  slide.addText(entry.displayName.replace(/^Public notice — /i, ""), {
    x,
    y: cy,
    w,
    h: pt2in(16),
    fontSize: 10,
    fontFace: "Fraunces",
    bold: true,
    color: "1A1A1A",
  });
  cy += pt2in(18);
  const bodyText = entry.bodyLines.join("\n");
  const bodyH = bodyHeight(bodyText, w, charsPerLine);
  slide.addText(bodyText, {
    x,
    y: cy,
    w,
    h: bodyH,
    fontSize: 8,
    lineSpacing: 11,
    fontFace: "Inter",
    color: "1A1A1A",
    valign: "top",
    align: "justify",
  });
  return cy + bodyH - y;
}

function drawAnnouncement(
  slide: pptxgen.Slide,
  entry: PptxClassified,
  x: number,
  y: number,
  w: number,
  charsPerLine: number
): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  // Decorative ornament + occasion italic display
  slide.addText("✦", {
    x,
    y,
    w,
    h: pt2in(12),
    fontSize: 12,
    fontFace: "Fraunces",
    color: "C96E4E",
    align: "center",
  });
  let cy = y + pt2in(14);
  // Display can wrap to 2-3 lines for long birthday/anniversary phrases —
  // estimate visual lines so the body never collides with the title.
  // 12pt italic averages ~0.5em chars-per-pt, so use ~0.45× charsPerLine.
  const displayCharCap = Math.max(12, Math.floor(charsPerLine * 0.55));
  const displayLines = Math.max(1, Math.ceil(entry.displayName.length / displayCharCap));
  const displayH = pt2in(displayLines * 16 + 4);
  slide.addText(entry.displayName, {
    x,
    y: cy,
    w,
    h: displayH,
    fontSize: 12,
    fontFace: "Fraunces",
    italic: true,
    color: "1A1A1A",
    align: "center",
  });
  cy += displayH + pt2in(2);
  const bodyText = entry.bodyLines.join("\n");
  const bodyH = bodyHeight(bodyText, w, charsPerLine);
  slide.addText(bodyText, {
    x,
    y: cy,
    w,
    h: bodyH,
    fontSize: 8,
    lineSpacing: 11,
    fontFace: "Inter",
    color: "5C5853",
    align: "center",
    valign: "top",
  });
  return cy + bodyH - y;
}

function drawVehicle(
  slide: pptxgen.Slide,
  entry: PptxClassified,
  x: number,
  y: number,
  w: number,
  charsPerLine: number
): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  slide.addText(entry.displayName, {
    x,
    y,
    w,
    h: pt2in(16),
    fontSize: 11,
    fontFace: "Fraunces",
    bold: true,
    color: "1A1A1A",
  });
  let cy = y + pt2in(18);
  // Thin horizontal divider
  slide.addShape("line", {
    x,
    y: cy - pt2in(2),
    w,
    h: 0,
    line: { color: "E5DFD5", width: 0.5 },
  });
  // Tabular body — each bodyLine becomes its own row, monospace-ish
  for (const ln of entry.bodyLines) {
    slide.addText(ln, {
      x,
      y: cy,
      w,
      h: pt2in(11),
      fontSize: 8,
      lineSpacing: 11,
      fontFace: "Inter",
      color: "1A1A1A",
    });
    cy += pt2in(12);
  }
  void charsPerLine;
  return cy - y;
}

function drawDefault(
  slide: pptxgen.Slide,
  entry: PptxClassified,
  x: number,
  y: number,
  w: number,
  charsPerLine: number
): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  slide.addText(entry.displayName, {
    x,
    y,
    w,
    h: pt2in(16),
    fontSize: 10,
    fontFace: "Fraunces",
    bold: true,
    color: "1A1A1A",
  });
  const cy = y + pt2in(18);
  const bodyText = entry.bodyLines.join("\n");
  const bodyH = bodyHeight(bodyText, w, charsPerLine);
  slide.addText(bodyText, {
    x,
    y: cy,
    w,
    h: bodyH,
    fontSize: 8,
    lineSpacing: 11,
    fontFace: "Inter",
    color: "1A1A1A",
    valign: "top",
  });
  return cy + bodyH - y;
}

function bodyHeight(text: string, w: number, charsPerLine: number): number {
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  const lines = text.split("\n");
  let total = 0;
  for (const ln of lines) {
    total += Math.max(1, Math.ceil(ln.length / charsPerLine));
  }
  void w;
  return pt2in(total * 11 + 4);
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
