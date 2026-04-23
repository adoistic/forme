import type { Kysely } from "kysely";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { makeError } from "@shared/errors/structured.js";
import { emitDiskUsageChanged, computeDiskUsage } from "../../disk-usage-events.js";
import type {
  ArticleSnapshotSummary,
  ArticleSnapshotBody,
  ArticleSummary,
  DiskUsageSnapshot,
  IssueSnapshotSummary,
  IssueSnapshotPreview,
} from "@shared/ipc-contracts/channels.js";
import type { ContentType, BylinePosition, HeroPlacement } from "@shared/schemas/article.js";
import { countWords } from "@shared/schemas/article.js";
import type { Database } from "../../sqlite/schema.js";
import { createSnapshotStore, type SnapshotStore } from "../../snapshot-store/store.js";

// v0.6 article edit history (CEO plan 1A/1B + ER2 T4).
// Snapshot mutations all flow through here so the disk-usage-changed event
// fires from a single place. Restore is APPEND-ONLY and TRANSACTIONAL: it
// writes a "before-restore" snapshot, updates articles.body, then writes an
// "after-restore" snapshot — all inside a single SQLite transaction.
//
// Each handler delegates to a small exported function so tests can drive
// them with an in-memory DB without spinning up app-state / electron.

export interface SnapshotHandlerDeps {
  db: Kysely<Database>;
  snapshots: SnapshotStore;
  /**
   * Factory used inside `restoreSnapshot` to build a tx-bound snapshot store
   * so before/after-restore writes participate in the same SQLite
   * transaction as the body update. Defaulted to `createSnapshotStore` so
   * production callers don't need to supply it; tests inject a stub when
   * they want to verify rollback.
   */
  createSnapshotStore?: (db: Kysely<Database>) => SnapshotStore;
}

function summaryFromRecord(rec: {
  id: string;
  article_id: string;
  created_at: string;
  label: string | null;
  starred: boolean;
  size_bytes: number;
  block_schema_version: number;
}): ArticleSnapshotSummary {
  return {
    id: rec.id,
    articleId: rec.article_id,
    createdAt: rec.created_at,
    label: rec.label,
    starred: rec.starred,
    sizeBytes: rec.size_bytes,
    blockSchemaVersion: rec.block_schema_version,
  };
}

function normalizeHeroPlacement(s: string | null | undefined): HeroPlacement {
  if (s === "above-headline" || s === "full-bleed") return s;
  return "below-headline";
}

function normalizeBodyFormat(s: string | null | undefined): "plain" | "markdown" | "blocks" {
  if (s === "markdown" || s === "blocks") return s;
  return "plain";
}

export async function listSnapshots(
  deps: SnapshotHandlerDeps,
  payload: { articleId: string; limit?: number }
): Promise<ArticleSnapshotSummary[]> {
  const rows = await deps.snapshots.listArticleSnapshots(payload.articleId, payload.limit);
  return rows.map(summaryFromRecord);
}

export async function readSnapshot(
  deps: SnapshotHandlerDeps,
  payload: { snapshotId: string }
): Promise<ArticleSnapshotBody> {
  return deps.snapshots.readArticleSnapshot(payload.snapshotId);
}

export async function restoreSnapshot(
  deps: SnapshotHandlerDeps,
  payload: { snapshotId: string }
): Promise<ArticleSummary> {
  // Read the snapshot body OUTSIDE the transaction first so we get a
  // snapshot_stale error (mapped from snapshot_corrupt-on-not-found) before
  // opening the write transaction.
  let restored: Awaited<ReturnType<SnapshotStore["readArticleSnapshot"]>>;
  try {
    restored = await deps.snapshots.readArticleSnapshot(payload.snapshotId);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? (err as { code: string }).code : null;
    if (code === "snapshot_corrupt") {
      throw makeError("snapshot_stale", "error", { snapshotId: payload.snapshotId });
    }
    throw err;
  }

  // Single transaction: write before-snapshot → update body → write
  // after-snapshot. The before/after snapshot writes use a tx-bound store
  // so they participate in the same SQLite transaction as the body update;
  // any failure rolls back the entire restore so the renderer never sees a
  // partial state.
  const factory = deps.createSnapshotStore ?? createSnapshotStore;
  const txResult = await deps.db.transaction().execute(async (trx) => {
    const txSnapshots = factory(trx as unknown as Kysely<Database>);
    const article = await trx
      .selectFrom("articles")
      .select(["id", "body", "body_format"])
      .where("id", "=", restored.articleId)
      .executeTakeFirst();
    if (!article) {
      throw makeError("not_found", "error", {
        resource: "article",
        id: restored.articleId,
      });
    }

    await txSnapshots.saveArticleSnapshot(restored.articleId, article.body, {
      label: "before-restore",
    });

    await trx
      .updateTable("articles")
      .set({
        body: restored.body,
        body_format: "blocks",
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", restored.articleId)
      .execute();

    await txSnapshots.saveArticleSnapshot(restored.articleId, restored.body, {
      label: `restored from ${restored.createdAt}`,
    });

    const updated = await trx
      .selectFrom("articles")
      .select([
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
      ])
      .where("id", "=", restored.articleId)
      .executeTakeFirstOrThrow();

    return updated;
  });

  const summary: ArticleSummary = {
    id: txResult.id,
    issueId: txResult.issue_id,
    headline: txResult.headline,
    deck: txResult.deck,
    byline: txResult.byline,
    bylinePosition: (txResult.byline_position === "end" ? "end" : "top") as BylinePosition,
    heroPlacement: normalizeHeroPlacement(txResult.hero_placement),
    heroCaption: txResult.hero_caption,
    heroCredit: txResult.hero_credit,
    section: txResult.section,
    language: txResult.language as ArticleSummary["language"],
    wordCount: txResult.word_count ?? countWords(txResult.body),
    contentType: txResult.content_type as ContentType,
    createdAt: txResult.created_at,
    body: txResult.body,
    bodyFormat: normalizeBodyFormat(txResult.body_format),
  };

  await emitDiskUsageChanged({ db: deps.db, snapshotStore: deps.snapshots });
  return summary;
}

export async function deleteSnapshot(
  deps: SnapshotHandlerDeps,
  payload: { snapshotId: string }
): Promise<{ snapshotId: string; deleted: true }> {
  await deps.snapshots.deleteArticleSnapshot(payload.snapshotId);
  await emitDiskUsageChanged({ db: deps.db, snapshotStore: deps.snapshots });
  return { snapshotId: payload.snapshotId, deleted: true };
}

export async function labelSnapshot(
  deps: SnapshotHandlerDeps,
  payload: { snapshotId: string; label: string | null }
): Promise<ArticleSnapshotSummary> {
  await deps.snapshots.labelArticleSnapshot(payload.snapshotId, payload.label);
  return findSnapshotSummary(deps.db, payload.snapshotId);
}

export async function starSnapshot(
  deps: SnapshotHandlerDeps,
  payload: { snapshotId: string; starred: boolean }
): Promise<ArticleSnapshotSummary> {
  await deps.snapshots.starArticleSnapshot(payload.snapshotId, payload.starred);
  return findSnapshotSummary(deps.db, payload.snapshotId);
}

export async function totalBytes(deps: SnapshotHandlerDeps): Promise<DiskUsageSnapshot> {
  return computeDiskUsage(deps.db, deps.snapshots);
}

// ---- Issue-level snapshot reads (T19 / v0.6) -------------------------
// Issue snapshots are written automatically on every issue mutation by
// existing v0.5 code paths. The History tab consumes these for browse +
// preview only — restore is deferred (TODOS.md) because it cascades
// across articles + classifieds + ads + placements.

export async function listIssueSnapshots(
  deps: SnapshotHandlerDeps,
  payload: { issueId: string; limit?: number }
): Promise<IssueSnapshotSummary[]> {
  const rows = await deps.snapshots.list(payload.issueId, payload.limit);
  return rows.map((r) => ({
    id: r.id,
    issueId: r.issue_id,
    createdAt: r.created_at,
    description: r.description,
    sizeBytes: r.size_bytes,
  }));
}

export async function readIssueSnapshot(
  deps: SnapshotHandlerDeps,
  payload: { snapshotId: string }
): Promise<IssueSnapshotPreview> {
  // Confirm the row is an issue-level snapshot before reading; the shared
  // snapshots table holds article rows too and `snapshot.read()` would
  // happily return whatever JSON it finds.
  const row = await deps.db
    .selectFrom("snapshots")
    .select(["id", "issue_id", "created_at", "description", "entity_kind"])
    .where("id", "=", payload.snapshotId)
    .executeTakeFirst();
  if (!row || row.entity_kind !== "issue") {
    throw makeError("snapshot_corrupt", "error", {
      snapshotId: payload.snapshotId,
      reason: "not_issue_snapshot",
    });
  }
  const state = await deps.snapshots.read(payload.snapshotId);
  return {
    id: row.id,
    issueId: row.issue_id,
    createdAt: row.created_at,
    description: row.description,
    title: state.title,
    issueNumber: state.issue_number,
    articleCount: state.articles.length,
    classifiedCount: state.classifieds.length,
    adCount: state.ads.length,
    articleHeadlines: state.articles.map((a) => a.headline),
  };
}

// Look up a single article snapshot's summary row directly from the table.
// Used by label/star handlers to return the post-mutation row to the renderer
// without forcing the caller to re-list.
async function findSnapshotSummary(
  db: Kysely<Database>,
  snapshotId: string
): Promise<ArticleSnapshotSummary> {
  const row = await db
    .selectFrom("snapshots")
    .select([
      "id",
      "article_id",
      "created_at",
      "label",
      "starred",
      "size_bytes",
      "block_schema_version",
      "entity_kind",
    ])
    .where("id", "=", snapshotId)
    .executeTakeFirst();
  if (!row || row.entity_kind !== "article" || !row.article_id) {
    throw makeError("snapshot_stale", "error", { snapshotId });
  }
  return {
    id: row.id,
    articleId: row.article_id,
    createdAt: row.created_at,
    label: row.label,
    starred: row.starred === 1,
    sizeBytes: row.size_bytes,
    blockSchemaVersion: row.block_schema_version,
  };
}

export function registerSnapshotHandlers(): void {
  addHandler("snapshot:list", async (payload: { articleId: string; limit?: number }) => {
    const { db, snapshots } = getState();
    return listSnapshots({ db, snapshots }, payload);
  });

  addHandler("snapshot:read", async (payload: { snapshotId: string }) => {
    const { db, snapshots } = getState();
    return readSnapshot({ db, snapshots }, payload);
  });

  addHandler("snapshot:restore", async (payload: { snapshotId: string }) => {
    const { db, snapshots } = getState();
    return restoreSnapshot({ db, snapshots }, payload);
  });

  addHandler("snapshot:delete", async (payload: { snapshotId: string }) => {
    const { db, snapshots } = getState();
    return deleteSnapshot({ db, snapshots }, payload);
  });

  addHandler("snapshot:label", async (payload: { snapshotId: string; label: string | null }) => {
    const { db, snapshots } = getState();
    return labelSnapshot({ db, snapshots }, payload);
  });

  addHandler("snapshot:star", async (payload: { snapshotId: string; starred: boolean }) => {
    const { db, snapshots } = getState();
    return starSnapshot({ db, snapshots }, payload);
  });

  addHandler("snapshot:totalBytes", async () => {
    const { db, snapshots } = getState();
    return totalBytes({ db, snapshots });
  });

  addHandler("issue-snapshot:list", async (payload: { issueId: string; limit?: number }) => {
    const { db, snapshots } = getState();
    return listIssueSnapshots({ db, snapshots }, payload);
  });

  addHandler("issue-snapshot:read", async (payload: { snapshotId: string }) => {
    const { db, snapshots } = getState();
    return readIssueSnapshot({ db, snapshots }, payload);
  });
}
