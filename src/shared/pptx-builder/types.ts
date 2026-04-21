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
