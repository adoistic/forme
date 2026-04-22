import type { Template } from "@shared/schemas/template.js";

// PPTX builder input shape. The renderer flattens an Article + placements
// into this before handing off to the utility process. Keeping a stable
// contract here means the utility process stays dumb — it just turns
// structured data into bytes.

export interface PptxBuildInput {
  issueTitle: string;
  issueNumber: number | null;
  issueDate: string;
  /** Slide-level metadata for the master slide */
  publicationName: string;
  /** List of placed articles with their template + optional image. */
  placements: PptxPlacement[];
  /** Full-page + half-page ad creatives. */
  ads?: PptxAd[];
  /** Classifieds grouped-by-type and rendered in a trailing section. */
  classifieds?: PptxClassified[];
  /**
   * Page geometry for the non-article sections (ads, classifieds). The
   * article sections get geometry from their own template. Defaults to
   * the first placement's template if omitted.
   */
  fallbackGeometry?: {
    trim_mm: [number, number];
    bleed_mm: number;
    margins_mm: { top: number; right: number; bottom: number; left: number };
  };
  /** Optional cover image used on the cover page. */
  coverImage?: PptxImage;
  /** Cover-line teasers — usually article headlines, shown on the cover. */
  coverLines?: string[];
  /**
   * Whether to emit a cover page + table of contents at the front. Default
   * true. Set false for previews or when the host wants raw article pages.
   */
  emitFrontMatter?: boolean;
}

export interface PptxAd {
  /** Slot type string — drives aspect-ratio + placement strategy. */
  slotType: string;
  positionLabel: string;
  kind: "commercial" | "house" | "sponsor_strip";
  bwFlag: boolean;
  mimeType: string;
  base64: string;
  /** Natural pixel dimensions (used for aspect-ratio sanity). */
  widthPx: number;
  heightPx: number;
}

export interface PptxClassified {
  /** One of the 12 classified types from the schema. */
  type: string;
  language: "en" | "hi";
  /** Rendered display title (e.g. "Aanya Sharma, 28"). */
  displayName: string;
  /** Body lines already formatted for print (paragraphs + phone numbers). */
  bodyLines: string[];
  /** Optional photo for matrimonial_with_photo. */
  photoBase64?: string;
  photoMimeType?: string;
}

export interface PptxPlacement {
  articleId: string;
  template: Template;
  article: PptxArticle;
  startingPageNumber: number;
}

export interface PptxArticle {
  headline: string;
  deck: string | null;
  byline: string | null;
  /** Where the byline prints: under the deck ("top") or after the body ("end"). */
  bylinePosition?: "top" | "end";
  /** Section label shown in the running header ("FEATURES", "ESSAY"…). */
  section?: string;
  body: string;
  language: "en" | "hi" | "bilingual";
  /** Optional hero image bytes + mime type. */
  heroImage?: PptxImage;
  /** Caption shown under the hero image — usually a one-line description. */
  heroCaption?: string;
  /** Photographer credit shown in small italic next to the caption. */
  heroCredit?: string;
  /**
   * Hero placement: "below-headline" (default — hero sits between byline
   * and body) or "above-headline" (hero is the page-1 dominant element,
   * full-width across all columns, headline + deck + byline come BELOW
   * the image). Image-led photo essays use "above-headline".
   */
  heroPlacement?: "below-headline" | "above-headline";
  pullQuote?: string;
  /**
   * Pre-broken body lines per page per column, usually produced upstream
   * via @chenglou/pretext + Skia/canvas measurement. When present, the
   * builder emits each line as its own paragraph (so PowerPoint's text
   * engine cannot re-wrap and overflow the column box). When absent,
   * the builder falls back to its older heuristic.
   */
  prelaidPages?: string[][][];
}

export interface PptxImage {
  mimeType: string;
  /** Base64-encoded image bytes (what pptxgenjs wants). */
  base64: string;
  /** Natural width/height for layout decisions. */
  widthPx: number;
  heightPx: number;
}

/** Output: absolute path where the PPTX was written. */
export interface PptxBuildResult {
  outputPath: string;
  bytes: number;
  pageCount: number;
  /** Warnings that didn't block the build. */
  warnings: string[];
}
