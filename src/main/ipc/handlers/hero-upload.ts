import type { Kysely } from "kysely";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { ingestImage } from "../../image-ingest/ingest.js";
import { safeFetchUrl } from "../../url-fetch/ssrf-guard.js";
import { makeError } from "@shared/errors/structured.js";
import { emitDiskUsageChanged } from "../../disk-usage-events.js";
import type { ArticleSummary } from "@shared/ipc-contracts/channels.js";
import type { ContentType, BylinePosition, HeroPlacement } from "@shared/schemas/article.js";
import type { Database } from "../../sqlite/schema.js";
import type { BlobStore } from "../../blob-store/store.js";
import type { SnapshotStore } from "../../snapshot-store/store.js";

// Hero image upload (v0.6 T14). Three operator paths converge here: file
// picker, drag-drop, and URL paste. The renderer hands us bytes (or a URL
// the main process fetches under the SSRF guard) — we run them through the
// existing ingestImage pipeline, write to the blob store, register the
// images row, and link to the article as role='hero'. Replacing an existing
// hero deletes the previous join row but leaves the image blob intact (it
// may be referenced elsewhere; GC is a separate v1.1+ concern).

export interface HeroUploadHandlerDeps {
  db: Kysely<Database>;
  blobs: BlobStore;
  snapshots: SnapshotStore;
}

export interface UploadHeroFileInput {
  articleId: string;
  base64: string;
  filename: string;
}

export interface UploadHeroUrlInput {
  articleId: string;
  url: string;
}

function nowISO(): string {
  return new Date().toISOString();
}

function normalizeHeroPlacement(s: string | null | undefined): HeroPlacement {
  if (s === "above-headline" || s === "full-bleed") return s;
  return "below-headline";
}

function normalizeBodyFormat(s: string | null | undefined): "plain" | "markdown" | "blocks" {
  if (s === "markdown" || s === "blocks") return s;
  return "plain";
}

const SUMMARY_COLUMNS = [
  "id",
  "issue_id",
  "headline",
  "deck",
  "byline",
  "byline_position",
  "hero_placement",
  "hero_caption",
  "hero_credit",
  "section",
  "language",
  "word_count",
  "content_type",
  "created_at",
  "body",
  "body_format",
] as const;

async function loadArticleSummary(
  db: Kysely<Database>,
  articleId: string
): Promise<ArticleSummary> {
  const row = await db
    .selectFrom("articles")
    .select([...SUMMARY_COLUMNS])
    .where("id", "=", articleId)
    .executeTakeFirst();
  if (!row) {
    throw makeError("not_found", "error", { resource: "article", id: articleId });
  }
  return {
    id: row.id,
    issueId: row.issue_id,
    headline: row.headline,
    deck: row.deck,
    byline: row.byline,
    bylinePosition: (row.byline_position === "end" ? "end" : "top") as BylinePosition,
    heroPlacement: normalizeHeroPlacement(row.hero_placement),
    heroCaption: row.hero_caption,
    heroCredit: row.hero_credit,
    section: row.section,
    language: row.language as ArticleSummary["language"],
    wordCount: row.word_count,
    contentType: row.content_type as ContentType,
    createdAt: row.created_at,
    body: row.body,
    bodyFormat: normalizeBodyFormat(row.body_format),
  };
}

/**
 * Common path once we have ingested bytes: write to blob store, upsert the
 * images row, replace the article's hero join row. Returns the updated
 * ArticleSummary so both `upload-file` and `upload-url` can return it
 * without a second round-trip through the renderer.
 */
async function attachHero(
  deps: HeroUploadHandlerDeps,
  articleId: string,
  filename: string,
  bytes: Buffer
): Promise<ArticleSummary> {
  const { db, blobs, snapshots } = deps;

  // Verify the article exists BEFORE we ingest (cheap reject). The summary
  // load at the end re-checks anyway; this saves a sharp invocation when
  // the operator is uploading against a stale article id.
  const articleExists = await db
    .selectFrom("articles")
    .select("id")
    .where("id", "=", articleId)
    .executeTakeFirst();
  if (!articleExists) {
    throw makeError("not_found", "error", { resource: "article", id: articleId });
  }

  const ingested = await ingestImage({ filename, buffer: bytes });
  const hash = await blobs.writeBuffer(ingested.bytes);

  await db
    .insertInto("images")
    .values({
      blob_hash: hash,
      filename,
      mime_type: ingested.mimeType,
      width: ingested.width,
      height: ingested.height,
      dpi: ingested.dpi,
      color_mode: ingested.color_mode,
      size_bytes: ingested.size_bytes,
      imported_at: nowISO(),
      tags_json: JSON.stringify(["hero"]),
    })
    .onConflict((oc) => oc.column("blob_hash").doNothing())
    .execute();

  // Replace any existing hero. The composite PK is (article_id, blob_hash,
  // position) so two heros for the same article would conflict on (article_id,
  // role) only logically — we enforce single-hero by deleting first.
  await db
    .deleteFrom("article_images")
    .where("article_id", "=", articleId)
    .where("role", "=", "hero")
    .execute();

  await db
    .insertInto("article_images")
    .values({
      article_id: articleId,
      blob_hash: hash,
      position: 0,
      caption: null,
      role: "hero",
    })
    .onConflict((oc) => oc.columns(["article_id", "blob_hash", "position"]).doNothing())
    .execute();

  await emitDiskUsageChanged({ db, snapshotStore: snapshots });
  return loadArticleSummary(db, articleId);
}

export async function uploadHeroFile(
  deps: HeroUploadHandlerDeps,
  payload: UploadHeroFileInput
): Promise<ArticleSummary> {
  const buf = Buffer.from(payload.base64, "base64");
  return attachHero(deps, payload.articleId, payload.filename, buf);
}

export async function uploadHeroUrl(
  deps: HeroUploadHandlerDeps,
  payload: UploadHeroUrlInput,
  fetcher: typeof safeFetchUrl = safeFetchUrl
): Promise<ArticleSummary> {
  const fetched = await fetcher(payload.url);
  return attachHero(deps, payload.articleId, fetched.filename, fetched.bytes);
}

export function registerHeroUploadHandlers(): void {
  addHandler("hero:upload-file", async (payload: UploadHeroFileInput) => {
    const { db, blobs, snapshots } = getState();
    return uploadHeroFile({ db, blobs, snapshots }, payload);
  });

  addHandler("hero:upload-url", async (payload: UploadHeroUrlInput) => {
    const { db, blobs, snapshots } = getState();
    return uploadHeroUrl({ db, blobs, snapshots }, payload);
  });
}
