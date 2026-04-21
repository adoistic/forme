// IPC channel names + payload types, shared between main and renderer.
// Renderer calls window.forme.invoke("forme:dispatch", { channel, data })
// which routes to the registered handler on the main side.

import type { Language } from "@shared/schemas/language.js";
import type { ContentType, BylinePosition } from "@shared/schemas/article.js";
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

  "ad:list": { request: { issueId: string | null }; response: AdSummary[] };
  "ad:upload": { request: UploadAdInput; response: AdSummary };

  "publisher:get": { request: null; response: PublisherProfile | null };
  "publisher:save": { request: PublisherProfile; response: PublisherProfile };

  "export:pptx": { request: ExportIssueInput; response: ExportIssueResult };
}

export type ChannelName = keyof ChannelMap;
