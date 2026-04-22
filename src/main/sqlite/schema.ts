// Kysely type definitions for the Forme SQLite schema.
// Every table carries tenant_id per CEO plan §"Multi-tenant future" — hardcoded
// to 'publisher_default' in MVP. The FK-cascade-through-issue pattern means only
// issues need the column for now, but adding `tenant_id` to nested tables later
// is just a migration.

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
  body: string; // full body text (plain or markdown)
  language: "en" | "hi" | "bilingual";
  word_count: number;
  content_type: string; // Article, Poem, Interview, Photo Essay, Opinion, Brief, Letter
  pull_quote: string | null;
  sidebar: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface AdsTable {
  id: string;
  issue_id: string | null;
  slot_type: string; // Full Page, DPS, HPH, etc.
  position_label: string; // Back Cover, Inside Front, Run of Book, etc.
  bw_flag: 0 | 1;
  kind: "commercial" | "house" | "sponsor_strip";
  creative_blob_hash: string;
  creative_filename: string;
  billing_reference: string | null;
  created_at: string;
}

export interface SnapshotsTable {
  id: string;
  issue_id: string;
  created_at: string;
  description: string; // auto-generated per CEO plan §17.2
  state_json: string; // serialized issue state
  size_bytes: number;
  is_full: 0 | 1; // 1 = full snapshot; 0 = delta (v1.1+)
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
}
