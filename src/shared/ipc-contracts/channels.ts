// IPC channel names + payload types, shared between main and renderer.
// Renderer calls window.forme.invoke("forme:dispatch", { channel, data })
// which routes to the registered handler on the main side.

import type { Language } from "@shared/schemas/language.js";
import type {
  ContentType,
  BylinePosition,
  HeroPlacement,
} from "@shared/schemas/article.js";
import type {
  ClassifiedType,
  FieldsFor,
} from "@shared/schemas/classified.js";
import type { AdSlotType } from "@shared/schemas/ad.js";

// ---- Issue ----

export interface CreateIssueInput {
  title: string;
  issueNumber: number | null;
  issueDate: string; // ISO date
  pageSize: "A4" | "A5";
  typographyPairing: string;
  primaryLanguage: Language;
  bwMode: boolean;
}

export interface IssueSummary {
  id: string;
  title: string;
  issueNumber: number | null;
  issueDate: string;
  pageSize: "A4" | "A5";
  typographyPairing: string;
  primaryLanguage: Language;
  bwMode: boolean;
  articleCount: number;
  classifiedCount: number;
  adCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Articles ----

export interface ImportDocxInput {
  issueId: string;
  /** Raw docx bytes as a base64 string so they can cross IPC. */
  base64: string;
  filename: string;
}

export interface ArticleSummary {
  id: string;
  issueId: string;
  headline: string;
  deck: string | null;
  byline: string | null;
  bylinePosition: BylinePosition;
  heroPlacement: HeroPlacement;
  heroCaption: string | null;
  heroCredit: string | null;
  section: string | null;
  language: Language;
  wordCount: number;
  contentType: ContentType;
  createdAt: string;
}

export interface UpdateArticleInput {
  id: string;
  headline?: string;
  deck?: string | null;
  byline?: string | null;
  bylinePosition?: BylinePosition;
  heroPlacement?: HeroPlacement;
  heroCaption?: string | null;
  heroCredit?: string | null;
  section?: string | null;
  contentType?: ContentType;
}

// ---- Classifieds ----

export interface AddClassifiedInput<T extends ClassifiedType = ClassifiedType> {
  issueId: string | null;
  type: T;
  language: "en" | "hi";
  weeksToRun: number;
  billingReference: string | null;
  fields: FieldsFor<T>;
}

export interface ClassifiedSummary {
  id: string;
  issueId: string | null;
  type: ClassifiedType;
  language: "en" | "hi";
  weeksToRun: number;
  displayName: string; // "Aanya Sharma, 28" or "Ram Prasad (obituary)"
  createdAt: string;
}

export interface ImportClassifiedsCsvInput {
  /** UTF-8 CSV string from a file read via the renderer's File API. */
  csv: string;
  issueId: string | null;
}

export interface ImportClassifiedsCsvResult {
  imported: number;
  /**
   * Rows that failed validation or parsing — each with 1-based row number
   * (excludes header) and a human-readable reason.
   */
  errors: Array<{ row: number; reason: string }>;
}

// ---- Ads ----

export interface UploadAdInput {
  issueId: string | null;
  slotType: AdSlotType;
  positionLabel: string;
  bwFlag: boolean;
  kind: "commercial" | "house" | "sponsor_strip";
  billingReference: string | null;
  /** File bytes as base64. */
  base64: string;
  filename: string;
  mimeType: string;
}

export interface AdSummary {
  id: string;
  issueId: string | null;
  slotType: AdSlotType;
  positionLabel: string;
  kind: "commercial" | "house" | "sponsor_strip";
  bwFlag: boolean;
  creativeFilename: string;
  blobHash: string;
  createdAt: string;
}

// ---- Publisher profile ----

export interface PublisherProfile {
  publicationName: string;
  accentColor: string | null;
  typographyPairingDefault: string;
  primaryLanguageDefault: Language;
  pageSizeDefault: "A4" | "A5";
  issueCadence: "weekly" | "fortnightly" | "monthly" | null;
  printerContact: string | null;
  classifiedsBillingLabel: string;
}

// ---- Export ----

export interface ExportIssueInput {
  issueId: string;
}

export interface ExportIssueResult {
  outputPath: string;
  bytes: number;
  pageCount: number;
  warnings: string[];
}

/**
 * Plan returned by export:fetch-data — the renderer takes this, runs
 * pretext-driven body line-breaking against the real browser canvas, then
 * sends back a fully-laid-out structure via export:render-prelaid. The plan
 * is the read-only snapshot of everything the export needs.
 */
export interface ExportPlan {
  issue: {
    id: string;
    title: string;
    issueNumber: number | null;
    issueDate: string;
    pageSize: "A4" | "A5";
    primaryLanguage: Language;
  };
  template: {
    id: string;
    /** mm */
    trim: [number, number];
    /** mm */
    bleedMm: number;
    margins: { top: number; right: number; bottom: number; left: number };
    columns: number;
    /** mm */
    gutterMm: number;
    typography: {
      headlinePt: number;
      deckPt: number;
      bodyPt: number;
      bodyLeadingPt: number;
    };
    pageCountRange: [number, number];
  };
  articles: Array<{
    id: string;
    headline: string;
    deck: string | null;
    byline: string | null;
    bylinePosition: "top" | "end";
    body: string;
    language: Language;
    /** Hero image as base64 + mime type, if one exists. */
    heroImage: {
      mimeType: string;
      base64: string;
      widthPx: number;
      heightPx: number;
    } | null;
  }>;
  ads: Array<{
    slotType: string;
    positionLabel: string;
    kind: "commercial" | "house" | "sponsor_strip";
    bwFlag: boolean;
    mimeType: string;
    base64: string;
    widthPx: number;
    heightPx: number;
  }>;
  classifieds: Array<{
    type: string;
    language: "en" | "hi";
    fields: Record<string, unknown>;
  }>;
}

/** What the renderer hands back: pre-broken article body lines per column. */
export interface RenderedExportPlan {
  issueId: string;
  /** [articleIdx][pageIdx][colIdx][lineIdx] = string */
  articleBodyLines: string[][][][];
}

// ---- Channel map ----
// Keep this in sync with the handlers in src/main/ipc/handlers/*.

export interface ChannelMap {
  ping: { request: unknown; response: { pong: true; t: number } };
  "issue:list": { request: null; response: IssueSummary[] };
  "issue:create": { request: CreateIssueInput; response: IssueSummary };
  "issue:get": { request: { id: string }; response: IssueSummary | null };

  "article:list": { request: { issueId: string }; response: ArticleSummary[] };
  "article:import-docx": { request: ImportDocxInput; response: ArticleSummary };
  "article:update": { request: UpdateArticleInput; response: ArticleSummary };

  "classified:list": {
    request: { issueId: string | null };
    response: ClassifiedSummary[];
  };
  "classified:add": { request: AddClassifiedInput; response: ClassifiedSummary };
  "classified:import-csv": {
    request: ImportClassifiedsCsvInput;
    response: ImportClassifiedsCsvResult;
  };

  "ad:list": { request: { issueId: string | null }; response: AdSummary[] };
  "ad:upload": { request: UploadAdInput; response: AdSummary };

  "publisher:get": { request: null; response: PublisherProfile | null };
  "publisher:save": { request: PublisherProfile; response: PublisherProfile };

  "export:pptx": { request: ExportIssueInput; response: ExportIssueResult };
  "export:fetch-plan": { request: ExportIssueInput; response: ExportPlan };
  "export:render-prelaid": {
    request: { plan: ExportPlan; rendered: RenderedExportPlan };
    response: ExportIssueResult;
  };
}

export type ChannelName = keyof ChannelMap;
