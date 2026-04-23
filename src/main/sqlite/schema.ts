// Kysely type definitions for the Forme SQLite schema.
// Every table carries tenant_id per CEO plan §"Multi-tenant future" — hardcoded
// to 'publisher_default' in MVP. The FK-cascade-through-issue pattern means only
// issues need the column for now, but adding `tenant_id` to nested tables later
// is just a migration.

import type { Generated } from "kysely";

export interface IssuesTable {
  id: string; // UUID
  tenant_id: string;
  title: string;
  issue_number: number | null;
  issue_date: string; // ISO date
  page_size: "A4" | "A5";
  typography_pairing: string;
  primary_language: "en" | "hi" | "bilingual";
  bw_mode: 0 | 1; // 1 = black-and-white palette
  created_at: string; // ISO timestamp
  updated_at: string;
}

export interface ArticlesTable {
  id: string;
  issue_id: string;
  headline: string;
  deck: string | null;
  byline: string | null;
  byline_position: "top" | "end"; // most pieces: top; editorials/wire: end
  hero_placement: "below-headline" | "above-headline" | "full-bleed";
  hero_caption: string | null;
  hero_credit: string | null;
  section: string | null; // section override for the running header
  body: string; // full body text (plain, markdown, or serialized blocks)
  // v0.6 ER2: tracks body encoding. SQL default is 'plain' so existing v0.5
  // inserts compile unchanged; v0.6 code that creates new block-format
  // articles passes the value explicitly. Lazy migration to 'blocks' happens
  // on first open per ER2 task T5.
  body_format: Generated<"plain" | "markdown" | "blocks">;
  language: "en" | "hi" | "bilingual";
  word_count: number;
  content_type: string; // Article, Poem, Interview, Photo Essay, Opinion, Brief, Letter
  pull_quote: string | null;
  sidebar: string | null;
  // v0.6 T13: operator-controlled order. Fractional REAL so single-row
  // reorders are O(1). Defaulted via SQL so legacy inserts compile unchanged.
  display_position: Generated<number>;
  created_at: string;
  updated_at: string;
}

export interface ArticleImagesTable {
  article_id: string;
  blob_hash: string;
  position: number; // ordering within the article
  caption: string | null;
  role: "hero" | "inline" | "supporting";
}

export interface ImagesTable {
  blob_hash: string; // PRIMARY KEY; FK into blob store
  filename: string;
  mime_type: string;
  width: number;
  height: number;
  dpi: number;
  color_mode: "rgb" | "grayscale" | "cmyk-converted";
  size_bytes: number;
  imported_at: string;
  tags_json: string | null; // JSON array of strings
}

export interface PlacementsTable {
  id: string;
  issue_id: string;
  page_number: number; // starting page for this placement
  slot_index: number; // ordering on that page
  template_id: string; // reference to a JSON template file
  content_kind:
    | "article"
    | "classifieds"
    | "ad"
    | "cover"
    | "section-opener"
    | "toc"
    | "masthead"
    | "back-matter"
    | "ad-page";
  article_id: string | null;
  ad_id: string | null;
  exposed_settings_json: string; // JSON per template's exposed_settings contract
  created_at: string;
}

export interface ClassifiedsTable {
  id: string;
  issue_id: string | null; // null = floating in queue, not assigned to an issue
  type: string; // one of the 12 classified types
  language: "en" | "hi";
  weeks_to_run: number; // decrements each issue; 0 = expired
  photo_blob_hash: string | null;
  fields_json: string; // type-specific field set
  billing_reference: string | null;
  // v0.6 T13 — see ArticlesTable.display_position.
  display_position: Generated<number>;
  created_at: string;
  updated_at: string;
}

export interface AdsTable {
  id: string;
  issue_id: string | null;
  slot_type: string; // Full Page, DPS, HPH, etc.
  // v0.6 T15: deprecated free-text placement label. Kept for rollback
  // safety and the legacy export-path mapping in handlers/export.ts. New
  // writes still set it (derived from placement_kind) until a follow-up
  // migration drops the column.
  position_label: string; // Back Cover, Inside Front, Run of Book, etc.
  bw_flag: 0 | 1;
  kind: "commercial" | "house" | "sponsor_strip";
  creative_blob_hash: string;
  creative_filename: string;
  billing_reference: string | null;
  // v0.6 T13 — see ArticlesTable.display_position.
  display_position: Generated<number>;
  // v0.6 T15: structured placement. 'cover' = standalone page; 'between' =
  // runs after the linked article; 'bottom-of' = tucks under the linked
  // article. SQL default 'cover' so existing inserts compile unchanged.
  placement_kind: Generated<"cover" | "between" | "bottom-of">;
  // FK -> articles(id) ON DELETE SET NULL. Required when placement_kind is
  // 'between' or 'bottom-of'; NULL for 'cover' rows.
  placement_article_id: string | null;
  created_at: string;
}

export interface SnapshotsTable {
  id: string;
  issue_id: string;
  created_at: string;
  description: string; // auto-generated per CEO plan §17.2
  state_json: string; // serialized issue or article state
  size_bytes: number;
  is_full: 0 | 1; // 1 = full snapshot; 0 = delta (v1.1+)
  // v0.6 article-level snapshot fields (CEO plan decision 1A) — additive on the
  // existing issue-level snapshots table. Existing rows take entity_kind='issue'
  // via the column default; article_id is NULL for issue-level rows. Defaulted
  // columns use Generated<> so the existing issue-level inserts in
  // snapshot-store/store.ts compile unchanged.
  article_id: string | null; // FK -> articles(id) ON DELETE CASCADE; NULL for issue-level snapshots
  entity_kind: Generated<"issue" | "article">;
  label: string | null; // operator-named version, e.g. "first draft"
  starred: Generated<0 | 1>; // 1 = pinned by operator (excluded from auto-prune)
  diff_status: "fallback_full" | "delta_jsonpatch" | null; // future delta tracking; NULL until populated
  block_schema_version: Generated<number>; // ER2-9: bump when block JSON shape changes
}

export interface AppSettingsTable {
  key: string; // PRIMARY KEY; e.g. "banner.dismissed.v0_6_intro"
  value: string | null;
  updated_at: string;
}

export interface PublisherProfileTable {
  tenant_id: string; // PRIMARY KEY
  publication_name: string | null;
  masthead_blob_hash: string | null;
  accent_color: string | null; // PRINT-SIDE accent only per Pass 7D
  typography_pairing_default: string | null;
  primary_language_default: "en" | "hi" | "bilingual";
  page_size_default: "A4" | "A5";
  issue_cadence: "weekly" | "fortnightly" | "monthly" | null;
  printer_contact: string | null;
  printer_delivery_method: string | null;
  ad_position_labels_json: string | null;
  classifieds_billing_label: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  issues: IssuesTable;
  articles: ArticlesTable;
  article_images: ArticleImagesTable;
  images: ImagesTable;
  placements: PlacementsTable;
  classifieds: ClassifiedsTable;
  ads: AdsTable;
  snapshots: SnapshotsTable;
  publisher_profile: PublisherProfileTable;
  app_settings: AppSettingsTable;
}
