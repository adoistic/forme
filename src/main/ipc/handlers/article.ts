import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { parseDocx } from "../../docx-ingest/parse.js";
import { ingestImage } from "../../image-ingest/ingest.js";
import { detectLanguage } from "@shared/schemas/language.js";
import type {
  ArticleSummary,
  CreateArticleInput,
  ImportDocxInput,
  UpdateArticleInput,
} from "@shared/ipc-contracts/channels.js";
import { countWords } from "@shared/schemas/article.js";
import type { ContentType, BylinePosition, HeroPlacement } from "@shared/schemas/article.js";
import { makeError } from "@shared/errors/structured.js";
import { emitDiskUsageChanged } from "../../disk-usage-events.js";
import { createLogger } from "../../logger.js";
import type { Database } from "../../sqlite/schema.js";
import type { SnapshotStore } from "../../snapshot-store/store.js";
import { migrateArticleToBlocknote } from "../../article-migration/blocknote.js";

const logger = createLogger("ipc:article");

export interface ArticleHandlerDeps {
  db: Kysely<Database>;
  snapshots: SnapshotStore;
}

function nowISO(): string {
  return new Date().toISOString();
}

type ArticleRow = {
  id: string;
  issue_id: string;
  headline: string;
  deck: string | null;
  byline: string | null;
  byline_position: string;
  hero_placement: string;
  hero_caption: string | null;
  hero_credit: string | null;
  section: string | null;
  language: string;
  word_count: number;
  content_type: string;
  created_at: string;
  body: string;
  body_format: string;
};

function normalizeHeroPlacement(s: string | null | undefined): HeroPlacement {
  if (s === "above-headline" || s === "full-bleed") return s;
  return "below-headline";
}

function normalizeBodyFormat(s: string | null | undefined): "plain" | "markdown" | "blocks" {
  if (s === "markdown" || s === "blocks") return s;
  return "plain";
}

function rowToSummary(row: ArticleRow): ArticleSummary {
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

export function registerArticleHandlers(): void {
  addHandler("article:list", async (payload: { issueId: string }) => {
    const { db } = getState();
    const rows = await db
      .selectFrom("articles")
      .select([...SUMMARY_COLUMNS])
      .where("issue_id", "=", payload.issueId)
      .orderBy("created_at", "desc")
      .execute();
    return rows.map((r) => rowToSummary(r as ArticleRow));
  });

  addHandler("article:import-docx", async (payload: ImportDocxInput): Promise<ArticleSummary> => {
    const { db, blobs, snapshots } = getState();
    const buf = Buffer.from(payload.base64, "base64");

    const parsed = await parseDocx(buf);

    const id = randomUUID();
    const now = nowISO();
    const language = parsed.language ?? detectLanguage(parsed.body);

    await db
      .insertInto("articles")
      .values({
        id,
        issue_id: payload.issueId,
        headline: parsed.headline,
        deck: parsed.deck,
        byline: parsed.byline,
        byline_position: parsed.byline_position,
        hero_placement: "below-headline",
        hero_caption: null,
        hero_credit: null,
        section: null,
        body: parsed.body,
        language,
        word_count: parsed.word_count,
        content_type: "Article",
        pull_quote: null,
        sidebar: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    // Now link each embedded image into the article_images join. First image
    // becomes the hero (rendered on page 1 of the article by the PPTX
    // builder); subsequent ones are marked "inline" for future use.
    let position = 0;
    for (const img of parsed.images) {
      try {
        const ingested = await ingestImage({
          filename: payload.filename,
          buffer: img.bytes,
        });
        const hash = await blobs.writeBuffer(ingested.bytes);
        await db
          .insertInto("images")
          .values({
            blob_hash: hash,
            filename: payload.filename,
            mime_type: ingested.mimeType,
            width: ingested.width,
            height: ingested.height,
            dpi: ingested.dpi,
            color_mode: ingested.color_mode,
            size_bytes: ingested.size_bytes,
            imported_at: nowISO(),
            tags_json: null,
          })
          .onConflict((oc) => oc.column("blob_hash").doNothing())
          .execute();
        await db
          .insertInto("article_images")
          .values({
            article_id: id,
            blob_hash: hash,
            position,
            caption: null,
            role: position === 0 ? "hero" : "inline",
          })
          .onConflict((oc) => oc.columns(["article_id", "blob_hash", "position"]).doNothing())
          .execute();
        position += 1;
      } catch {
        // best-effort: skip bad images, they don't block the article
      }
    }

    // Notify renderer about the new image blobs (if any landed). Cheap to
    // emit even when the article had no images.
    if (parsed.images.length > 0) {
      await emitDiskUsageChanged({ db, snapshotStore: snapshots });
    }

    return {
      id,
      issueId: payload.issueId,
      headline: parsed.headline,
      deck: parsed.deck,
      byline: parsed.byline,
      bylinePosition: parsed.byline_position,
      heroPlacement: "below-headline",
      heroCaption: null,
      heroCredit: null,
      section: null,
      language,
      wordCount: parsed.word_count,
      contentType: "Article",
      createdAt: now,
      body: parsed.body,
      bodyFormat: "plain",
    };
  });

  addHandler("article:create", async (payload: CreateArticleInput): Promise<ArticleSummary> => {
    const { db } = getState();
    const id = randomUUID();
    const now = nowISO();
    const headline = payload.headline.trim() || "Untitled";
    const body = payload.body.trim();
    if (!body) {
      throw new Error("article:create requires non-empty body");
    }
    const language = payload.language ?? detectLanguage(body);
    const contentType = payload.contentType ?? "Article";
    const wordCount = countWords(body);
    await db
      .insertInto("articles")
      .values({
        id,
        issue_id: payload.issueId,
        headline,
        deck: payload.deck ?? null,
        byline: payload.byline ?? null,
        byline_position: "top",
        hero_placement: "below-headline",
        hero_caption: null,
        hero_credit: null,
        section: null,
        body,
        language,
        word_count: wordCount,
        content_type: contentType,
        pull_quote: null,
        sidebar: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    return {
      id,
      issueId: payload.issueId,
      headline,
      deck: payload.deck ?? null,
      byline: payload.byline ?? null,
      bylinePosition: "top",
      heroPlacement: "below-headline",
      heroCaption: null,
      heroCredit: null,
      section: null,
      language,
      wordCount,
      contentType,
      createdAt: now,
      body,
      bodyFormat: "plain",
    };
  });

  addHandler("article:update", async (payload: UpdateArticleInput): Promise<ArticleSummary> => {
    const { db, snapshots } = getState();
    return updateArticle({ db, snapshots }, payload);
  });

  addHandler("article:delete", async (payload: { id: string }) => {
    const { db, snapshots } = getState();
    return deleteArticle({ db, snapshots }, payload);
  });

  addHandler("article:open-for-edit", async (payload: { id: string }): Promise<ArticleSummary> => {
    const { db } = getState();
    return openArticleForEdit({ db }, payload);
  });

  // Lightweight body fetch for the DiffViewer (T9 / v0.6) — returns just the
  // bytes the diff overlay needs without running the BlockNote migration that
  // `article:open-for-edit` triggers. The diff rail compares it against a
  // snapshot body; full ArticleSummary fields aren't needed.
  addHandler("article:read-body", async (payload: { id: string }) => {
    const { db } = getState();
    const row = await db
      .selectFrom("articles")
      .select(["id", "body", "body_format"])
      .where("id", "=", payload.id)
      .executeTakeFirst();
    if (!row) {
      throw makeError("not_found", "error", { resource: "article", id: payload.id });
    }
    return {
      id: row.id,
      body: row.body,
      bodyFormat: normalizeBodyFormat(row.body_format),
    };
  });
}

export async function updateArticle(
  deps: ArticleHandlerDeps,
  payload: UpdateArticleInput
): Promise<ArticleSummary> {
  const { db, snapshots } = deps;
  const patch: Record<string, unknown> = { updated_at: nowISO() };
  if (payload.headline !== undefined) patch["headline"] = payload.headline;
  if (payload.deck !== undefined) patch["deck"] = payload.deck;
  if (payload.byline !== undefined) patch["byline"] = payload.byline;
  if (payload.bylinePosition !== undefined) patch["byline_position"] = payload.bylinePosition;
  if (payload.heroPlacement !== undefined) patch["hero_placement"] = payload.heroPlacement;
  if (payload.heroCaption !== undefined) patch["hero_caption"] = payload.heroCaption;
  if (payload.heroCredit !== undefined) patch["hero_credit"] = payload.heroCredit;
  if (payload.section !== undefined) patch["section"] = payload.section;
  if (payload.contentType !== undefined) patch["content_type"] = payload.contentType;

  let bodyChanged = false;
  if (payload.body !== undefined) {
    // CEO plan decision 2A: editing to empty must use the delete flow,
    // not the save flow. Operators get a clear message instead of a
    // silently empty article.
    if (payload.body.trim() === "") {
      throw makeError("article_body_required", "error", { articleId: payload.id });
    }
    patch["body"] = payload.body;
    patch["word_count"] = countWords(payload.body);
    if (payload.bodyFormat !== undefined) {
      patch["body_format"] = payload.bodyFormat;
    }
    bodyChanged = true;
  }

  await db.updateTable("articles").set(patch).where("id", "=", payload.id).execute();

  const row = await db
    .selectFrom("articles")
    .select([...SUMMARY_COLUMNS])
    .where("id", "=", payload.id)
    .executeTakeFirstOrThrow();
  const summary = rowToSummary(row as ArticleRow);

  // Snapshot is independent of the body save (CEO plan 2A): if the
  // snapshot fails we still return the saved article with a warning the
  // renderer can surface as a non-blocking toast.
  if (bodyChanged && payload.body !== undefined) {
    try {
      await snapshots.saveArticleSnapshot(payload.id, payload.body);
      await emitDiskUsageChanged({ db, snapshotStore: snapshots });
    } catch (err) {
      logger.error(
        { articleId: payload.id, err: err instanceof Error ? err.message : String(err) },
        "snapshot save failed after body update"
      );
      summary.snapshotWarning = "Edit saved, but the version history snapshot couldn't be written.";
    }
  }
  return summary;
}

export async function deleteArticle(
  deps: ArticleHandlerDeps,
  payload: { id: string }
): Promise<{ id: string; deleted: true }> {
  const { db, snapshots } = deps;
  // CASCADE drops article_images + article-level snapshot rows. Issue-level
  // snapshots are unaffected because they reference issue_id.
  const result = await db.deleteFrom("articles").where("id", "=", payload.id).execute();
  const deleted = result.reduce((sum, r) => sum + Number(r.numDeletedRows ?? 0), 0);
  if (deleted === 0) {
    throw makeError("not_found", "error", { resource: "article", id: payload.id });
  }
  await emitDiskUsageChanged({ db, snapshotStore: snapshots });
  return { id: payload.id, deleted: true };
}

/**
 * v0.6 §9A: lazy BlockNote migration on first open. If the article still
 * carries `body_format='plain'`, convert it to BlockNote JSON, write a
 * JSONL backup line BEFORE the DB update, and persist the new format.
 * Idempotent on subsequent opens because `body_format` is now `'blocks'`.
 *
 * Migration failure (filesystem error, malformed body, etc.) MUST NOT
 * block editing: the operator gets the original plain-text body back with
 * a `migrationWarning` so the renderer can show a non-blocking notice and
 * fall back to the plain-text editor surface.
 */
export async function openArticleForEdit(
  deps: { db: Kysely<Database>; backupDir?: string },
  payload: { id: string }
): Promise<ArticleSummary> {
  const { db } = deps;
  let migrationWarning: string | null = null;
  try {
    const result = await migrateArticleToBlocknote(
      db,
      payload.id,
      deps.backupDir ? { backupDir: deps.backupDir } : undefined
    );
    if (result.migrated) {
      logger.info(
        { articleId: payload.id, backupPath: result.backupPath },
        "BlockNote migration complete"
      );
    }
  } catch (err) {
    logger.error(
      {
        articleId: payload.id,
        err: err instanceof Error ? err.message : String(err),
      },
      "BlockNote migration failed; falling back to plain-text editor"
    );
    migrationWarning = "Could not migrate to rich-text editor. Plain-text fallback active.";
  }

  const row = await db
    .selectFrom("articles")
    .select([...SUMMARY_COLUMNS])
    .where("id", "=", payload.id)
    .executeTakeFirstOrThrow();
  const summary = rowToSummary(row as ArticleRow);
  if (migrationWarning !== null) {
    summary.migrationWarning = migrationWarning;
  }
  return summary;
}
