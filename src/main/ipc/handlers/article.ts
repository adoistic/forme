import { randomUUID } from "node:crypto";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { parseDocx } from "../../docx-ingest/parse.js";
import { ingestImage } from "../../image-ingest/ingest.js";
import { detectLanguage } from "@shared/schemas/language.js";
import type {
  ArticleSummary,
  ImportDocxInput,
  UpdateArticleInput,
} from "@shared/ipc-contracts/channels.js";
import type { ContentType, BylinePosition } from "@shared/schemas/article.js";

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
  language: string;
  word_count: number;
  content_type: string;
  created_at: string;
};

function rowToSummary(row: ArticleRow): ArticleSummary {
  return {
    id: row.id,
    issueId: row.issue_id,
    headline: row.headline,
    deck: row.deck,
    byline: row.byline,
    bylinePosition: (row.byline_position === "end" ? "end" : "top") as BylinePosition,
    language: row.language as ArticleSummary["language"],
    wordCount: row.word_count,
    contentType: row.content_type as ContentType,
    createdAt: row.created_at,
  };
}

const SUMMARY_COLUMNS = [
  "id",
  "issue_id",
  "headline",
  "deck",
  "byline",
  "byline_position",
  "language",
  "word_count",
  "content_type",
  "created_at",
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
    const { db, blobs } = getState();
    const buf = Buffer.from(payload.base64, "base64");

    const parsed = await parseDocx(buf);

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
      } catch {
        // best-effort: skip bad images, they don't block the article
      }
    }

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

    return {
      id,
      issueId: payload.issueId,
      headline: parsed.headline,
      deck: parsed.deck,
      byline: parsed.byline,
      bylinePosition: parsed.byline_position,
      language,
      wordCount: parsed.word_count,
      contentType: "Article",
      createdAt: now,
    };
  });

  addHandler("article:update", async (payload: UpdateArticleInput): Promise<ArticleSummary> => {
    const { db } = getState();
    const patch: Record<string, unknown> = { updated_at: nowISO() };
    if (payload.headline !== undefined) patch["headline"] = payload.headline;
    if (payload.deck !== undefined) patch["deck"] = payload.deck;
    if (payload.byline !== undefined) patch["byline"] = payload.byline;
    if (payload.bylinePosition !== undefined)
      patch["byline_position"] = payload.bylinePosition;

    await db.updateTable("articles").set(patch).where("id", "=", payload.id).execute();

    const row = await db
      .selectFrom("articles")
      .select([...SUMMARY_COLUMNS])
      .where("id", "=", payload.id)
      .executeTakeFirstOrThrow();
    return rowToSummary(row as ArticleRow);
  });
}
