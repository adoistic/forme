// Serialized issue-state shape that lives inside each snapshot's state_json.
// Per CEO plan Section 17 — snapshots are content-addressable (JSON + blob refs).

export interface SerializedIssue {
  id: string;
  title: string;
  issue_number: number | null;
  issue_date: string;
  page_size: "A4" | "A5";
  typography_pairing: string;
  primary_language: "en" | "hi" | "bilingual";
  bw_mode: boolean;
  articles: SerializedArticle[];
  classifieds: SerializedClassified[];
  ads: SerializedAd[];
  placements: SerializedPlacement[];
  updated_at: string;
}

export interface SerializedArticle {
  id: string;
  headline: string;
  language: "en" | "hi" | "bilingual";
  word_count: number;
  content_type: string;
}

export interface SerializedClassified {
  id: string;
  type: string;
  language: "en" | "hi";
  weeks_to_run: number;
}

export interface SerializedAd {
  id: string;
  slot_type: string;
  position_label: string;
  creative_filename: string;
}

export interface SerializedPlacement {
  id: string;
  page_number: number;
  slot_index: number;
  template_id: string;
  content_kind: string;
  article_id: string | null;
  ad_id: string | null;
}
