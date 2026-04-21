import { randomUUID } from "node:crypto";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { parseDocx } from "../../docx-ingest/parse.js";
import { ingestImage } from "../../image-ingest/ingest.js";
import { detectLanguage } from "@shared/schemas/language.js";
import type {
  ArticleSummary,
  ImportDocxInput,
} from "@shared/ipc-contracts/channels.js";
import type { ContentType } from "@shared/schemas/article.js";

function nowISO(): string {
  return new Date().toISOString();
}

function rowToSummary(row: {
  id: string;
  issue_id: string;
  headline: string;
  byline: string | null;
  language: string;
  word_count: number;
  content_type: string;
  created_at: string;
}): ArticleSummary {
  return {
    id: row.id,
    issueId: row.issue_id,
    headline: row.headline,
    byline: row.byline,
    language: row.language as ArticleSummary["language"],
    wordCount: row.word_count,
    contentType: row.content_type as ContentType,
    createdAt: row.created_at,
  };
}

export function registerArticleHandlers(): void {
  addHandler("article:list", async (payload: { issueId: string }) => {
    const { db } = getState();
    const rows = await db
      .selectFrom("articles")
      .select([
        "id",
        "issue_id",
        "headline",
        "byline",
        "language",
        "word_count",
        "content_type",
        "created_at",
      ])
      .where("issue_id", "=", payload.issueId)
      .orderBy("created_at", "desc")
      .execute();
    return rows.map(rowToSummary);
  });

  addHandler("article:import-docx", async (payload: ImportDocxInput): Promise<ArticleSummary> => {
    const { db, blobs } = getState();
    const buf = Buffer.from(payload.base64, "base64");

    // Parse
    const parsed = await parseDocx(buf);

    // Write embedded images to blob store + register in images table
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
        // best-effort for Phase 0: skip bad images, they don't block the article
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
      byline: parsed.byline,
      language,
      wordCount: parsed.word_count,
      contentType: "Article",
      createdAt: now,
    };
  });
}
