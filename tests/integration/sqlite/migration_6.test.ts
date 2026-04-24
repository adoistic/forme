import { describe, expect, test, afterEach, beforeEach } from "vitest";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";

// Migration 6 (v0.6 T15): structured ad placement.
//   - placement_kind TEXT NOT NULL DEFAULT 'cover'
//   - placement_article_id TEXT NULL REFERENCES articles(id) ON DELETE SET NULL
//   - idx_ads_placement_article on placement_article_id
//   - position_label column is preserved (rollback safety)

let db: Kysely<Database>;

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });
});

afterEach(async () => {
  await db.destroy();
});

function nowISO(): string {
  return new Date().toISOString();
}

async function seedIssue(): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("issues")
    .values({
      id,
      tenant_id: "publisher_default",
      title: "Issue",
      issue_number: 1,
      issue_date: "2026-04-21",
      page_size: "A4",
      typography_pairing: "Editorial Serif",
      primary_language: "en",
      bw_mode: 0,
      created_at: nowISO(),
      updated_at: nowISO(),
    })
    .execute();
  return id;
}

async function seedArticle(issueId: string): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("articles")
    .values({
      id,
      issue_id: issueId,
      headline: "H",
      deck: null,
      byline: null,
      byline_position: "top",
      hero_placement: "below-headline",
      hero_caption: null,
      hero_credit: null,
      section: null,
      body: "x",
      language: "en",
      word_count: 1,
      content_type: "Article",
      pull_quote: null,
      sidebar: null,
      created_at: nowISO(),
      updated_at: nowISO(),
    })
    .execute();
  return id;
}

async function seedImage(): Promise<string> {
  const blobHash = "f".repeat(64);
  await db
    .insertInto("images")
    .values({
      blob_hash: blobHash,
      filename: "x.jpg",
      mime_type: "image/jpeg",
      width: 100,
      height: 100,
      dpi: 300,
      color_mode: "rgb",
      size_bytes: 1,
      imported_at: nowISO(),
      tags_json: null,
    })
    .execute();
  return blobHash;
}

describe("migration 6 — column shape", () => {
  test("ads table has placement_kind TEXT NOT NULL DEFAULT 'cover'", async () => {
    const cols = await sql<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>`PRAGMA table_info(ads)`.execute(db);
    const byName = new Map(cols.rows.map((r) => [r.name, r]));
    expect(byName.get("placement_kind")).toMatchObject({
      type: "TEXT",
      notnull: 1,
      dflt_value: "'cover'",
    });
  });

  test("ads table has placement_article_id TEXT NULL", async () => {
    const cols = await sql<{
      name: string;
      type: string;
      notnull: number;
    }>`PRAGMA table_info(ads)`.execute(db);
    const byName = new Map(cols.rows.map((r) => [r.name, r]));
    expect(byName.get("placement_article_id")).toMatchObject({
      type: "TEXT",
      notnull: 0,
    });
  });

  test("position_label column is preserved (rollback safety)", async () => {
    const cols = await sql<{ name: string }>`PRAGMA table_info(ads)`.execute(db);
    const names = cols.rows.map((r) => r.name);
    expect(names).toContain("position_label");
  });

  test("idx_ads_placement_article index exists", async () => {
    const indexes = await sql<{
      name: string;
    }>`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ads'`.execute(db);
    const names = indexes.rows.map((r) => r.name);
    expect(names).toContain("idx_ads_placement_article");
  });

  test("placement_article_id has ON DELETE SET NULL FK", async () => {
    const fkInfo = await sql<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>`PRAGMA foreign_key_list(ads)`.execute(db);
    const placementFk = fkInfo.rows.find((r) => r.from === "placement_article_id");
    expect(placementFk).toBeDefined();
    expect(placementFk?.table).toBe("articles");
    expect(placementFk?.on_delete).toBe("SET NULL");
  });
});

describe("migration 6 — backfill behavior", () => {
  test("ad inserted without placement_kind defaults to 'cover'", async () => {
    const issueId = await seedIssue();
    const blobHash = await seedImage();
    const id = randomUUID();
    // Insert without placement_kind / placement_article_id — the SQL
    // defaults should kick in. This mirrors the legacy v0.5 insert path
    // and proves the migration is purely additive.
    await sql
      .raw(
        `INSERT INTO ads (
         id, issue_id, slot_type, position_label, bw_flag, kind,
         creative_blob_hash, creative_filename, billing_reference,
         display_position, created_at
       ) VALUES (
         '${id}', '${issueId}', 'full_page', 'Run of Book', 0, 'commercial',
         '${blobHash}', 'x.jpg', NULL, 1, '${nowISO()}'
       )`
      )
      .execute(db);

    const row = await db
      .selectFrom("ads")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.placement_kind).toBe("cover");
    expect(row.placement_article_id).toBeNull();
    // Existing free-text label still survives.
    expect(row.position_label).toBe("Run of Book");
  });
});

describe("migration 6 — ON DELETE SET NULL behavior", () => {
  test("deleting the host article nulls placement_article_id without dropping the ad", async () => {
    const issueId = await seedIssue();
    const articleId = await seedArticle(issueId);
    const blobHash = await seedImage();
    const adId = randomUUID();
    await db
      .insertInto("ads")
      .values({
        id: adId,
        issue_id: issueId,
        slot_type: "full_page",
        position_label: "Between articles",
        bw_flag: 0,
        kind: "commercial",
        creative_blob_hash: blobHash,
        creative_filename: "x.jpg",
        billing_reference: null,
        placement_kind: "between",
        placement_article_id: articleId,
        created_at: nowISO(),
      })
      .execute();

    // Delete the article. The ad should remain; placement_article_id should
    // become NULL via ON DELETE SET NULL. PRAGMA foreign_keys is enabled by
    // migration 1.
    await db.deleteFrom("articles").where("id", "=", articleId).execute();

    const row = await db.selectFrom("ads").selectAll().where("id", "=", adId).executeTakeFirst();
    expect(row).toBeDefined();
    expect(row?.placement_article_id).toBeNull();
    // placement_kind is intentionally left at 'between' so the operator
    // sees the broken link on the Ads screen and can re-target.
    expect(row?.placement_kind).toBe("between");
  });
});
