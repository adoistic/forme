import type { Kysely } from "kysely";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { computeDiskUsage } from "../../disk-usage-events.js";
import type { StorageOverview, ArticleStorageRow } from "@shared/ipc-contracts/channels.js";
import type { Database } from "../../sqlite/schema.js";
import type { SnapshotStore } from "../../snapshot-store/store.js";

// Settings → Storage panel handlers (T12 / v0.6).
// Overview reuses computeDiskUsage and adds a blob-by-kind breakdown by
// joining the images table to its three known owners (article hero rows,
// ad creatives, classified photos). Anything not attributable falls into
// the "other" bucket — typically inline article images.
//
// Per-article join lists every article with snapshot bytes/count (from the
// snapshots table filtered to entity_kind='article') and blob bytes (from
// images joined via article_images, summed across the article's distinct
// blobs). Articles with no snapshots and no blobs are still returned with
// zeros so the operator sees their full inventory.

export interface StorageHandlerDeps {
  db: Kysely<Database>;
  snapshots: SnapshotStore;
}

export async function storageOverview(deps: StorageHandlerDeps): Promise<StorageOverview> {
  const { snapshots, blobs, total } = await computeDiskUsage(deps.db, deps.snapshots);

  // Hero blob bytes: images referenced by article_images with role='hero'.
  // Use DISTINCT so an image used as hero in two articles still counts once
  // toward the on-disk total (blobs are content-addressed).
  const heroRow = await deps.db
    .selectFrom("images")
    .innerJoin("article_images", "article_images.blob_hash", "images.blob_hash")
    .where("article_images.role", "=", "hero")
    .select((eb) => eb.fn.sum<number>("images.size_bytes").distinct().as("total"))
    .executeTakeFirst();

  const adRow = await deps.db
    .selectFrom("images")
    .innerJoin("ads", "ads.creative_blob_hash", "images.blob_hash")
    .select((eb) => eb.fn.sum<number>("images.size_bytes").distinct().as("total"))
    .executeTakeFirst();

  const classifiedsRow = await deps.db
    .selectFrom("images")
    .innerJoin("classifieds", "classifieds.photo_blob_hash", "images.blob_hash")
    .select((eb) => eb.fn.sum<number>("images.size_bytes").distinct().as("total"))
    .executeTakeFirst();

  const hero = Number(heroRow?.total ?? 0);
  const ad = Number(adRow?.total ?? 0);
  const classifieds = Number(classifiedsRow?.total ?? 0);
  // "other" = remaining blob bytes not attributed to a known owner. Clamp
  // to >= 0 — overlapping ownership (an image used as both ad and hero) can
  // theoretically push the sum above `blobs`.
  const other = Math.max(0, blobs - hero - ad - classifieds);

  return {
    total,
    snapshots,
    blobs,
    blobsByKind: { hero, ad, classifieds, other },
  };
}

export async function storagePerArticle(
  deps: StorageHandlerDeps,
  payload: { issueId?: string }
): Promise<ArticleStorageRow[]> {
  // Pull every article (optionally filtered by issue), then left-join the
  // aggregates. Doing the aggregate sums in two separate queries and
  // merging in JS keeps the SQL readable and dialect-portable.
  let articlesQuery = deps.db.selectFrom("articles").select(["id", "issue_id", "headline"]);
  if (payload.issueId) {
    articlesQuery = articlesQuery.where("issue_id", "=", payload.issueId);
  }
  const articles = await articlesQuery.execute();

  // Snapshot aggregates (entity_kind='article' only — issue snapshots aren't
  // tied to a single article so they go in the overview total instead).
  const snapshotAggs = await deps.db
    .selectFrom("snapshots")
    .where("entity_kind", "=", "article")
    .where("article_id", "is not", null)
    .select((eb) => [
      "article_id",
      eb.fn.sum<number>("size_bytes").as("bytes"),
      eb.fn.countAll<number>().as("count"),
    ])
    .groupBy("article_id")
    .execute();

  const snapByArticle = new Map<string, { bytes: number; count: number }>();
  for (const row of snapshotAggs) {
    if (!row.article_id) continue;
    snapByArticle.set(row.article_id, {
      bytes: Number(row.bytes ?? 0),
      count: Number(row.count ?? 0),
    });
  }

  // Blob aggregates — sum size_bytes from images joined through
  // article_images. DISTINCT on blob_hash so an image referenced twice in
  // the same article still counts once toward that article's total.
  const blobAggs = await deps.db
    .selectFrom("article_images")
    .innerJoin("images", "images.blob_hash", "article_images.blob_hash")
    .select((eb) => [
      "article_images.article_id as article_id",
      eb.fn.sum<number>("images.size_bytes").distinct().as("bytes"),
    ])
    .groupBy("article_images.article_id")
    .execute();

  const blobByArticle = new Map<string, number>();
  for (const row of blobAggs) {
    blobByArticle.set(row.article_id, Number(row.bytes ?? 0));
  }

  return articles.map((a) => {
    const snap = snapByArticle.get(a.id) ?? { bytes: 0, count: 0 };
    const blobBytes = blobByArticle.get(a.id) ?? 0;
    return {
      articleId: a.id,
      issueId: a.issue_id,
      headline: a.headline,
      snapshotBytes: snap.bytes,
      snapshotCount: snap.count,
      blobBytes,
      totalBytes: snap.bytes + blobBytes,
    };
  });
}

export function registerStorageHandlers(): void {
  addHandler("storage:overview", async () => {
    const { db, snapshots } = getState();
    return storageOverview({ db, snapshots });
  });

  addHandler("storage:per-article", async (payload: { issueId?: string }) => {
    const { db, snapshots } = getState();
    return storagePerArticle({ db, snapshots }, payload ?? {});
  });
}
