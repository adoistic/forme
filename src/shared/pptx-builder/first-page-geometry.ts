// First-page body geometry — single source of truth for both:
//   1. The PPTX builder (positions the body text container).
//   2. The pretext layout planner (decides how much body fits page 1).
//
// Before this helper, the layout reserved fixed worst-case heights for
// headline (3 lines) + deck (3 lines) but the builder rendered them at
// their actual line count. A 1-word headline like "कबीर" took 1 line in
// the rendered PPTX but the planner believed it took 3 — so the planner
// only flowed enough body for a 6.8" container while the builder created
// an 8.9" container. The 2.1" gap printed as visible whitespace at the
// bottom of every first-page column.
//
// All formulas here MUST match the corresponding rendering code in
// build.ts (look for the `// FIRST-PAGE GEOMETRY` markers). If you
// change one, change the other — that's why they live together now.

const PT_PER_INCH = 72;
const MM_PER_INCH = 25.4;

const mm2in = (mm: number): number => mm / MM_PER_INCH;
const pt2in = (pt: number): number => pt / PT_PER_INCH;

export interface FirstPageGeometryInput {
  headline: string;
  deck: string | null;
  hasTopByline: boolean;
  hasHero: boolean;
  heroPlacement: "below-headline" | "above-headline" | "full-bleed";
  trim_mm: [number, number];
  margins_mm: { top: number; right: number; bottom: number; left: number };
  typography: {
    headline_pt: number;
    deck_pt?: number;
  };
}

export interface FirstPageGeometry {
  /** Y offset of body start (relative to page top, in inches). */
  bodyStartYIn: number;
  /** Body container height in inches. */
  bodyHeightIn: number;
}

/**
 * Compute the actual first-page body container size based on rendered
 * headline + deck + byline + hero heights — NOT a fixed worst-case
 * reservation. The numbers below mirror the builder's per-element
 * layout in build.ts; keep them in lockstep.
 */
export function computeFirstPageGeometry(args: FirstPageGeometryInput): FirstPageGeometry {
  const trimWidthIn = mm2in(args.trim_mm[0]);
  const trimHeightIn = mm2in(args.trim_mm[1]);
  const marginTop = mm2in(args.margins_mm.top);
  const marginBottom = mm2in(args.margins_mm.bottom);
  const marginLeft = mm2in(args.margins_mm.left);
  const marginRight = mm2in(args.margins_mm.right);
  const pageContentWidth = trimWidthIn - marginLeft - marginRight;

  // Full-bleed: hero fills the page; body skips to page 2.
  if (args.heroPlacement === "full-bleed" && args.hasHero) {
    return { bodyStartYIn: marginTop, bodyHeightIn: 0 };
  }

  let cursorY = marginTop;

  // Above-headline hero is drawn first (image-led layout). Approximate
  // at 60% of page content height, matching the builder cap.
  if (args.hasHero && args.heroPlacement === "above-headline") {
    const pageContentHeight = trimHeightIn - marginTop - marginBottom;
    const heroH = pageContentHeight * 0.6;
    cursorY += heroH + pt2in(14) + pt2in(8); // image + caption row + spacing
  }

  // Headline — character-width line estimate matches build.ts.
  const headlinePt = args.typography.headline_pt;
  const headlineCharsPerLine = Math.max(
    8,
    Math.floor((pageContentWidth * PT_PER_INCH) / (headlinePt * 0.55))
  );
  const headlineLines = Math.min(
    3,
    Math.max(1, Math.ceil(args.headline.length / headlineCharsPerLine))
  );
  const headlineHeight = pt2in(headlinePt * 1.1 * headlineLines + 4);
  cursorY += headlineHeight + pt2in(2);

  // Deck (italic sans) — same character-width estimate.
  if (args.deck && args.deck.length > 0) {
    const deckPt = args.typography.deck_pt ?? 16;
    const deckCharsPerLine = Math.max(
      16,
      Math.floor((pageContentWidth * PT_PER_INCH) / (deckPt * 0.5))
    );
    const deckLines = Math.min(4, Math.max(1, Math.ceil(args.deck.length / deckCharsPerLine)));
    const deckHeight = pt2in(deckPt * 1.3 * deckLines + 4);
    cursorY += deckHeight + pt2in(2);
  }

  // Byline (top position) — fixed 14pt + 6pt spacing.
  if (args.hasTopByline) {
    cursorY += pt2in(14) + pt2in(6);
  }

  // Below-headline hero — capped at 280pt to leave body room.
  if (args.hasHero && args.heroPlacement === "below-headline") {
    cursorY += pt2in(280) + pt2in(20); // hero block + caption row
  }

  const bodyHeightIn = Math.max(0, trimHeightIn - marginBottom - cursorY);
  return { bodyStartYIn: cursorY, bodyHeightIn };
}
