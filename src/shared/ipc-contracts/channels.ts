// IPC channel names + payload types, shared between main and renderer.
// Renderer calls window.forme.invoke("forme:dispatch", { channel, data })
// which routes to the registered handler on the main side.

import type { Language } from "@shared/schemas/language.js";
import type { ContentType, BylinePosition, HeroPlacement } from "@shared/schemas/article.js";
import type { ClassifiedType, FieldsFor } from "@shared/schemas/classified.js";
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

/**
 * Create an article straight from operator-supplied text — covers both the
 * "paste markdown / rich text into the in-app editor" flow and the
 * "import a .md / .txt file" flow. The body is already plain text with
 * paragraph breaks (\n\n).
 */
export interface CreateArticleInput {
  issueId: string;
  headline: string;
  body: string;
  deck?: string | null;
  byline?: string | null;
  contentType?: ContentType;
  language?: Language;
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
  /** The article body — plain text, markdown source, or BlockNote JSON. */
  body: string;
  /** Encoding of `body`. v0.5 articles default to "plain"; v0.6 block edits use "blocks". */
  bodyFormat: "plain" | "markdown" | "blocks";
  /**
   * Set on responses from `article:update` when the body saved but the
   * accompanying snapshot write failed (CEO plan decision 2A). The renderer
   * surfaces this as a non-blocking warning toast.
   */
  snapshotWarning?: string;
  /**
   * Set on responses from `article:open-for-edit` when the lazy v0.5→v0.6
   * BlockNote migration failed (CEO plan §9A "fallback marker persisted"
   * path). The renderer surfaces this so the operator knows they're in
   * plain-text fallback. Editing is NOT blocked.
   */
  migrationWarning?: string;
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
  /** Article body content. When provided, the body and a snapshot are saved. */
  body?: string;
  /** Encoding of `body`. Required when `body` is provided. */
  bodyFormat?: "plain" | "markdown" | "blocks";
}

// ---- Snapshots (v0.6 article edit history) ----

export interface ArticleSnapshotSummary {
  id: string;
  articleId: string;
  createdAt: string;
  label: string | null;
  starred: boolean;
  sizeBytes: number;
  blockSchemaVersion: number;
}

export interface ArticleSnapshotBody {
  articleId: string;
  body: string;
  createdAt: string;
  label: string | null;
  starred: boolean;
}

export interface DiskUsageSnapshot {
  snapshots: number;
  blobs: number;
  total: number;
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
  "article:create": { request: CreateArticleInput; response: ArticleSummary };
  "article:update": { request: UpdateArticleInput; response: ArticleSummary };
  "article:delete": { request: { id: string }; response: { id: string; deleted: true } };
  "article:open-for-edit": { request: { id: string }; response: ArticleSummary };

  "snapshot:list": {
    request: { articleId: string; limit?: number };
    response: ArticleSnapshotSummary[];
  };
  "snapshot:read": { request: { snapshotId: string }; response: ArticleSnapshotBody };
  "snapshot:restore": { request: { snapshotId: string }; response: ArticleSummary };
  "snapshot:delete": {
    request: { snapshotId: string };
    response: { snapshotId: string; deleted: true };
  };
  "snapshot:label": {
    request: { snapshotId: string; label: string | null };
    response: ArticleSnapshotSummary;
  };
  "snapshot:star": {
    request: { snapshotId: string; starred: boolean };
    response: ArticleSnapshotSummary;
  };
  "snapshot:totalBytes": { request: Record<string, never>; response: DiskUsageSnapshot };

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
