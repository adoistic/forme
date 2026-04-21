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
  body: string;
  language: "en" | "hi" | "bilingual";
  /** Optional hero image bytes + mime type. */
  heroImage?: PptxImage;
  pullQuote?: string;
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
