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

  // Page-context: every add* function uses this to know its page number,
  // emit recto/verso folios + running headers, and track issue-wide state.
  const ctx: BuildContext = {
    pres,
    pageNumber: 1,
    publicationName: input.publicationName,
    issueLabel: formatIssueLabel(input),
    geometry: template.geometry,
  };

  const emitFrontMatter = input.emitFrontMatter !== false;

  // Group ads by position so each routes to the right page-region.
  // Ads without an explicit position default to "between".
  const allAds = input.ads ?? [];
  const adsByPosition = {
    inside_front: allAds.filter((a) => a.position === "inside_front"),
    inside_back: allAds.filter((a) => a.position === "inside_back"),
    back_cover: allAds.filter((a) => a.position === "back_cover"),
    between: allAds.filter(
      (a) => a.position === "between" || (!a.position && a.slotType === "full_page")
    ),
    bottom_strip: allAds.filter((a) => a.position === "bottom_strip"),
    half_page_bottom: allAds.filter((a) => a.position === "half_page_bottom"),
  };

  // 1. Cover page
  if (emitFrontMatter) {
    addCoverSlide(ctx, input);
    ctx.pageNumber += 1;
  }

  // 1b. Inside-front-cover ad (full-bleed, after cover, before TOC).
  for (const ad of adsByPosition.inside_front) {
    addAdSlide(pres, ad, template.geometry, ctx);
    ctx.pageNumber += 1;
  }

  // 2. Table of contents
  if (emitFrontMatter && input.placements.length > 0) {
    const firstArticlePage = ctx.pageNumber + 1;
    addTocSlide(ctx, input.placements, firstArticlePage);
    ctx.pageNumber += 1;
  }

  // 3. Article placements — interleave "between" ads after every ~3
  // articles so the ads break up the editorial run instead of all
  // landing at the back of the book.
  const between = [...adsByPosition.between];
  for (let i = 0; i < input.placements.length; i += 1) {
    const placement = input.placements[i]!;
    const added = addPlacementSlides(pres, placement, warnings, ctx);
    ctx.pageNumber += added;
    // Every 3 articles, drop in a between-ad if any remain
    if ((i + 1) % 3 === 0 && between.length > 0) {
      const ad = between.shift()!;
      addAdSlide(pres, ad, template.geometry, ctx);
      ctx.pageNumber += 1;
    }
  }
  // Any remaining between-ads land before classifieds
  for (const ad of between) {
    addAdSlide(pres, ad, template.geometry, ctx);
    ctx.pageNumber += 1;
  }

  // 4. Classifieds.
  const geometry = template.geometry;
  const classifieds = input.classifieds ?? [];
  if (classifieds.length > 0) {
    const added = addClassifiedsSection(pres, classifieds, geometry, ctx.pageNumber, ctx);
    ctx.pageNumber += added;
  }

  // 5. Inside-back-cover ad
  for (const ad of adsByPosition.inside_back) {
    addAdSlide(pres, ad, template.geometry, ctx);
    ctx.pageNumber += 1;
  }

  // 6. Back-cover ad — should be the very last page. If none, emit a
  // simple colophon page so the issue ends gracefully.
  if (adsByPosition.back_cover.length > 0) {
    for (const ad of adsByPosition.back_cover) {
      addAdSlide(pres, ad, template.geometry, ctx);
      ctx.pageNumber += 1;
    }
  }

  const pageCount = ctx.pageNumber - 1;

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

// ── Magazine furniture: cover, TOC, page furniture (header + folio) ──

interface BuildContext {
  pres: pptxgen;
  pageNumber: number;
  publicationName: string;
  issueLabel: string;
  geometry: {
    trim_mm: [number, number];
    bleed_mm: number;
    margins_mm: { top: number; right: number; bottom: number; left: number };
  };
}

function formatIssueLabel(input: PptxBuildInput): string {
  const date = new Date(input.issueDate);
  const dateStr = isNaN(date.getTime())
    ? input.issueDate
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
  const num = input.issueNumber !== null ? `Issue ${input.issueNumber} · ` : "";
  return `${num}${dateStr}`;
}

/**
 * Page furniture — running header (publication | section | issue label)
 * across the top + folio at bottom. Recto pages (odd) get folio at bottom-
 * right, verso pages (even) at bottom-left. The header is omitted on cover
 * + section openers; pass section: null to skip it.
 */
function addPageFurniture(slide: pptxgen.Slide, ctx: BuildContext, section: string | null): void {
  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  const bleedIn = mm2in(ctx.geometry.bleed_mm);
  const trimWidthIn = mm2in(ctx.geometry.trim_mm[0]);
  const trimHeightIn = mm2in(ctx.geometry.trim_mm[1]);
  const marginLeft = mm2in(ctx.geometry.margins_mm.left) + bleedIn;
  const marginRight = mm2in(ctx.geometry.margins_mm.right) + bleedIn;
  const pageContentWidth =
    trimWidthIn - mm2in(ctx.geometry.margins_mm.left + ctx.geometry.margins_mm.right);

  const isRecto = ctx.pageNumber % 2 === 1;

  // Running header — small Inter caps, only when a section is set.
  if (section) {
    const headerY = bleedIn + mm2in(8);
    // Left segment: publication name on verso, section on recto
    // (matches the convention of magazines like The New Yorker).
    const leftText = isRecto ? section : ctx.publicationName;
    const rightText = isRecto ? ctx.publicationName : section;
    slide.addText(leftText.toUpperCase(), {
      x: marginLeft,
      y: headerY,
      w: pageContentWidth / 2,
      h: pt2in(10),
      fontSize: 7,
      fontFace: "Inter",
      color: "9B958E",
      charSpacing: 4,
      bold: true,
      align: "left",
    });
    slide.addText(rightText.toUpperCase(), {
      x: marginLeft + pageContentWidth / 2,
      y: headerY,
      w: pageContentWidth / 2,
      h: pt2in(10),
      fontSize: 7,
      fontFace: "Inter",
      color: "9B958E",
      charSpacing: 4,
      bold: true,
      align: "right",
    });
    // Thin rule beneath header
    slide.addShape("line", {
      x: marginLeft,
      y: headerY + pt2in(12),
      w: pageContentWidth,
      h: 0,
      line: { color: "E5DFD5", width: 0.5 },
    });
  }

  // Folio: page number at outer corner of foot. Box is wide enough for
  // 4-digit page numbers + a separator so "19" doesn't wrap to "1\n9".
  const folioY = bleedIn + trimHeightIn - mm2in(10);
  const folioW = pt2in(60);
  if (isRecto) {
    slide.addText(`${ctx.pageNumber}`, {
      x: trimWidthIn + bleedIn - marginRight - folioW,
      y: folioY,
      w: folioW,
      h: pt2in(12),
      fontSize: 9,
      fontFace: "Inter",
      bold: true,
      color: "5C5853",
      align: "right",
    });
  } else {
    slide.addText(`${ctx.pageNumber}`, {
      x: marginLeft,
      y: folioY,
      w: folioW,
      h: pt2in(12),
      fontSize: 9,
      fontFace: "Inter",
      bold: true,
      color: "5C5853",
      align: "left",
    });
  }
}

/**
 * Cover page. Composition (top → bottom):
 *
 *   1. ISSUE LABEL (small rust caps)              ← top, ~20mm down
 *   2. Wordmark (huge Fraunces display)           ← below the label
 *   3. Big cover image (full-width, ~55% of page) ← middle
 *   4. Cover-line teasers (italic, separated by ·)
 *
 * Falls back to a simpler text-only composition if no cover image.
 */
function addCoverSlide(ctx: BuildContext, input: PptxBuildInput): void {
  const slide = ctx.pres.addSlide();
  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  const bleedIn = mm2in(ctx.geometry.bleed_mm);
  const trimWidthIn = mm2in(ctx.geometry.trim_mm[0]);
  const trimHeightIn = mm2in(ctx.geometry.trim_mm[1]);
  const totalW = trimWidthIn + bleedIn * 2;
  const sideMargin = mm2in(15);

  slide.background = { color: "F5EFE7" };

  // 1. Issue label (top)
  slide.addText(ctx.issueLabel.toUpperCase(), {
    x: sideMargin,
    y: bleedIn + mm2in(15),
    w: totalW - sideMargin * 2,
    h: pt2in(14),
    fontSize: 9,
    fontFace: "Inter",
    color: "C96E4E",
    charSpacing: 8,
    bold: true,
    align: "center",
  });

  // 2. Wordmark — auto-shrink the font for long publication names so it
  // never wraps to two visual lines.
  const wordmark = input.publicationName;
  const wordmarkFontPt = wordmark.length > 24 ? 36 : wordmark.length > 16 ? 48 : 64;
  slide.addText(wordmark, {
    x: sideMargin,
    y: bleedIn + mm2in(22),
    w: totalW - sideMargin * 2,
    h: pt2in(wordmarkFontPt * 1.2),
    fontSize: wordmarkFontPt,
    fontFace: "Fraunces",
    bold: true,
    color: "1A1A1A",
    align: "center",
    valign: "top",
  });

  // 3. Cover image — dominant, full-width.
  if (input.coverImage) {
    const aspect =
      input.coverImage.heightPx > 0 ? input.coverImage.widthPx / input.coverImage.heightPx : 1.5;
    const imgW = totalW - bleedIn * 2; // full bleed left/right
    let imgH = imgW / aspect;
    const maxH = trimHeightIn * 0.55;
    if (imgH > maxH) {
      imgH = maxH;
      // Don't change width — let it crop visually if portrait.
    }
    const imgX = (totalW - imgW) / 2;
    const imgY = bleedIn + mm2in(60);
    slide.addImage({
      data: `data:${input.coverImage.mimeType};base64,${input.coverImage.base64}`,
      x: imgX,
      y: imgY,
      w: imgW,
      h: imgH,
    });
  }

  // 4. Cover-line teasers — bottom strip.
  const lines = input.coverLines ?? [];
  if (lines.length > 0) {
    const teaserText = lines.slice(0, 4).join("   ·   ");
    slide.addText(teaserText, {
      x: sideMargin,
      y: bleedIn + trimHeightIn - mm2in(25),
      w: totalW - sideMargin * 2,
      h: pt2in(20),
      fontSize: 10,
      fontFace: "Fraunces",
      italic: true,
      color: "1A1A1A",
      align: "center",
    });
  }
  // Cover gets no folio, no running header.
}

/**
 * Table of contents page. Lists each article with its starting page
 * number, separated by thin dotted leaders the way magazines have done
 * since print began.
 */
function addTocSlide(
  ctx: BuildContext,
  placements: PptxPlacement[],
  firstArticlePage: number
): void {
  const slide = ctx.pres.addSlide();
  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  const bleedIn = mm2in(ctx.geometry.bleed_mm);
  const trimWidthIn = mm2in(ctx.geometry.trim_mm[0]);
  const trimHeightIn = mm2in(ctx.geometry.trim_mm[1]);
  const marginLeft = mm2in(ctx.geometry.margins_mm.left) + bleedIn;
  const marginRight = mm2in(ctx.geometry.margins_mm.right) + bleedIn;
  const marginTop = mm2in(ctx.geometry.margins_mm.top) + bleedIn;
  const pageContentWidth =
    trimWidthIn - mm2in(ctx.geometry.margins_mm.left + ctx.geometry.margins_mm.right);

  // Section label
  slide.addText("INSIDE THIS ISSUE", {
    x: marginLeft,
    y: marginTop,
    w: pageContentWidth,
    h: pt2in(14),
    fontSize: 10,
    fontFace: "Inter",
    bold: true,
    color: "C96E4E",
    charSpacing: 6,
  });
  slide.addText("Contents", {
    x: marginLeft,
    y: marginTop + pt2in(20),
    w: pageContentWidth,
    h: pt2in(60),
    fontSize: 48,
    fontFace: "Fraunces",
    bold: true,
    color: "1A1A1A",
  });
  // Heavy rule under the title
  slide.addShape("line", {
    x: marginLeft,
    y: marginTop + pt2in(82),
    w: pageContentWidth,
    h: 0,
    line: { color: "1A1A1A", width: 1 },
  });

  // Compute starting pages: walk placements, accumulating their estimated
  // page count (template min for now).
  let cursor = firstArticlePage;
  const entries = placements.map((p) => {
    const startPage = cursor;
    const pages = p.article.prelaidPages?.length ?? p.template.page_count_range[0];
    cursor += pages;
    return { article: p.article, startPage, pages };
  });

  // Render each entry as: SECTION (rust caps) / Headline (Fraunces 16pt)
  // / "By Author" italic / .... pp. NN
  let y = marginTop + pt2in(110);
  const lineH = pt2in(48);
  for (const e of entries) {
    const sectionLabel = (e.article.section ?? "FEATURE").toUpperCase();
    slide.addText(sectionLabel, {
      x: marginLeft,
      y,
      w: pageContentWidth,
      h: pt2in(10),
      fontSize: 7,
      fontFace: "Inter",
      bold: true,
      color: "C96E4E",
      charSpacing: 4,
    });
    // Headline + page number on same row, with a leader line implied by
    // separate left/right text boxes.
    slide.addText(e.article.headline, {
      x: marginLeft,
      y: y + pt2in(12),
      w: pageContentWidth - pt2in(60),
      h: pt2in(22),
      fontSize: 16,
      fontFace: "Fraunces",
      bold: true,
      color: "1A1A1A",
    });
    slide.addText(`p. ${e.startPage}`, {
      x: trimWidthIn + bleedIn - marginRight - pt2in(60),
      y: y + pt2in(12),
      w: pt2in(60),
      h: pt2in(22),
      fontSize: 14,
      fontFace: "Fraunces",
      color: "1A1A1A",
      align: "right",
    });
    if (e.article.byline) {
      slide.addText(e.article.byline, {
        x: marginLeft,
        y: y + pt2in(34),
        w: pageContentWidth,
        h: pt2in(12),
        fontSize: 10,
        fontFace: "Inter",
        italic: true,
        color: "5C5853",
      });
    }
    y += lineH;
    if (y > trimHeightIn + bleedIn - mm2in(30)) break;
  }

  addPageFurniture(slide, ctx, "Contents");
}

function addPlacementSlides(
  pres: pptxgen,
  placement: PptxPlacement,
  warnings: string[],
  ctx?: BuildContext
): number {
  const { template, article } = placement;
  const geo = template.geometry;
  const typ = template.typography;

  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const pt2in = (pt: number): number => pt / PT_PER_INCH;

  const bleedIn = mm2in(geo.bleed_mm);
  const marginLeft = mm2in(geo.margins_mm.left) + bleedIn;
  const _marginRight = mm2in(geo.margins_mm.right) + bleedIn;
  const marginTop = mm2in(geo.margins_mm.top) + bleedIn;
  const marginBottom = mm2in(geo.margins_mm.bottom) + bleedIn;

  const trimWidthIn = mm2in(geo.trim_mm[0]);
  const trimHeightIn = mm2in(geo.trim_mm[1]);

  const pageContentWidth = trimWidthIn - mm2in(geo.margins_mm.left + geo.margins_mm.right);
  const pageContentHeight = trimHeightIn - mm2in(geo.margins_mm.top + geo.margins_mm.bottom);

  const columnCount = geo.columns;
  const gutterIn = mm2in(geo.gutter_mm);
  const columnWidth = (pageContentWidth - gutterIn * (columnCount - 1)) / columnCount;

  // Font-family selection: Mukta for pure Hindi, Fraunces for English body +
  // headlines. Bilingual uses Fraunces (better Latin) and relies on system
  // fallback for Devanagari glyphs — Phase 3 gate revisits this.
  const bodyFont = article.language === "hi" ? "Mukta" : "Fraunces";
  const displayFont = article.language === "hi" ? "Mukta" : "Fraunces";
  const sansFont = "Inter";

  // Estimate body capacity per page given font metrics.
  // Fraunces body_pt=10 with leading 14pt → chars-per-line ~ columnWidth/0.5em.
  const charsPerLine = Math.max(20, Math.floor((columnWidth * PT_PER_INCH) / (typ.body_pt * 0.52)));
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
    const pagesUsed = lastFilledColIdx < 0 ? 1 : Math.floor(lastFilledColIdx / columnCount) + 1;
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
      // Decide hero placement. Three options:
      //   below-headline — classic: headline → deck → byline → hero → body
      //   above-headline — image-led: hero → caption + credit → headline → body
      //   full-bleed     — image fills the entire trim edge-to-edge,
      //                    headline + deck + byline overlay the lower
      //                    third in white. Body starts on page 2.
      const heroPlacement = article.heroPlacement ?? "below-headline";

      // Full-bleed: the image fills the page and the headline overlays.
      // Body content goes to page 2 onwards (first body slot is empty).
      if (heroPlacement === "full-bleed" && article.heroImage) {
        slide.addImage({
          data: `data:${article.heroImage.mimeType};base64,${article.heroImage.base64}`,
          x: 0,
          y: 0,
          w: trimWidthIn + bleedIn * 2,
          h: trimHeightIn + bleedIn * 2,
          sizing: { type: "cover", w: trimWidthIn + bleedIn * 2, h: trimHeightIn + bleedIn * 2 },
        });
        // Dark scrim at bottom for text legibility
        slide.addShape("rect", {
          x: 0,
          y: bleedIn + trimHeightIn * 0.55,
          w: trimWidthIn + bleedIn * 2,
          h: trimHeightIn * 0.45 + bleedIn,
          fill: { color: "1A1A1A", transparency: 35 },
          line: { color: "1A1A1A", width: 0 },
        });
        // Section / caption (small white caps) above the headline
        if (article.section || article.heroCaption) {
          slide.addText((article.section ?? article.heroCaption ?? "").toUpperCase(), {
            x: marginLeft,
            y: bleedIn + trimHeightIn * 0.62,
            w: pageContentWidth,
            h: pt2in(14),
            fontSize: 9,
            fontFace: sansFont,
            color: "FEFCF8",
            charSpacing: 8,
            bold: true,
          });
        }
        // Headline — large white display centered horizontally on left margin
        const fbHeadlinePt = Math.max(typ.headline_pt, 56);
        slide.addText(article.headline, {
          x: marginLeft,
          y: bleedIn + trimHeightIn * 0.66,
          w: pageContentWidth,
          h: pt2in(fbHeadlinePt * 1.1 * 3),
          fontSize: fbHeadlinePt,
          fontFace: displayFont,
          bold: true,
          color: "FEFCF8",
          valign: "top",
        });
        // Optional deck under the headline
        if (article.deck) {
          slide.addText(article.deck, {
            x: marginLeft,
            y: bleedIn + trimHeightIn * 0.85,
            w: pageContentWidth,
            h: pt2in((typ.deck_pt ?? 16) * 1.4 * 2),
            fontSize: typ.deck_pt ?? 16,
            fontFace: sansFont,
            italic: true,
            color: "F5EFE7",
          });
        }
        // Photographer credit, vertical along the right edge in small caps
        if (article.heroCredit) {
          slide.addText(`Photograph: ${article.heroCredit}`, {
            x: marginLeft,
            y: bleedIn + trimHeightIn - pt2in(20),
            w: pageContentWidth,
            h: pt2in(12),
            fontSize: 7,
            fontFace: sansFont,
            color: "F5EFE7",
            italic: true,
            charSpacing: 2,
          });
        }
        // Byline (rust caps, white background overlap)
        if (article.byline && (article.bylinePosition ?? "top") === "top") {
          slide.addText(article.byline.toUpperCase(), {
            x: marginLeft,
            y: bleedIn + trimHeightIn * 0.93,
            w: pageContentWidth,
            h: pt2in(14),
            fontSize: 10,
            fontFace: sansFont,
            bold: true,
            color: "C96E4E",
            charSpacing: 3,
          });
        }
        // Page furniture suppressed on full-bleed (would conflict with image).
        if (ctx) {
          const pageCtx = { ...ctx, pageNumber: ctx.pageNumber + pageIdx };
          // Folio only, no header — header would overlay the image awkwardly.
          addPageFurniture(slide, pageCtx, null);
        }
        // Skip the rest of the first-page rendering — body starts page 2.
        bodyStartY = trimHeightIn + bleedIn; // signals "no body on this page"
        continue;
      }

      let cursorY = marginTop;

      const drawHeroBlock = (yStart: number): number => {
        if (!article.heroImage) return yStart;
        const aspect =
          article.heroImage.heightPx > 0
            ? article.heroImage.widthPx / article.heroImage.heightPx
            : 1;
        // Image-led variant uses a more dominant hero (up to 60% of page);
        // headline-led variant caps at ~280pt to leave body room.
        const heroMaxH =
          heroPlacement === "above-headline"
            ? pageContentHeight * 0.6
            : Math.min(
                pt2in(280),
                pageContentHeight - (yStart - marginTop) - pt2in(typ.body_pt * 18)
              );
        let heroW = pageContentWidth;
        let heroH = heroW / aspect;
        if (heroH > heroMaxH) {
          heroH = heroMaxH;
          heroW = heroH * aspect;
        }
        if (heroH < pt2in(60)) return yStart;
        const heroX = marginLeft + (pageContentWidth - heroW) / 2;
        slide.addImage({
          data: `data:${article.heroImage.mimeType};base64,${article.heroImage.base64}`,
          x: heroX,
          y: yStart,
          w: heroW,
          h: heroH,
        });
        let yAfter = yStart + heroH;
        // Caption + photographer credit (right-aligned italic credit, body
        // caption left). Both small, immediately under the image.
        if (article.heroCaption || article.heroCredit) {
          yAfter += pt2in(4);
          if (article.heroCaption) {
            slide.addText(article.heroCaption, {
              x: marginLeft,
              y: yAfter,
              w: pageContentWidth - pt2in(140),
              h: pt2in(14),
              fontSize: 8,
              fontFace: sansFont,
              color: "5C5853",
              italic: false,
              align: "left",
            });
          }
          if (article.heroCredit) {
            slide.addText(`Photograph: ${article.heroCredit}`, {
              x: marginLeft + pageContentWidth - pt2in(140),
              y: yAfter,
              w: pt2in(140),
              h: pt2in(14),
              fontSize: 7,
              fontFace: sansFont,
              color: "9B958E",
              italic: true,
              charSpacing: 2,
              align: "right",
            });
          }
          yAfter += pt2in(14);
          // Thin grey rule under the caption/credit row
          slide.addShape("line", {
            x: marginLeft,
            y: yAfter + pt2in(2),
            w: pageContentWidth,
            h: 0,
            line: { color: "E5DFD5", width: 0.5 },
          });
          yAfter += pt2in(6);
        } else {
          yAfter += pt2in(8);
        }
        return yAfter;
      };

      // Image-first: hero, then headline beneath
      if (heroPlacement === "above-headline" && article.heroImage) {
        cursorY = drawHeroBlock(cursorY);
      }

      // Headline — estimate visual line count from character width so
      // short headlines don't reserve excess space. Display fonts run
      // ~0.55em average, so chars-per-line ≈ pageContentWidth / (pt * 0.55).
      const headlineCharsPerLine = Math.max(
        8,
        Math.floor((pageContentWidth * PT_PER_INCH) / (typ.headline_pt * 0.55))
      );
      const headlineLines = Math.min(
        3,
        Math.max(1, Math.ceil(article.headline.length / headlineCharsPerLine))
      );
      const headlineHeight = pt2in(typ.headline_pt * 1.1 * headlineLines + 4);
      slide.addText(article.headline, {
        x: marginLeft,
        y: cursorY,
        w: pageContentWidth,
        h: headlineHeight,
        fontSize: typ.headline_pt,
        fontFace: displayFont,
        bold: true,
        color: "1A1A1A",
        valign: "top",
      });
      cursorY += headlineHeight + pt2in(2);

      // Deck (italic sans). Estimate from character width so short decks
      // don't push the byline 80pt down the page.
      if (article.deck) {
        const deckPt = typ.deck_pt ?? 16;
        const deckCharsPerLine = Math.max(
          16,
          Math.floor((pageContentWidth * PT_PER_INCH) / (deckPt * 0.5))
        );
        const deckLines = Math.min(
          4,
          Math.max(1, Math.ceil(article.deck.length / deckCharsPerLine))
        );
        const deckHeight = pt2in(deckPt * 1.3 * deckLines + 4);
        slide.addText(article.deck, {
          x: marginLeft,
          y: cursorY,
          w: pageContentWidth,
          h: deckHeight,
          fontSize: deckPt,
          fontFace: sansFont,
          italic: true,
          color: "5C5853",
          valign: "top",
        });
        cursorY += deckHeight + pt2in(2);
      }

      // Byline (small caps sans, rust) — only at top when position is "top".
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
        cursorY += pt2in(14) + pt2in(6);
      }

      // Headline-led: hero AFTER the byline (default)
      if (heroPlacement === "below-headline" && article.heroImage) {
        cursorY = drawHeroBlock(cursorY);
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
      // Print-style paragraphs: visible inter-paragraph gap (paraSpaceAfter
      // = 4pt — must match PARAGRAPH_GAP_PT in the prelayout for the
      // line-count math to agree to the point), plus a first-line indent
      // on every paragraph except the first in a column. PowerPoint
      // doesn't expose a first-line-indent knob in pptxgenjs, so we
      // prepend three non-breaking spaces (~1em).
      const INDENT = "\u00A0\u00A0\u00A0";
      const PARA_GAP_PT = 4;
      for (let col = 0; col < columnCount; col += 1) {
        const paragraphs = cols[col] ?? [];
        if (paragraphs.length === 0) continue;
        const colX = marginLeft + col * (columnWidth + gutterIn);
        // Indent every paragraph except the first in the column. The
        // continuation paragraph at the top of cols 2/3 also gets no
        // indent — it visually continues from col 1.
        const styled = paragraphs.map((p, i) => (i === 0 ? p : INDENT + p));
        slide.addText(styled.join("\n"), {
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
          paraSpaceAfter: PARA_GAP_PT,
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
          : (segments[pageIdx * columnCount + c] ?? "").length > 0;
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
    if (article.pullQuote && pageIdx === 1 && template.supports_pull_quote && columnCount >= 3) {
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

    // Page furniture: running header (publication | section | issue) +
    // folio. When ctx is provided we use the magazine-wide page number
    // and recto/verso pattern; otherwise fall back to centered folio
    // (legacy back-compat for tests that call buildPptx directly).
    if (ctx) {
      const pageCtx = { ...ctx, pageNumber: ctx.pageNumber + pageIdx };
      const section = (article.section ?? sectionForFamily(template.family)).toUpperCase();
      addPageFurniture(slide, pageCtx, section);
    } else {
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
  }

  return pagesNeeded;
}

function sectionForFamily(family: string): string {
  switch (family) {
    case "feature":
      return "Features";
    case "photo_essay":
      return "Photo Essay";
    case "interview":
      return "Interview";
    case "short_editorial":
      return "Editorial";
    case "opinion":
      return "Opinion";
    case "poetry":
      return "Poetry";
    default:
      return "Features";
  }
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
  if (body.length === 0 || capacities.length === 0) return capacities.map(() => "");

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
      while (end > cursor && !/\s/.test(body[end] ?? "") && !/\s/.test(body[end - 1] ?? "")) {
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
function _estimateCharsNeeded(body: string): number {
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
function addAdSlide(pres: pptxgen, ad: PptxAd, geo: Geometry, ctx?: BuildContext): void {
  const slide = pres.addSlide();
  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  const bleedIn = mm2in(geo.bleed_mm);
  const trimWidthIn = mm2in(geo.trim_mm[0]);
  const trimHeightIn = mm2in(geo.trim_mm[1]);

  // Cover-position ads (inside_front, inside_back, back_cover) are
  // full-bleed image-only — no folio, no header, no ADVERTISEMENT label.
  // Between-the-book ads get the ADVERTISEMENT label + folio so readers
  // know they're not editorial content.
  const isCoverPosition =
    ad.position === "inside_front" || ad.position === "inside_back" || ad.position === "back_cover";

  // Aspect-respecting cover for full-page slots: scale to fit the trim
  // box, center any overflow as a crop. (Stretching always looked off.)
  const aspect = ad.heightPx > 0 ? ad.widthPx / ad.heightPx : trimWidthIn / trimHeightIn;
  const slotW = trimWidthIn + bleedIn * 2;
  const slotH = trimHeightIn + bleedIn * 2;
  const slotAspect = slotW / slotH;
  let imgW: number;
  let imgH: number;
  if (aspect > slotAspect) {
    // Source is wider — fill height, crop sides
    imgH = slotH;
    imgW = slotH * aspect;
  } else {
    imgW = slotW;
    imgH = slotW / aspect;
  }
  const imgX = (slotW - imgW) / 2;
  const imgY = (slotH - imgH) / 2;
  slide.addImage({
    data: `data:${ad.mimeType};base64,${ad.base64}`,
    x: imgX,
    y: imgY,
    w: imgW,
    h: imgH,
  });

  if (!isCoverPosition) {
    // ADVERTISEMENT label tucked in the bleed margin
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
    // Folio for between-ads so the page sequence stays continuous
    if (ctx) {
      const marginRight = mm2in(geo.margins_mm.right) + bleedIn;
      const marginLeft = mm2in(geo.margins_mm.left) + bleedIn;
      const isRecto = ctx.pageNumber % 2 === 1;
      const folioY = bleedIn + trimHeightIn - mm2in(10);
      slide.addText(`${ctx.pageNumber}`, {
        x: isRecto ? trimWidthIn + bleedIn - marginRight - pt2in(60) : marginLeft,
        y: folioY,
        w: pt2in(60),
        h: pt2in(12),
        fontSize: 9,
        fontFace: "Inter",
        bold: true,
        color: "FEFCF8",
        align: isRecto ? "right" : "left",
      });
    }
  }
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
  startingPageNumber: number,
  ctx?: BuildContext
): number {
  void startingPageNumber; // page number now comes from ctx
  const mm2in = (mm: number): number => mm / MM_PER_INCH;
  const pt2in = (pt: number): number => pt / PT_PER_INCH;
  const bleedIn = mm2in(geo.bleed_mm);
  const marginLeft = mm2in(geo.margins_mm.left) + bleedIn;
  const _marginRight = mm2in(geo.margins_mm.right) + bleedIn;
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
  // Section opener gets a folio but no header (it IS the section start).
  if (ctx) {
    const openerCtx = { ...ctx, pageNumber: ctx.pageNumber };
    addPageFurniture(slide, openerCtx, null);
  } else {
    addFolio(slide, startingPageNumber + pageCount - 1, bleedIn, trimWidthIn, trimHeightIn);
  }

  // Content pages — start with first type. Keep a cursor per page.
  slide = pres.addSlide();
  pageCount += 1;
  // Furniture for first content page
  if (ctx) {
    const pageCtx = { ...ctx, pageNumber: ctx.pageNumber + pageCount - 1 };
    addPageFurniture(slide, pageCtx, "Classifieds");
  }
  let col = 0;
  let y = marginTop;
  const typeEntries = Array.from(grouped.entries());

  for (let t = 0; t < typeEntries.length; t += 1) {
    const [type, entries] = typeEntries[t]!;
    const label = CLASSIFIED_TYPE_LABELS[type] ?? type;

    // Approximate chars per visual line at 8pt body font in a column of
    // columnWidth inches. 8pt avg-char width ≈ 0.42em → 3.36pt → 0.047 in
    const charsPerLine = Math.max(18, Math.floor((columnWidth * PT_PER_INCH) / (8 * 0.5)));

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
      const entryHeight = estimateClassifiedHeight(entry, columnWidth, charsPerLine) + ENTRY_GAP;
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
          if (ctx) {
            const pageCtx = { ...ctx, pageNumber: ctx.pageNumber + pageCount - 1 };
            addPageFurniture(slide, pageCtx, "Classifieds");
          }
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
