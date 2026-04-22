import { describe, expect, test, afterEach, beforeEach } from "vitest";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";

let db: Kysely<Database>;

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });
});

afterEach(async () => {
  await db.destroy();
});

describe("migration 4 verification", () => {
  test("snapshots has new columns with correct defaults", async () => {
    const cols = await sql<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>`PRAGMA table_info(snapshots)`.execute(db);
    const byName = new Map(cols.rows.map((r) => [r.name, r]));

    expect(byName.get("article_id")).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(byName.get("entity_kind")).toMatchObject({
      type: "TEXT",
      notnull: 1,
      dflt_value: "'issue'",
    });
    expect(byName.get("label")).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(byName.get("starred")).toMatchObject({
      type: "INTEGER",
      notnull: 1,
      dflt_value: "0",
    });
    expect(byName.get("diff_status")).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(byName.get("block_schema_version")).toMatchObject({
      type: "INTEGER",
      notnull: 1,
      dflt_value: "1",
    });
  });

  test("snapshots has the article+time index in DESC order", async () => {
    const indexes = await sql<{
      name: string;
      sql: string | null;
    }>`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='snapshots'`.execute(db);
    const target = indexes.rows.find((r) => r.name === "idx_snapshots_article_time");
    expect(target).toBeDefined();
    // SQLite preserves the column-direction syntax in sqlite_master.sql.
    expect(target?.sql).toMatch(/article_id/);
    expect(target?.sql?.toLowerCase()).toMatch(/"created_at"\s+desc/);
  });

  test("articles.body_format defaults to 'plain' for inserted rows", async () => {
    // Insert without body_format — the SQL default should apply.
    const issueId = "11111111-1111-1111-1111-111111111111";
    await db
      .insertInto("issues")
      .values({
        id: issueId,
        tenant_id: "publisher_default",
        title: "T",
        issue_number: 1,
        issue_date: "2026-04-21",
        page_size: "A4",
        typography_pairing: "Editorial Serif",
        primary_language: "en",
        bw_mode: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();
    const articleId = "22222222-2222-2222-2222-222222222222";
    await db
      .insertInto("articles")
      .values({
        id: articleId,
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();
    const got = await db
      .selectFrom("articles")
      .select(["body_format"])
      .where("id", "=", articleId)
      .executeTakeFirst();
    expect(got?.body_format).toBe("plain");
  });

  test("app_settings table exists with correct shape", async () => {
    const cols = await sql<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>`PRAGMA table_info(app_settings)`.execute(db);
    const byName = new Map(cols.rows.map((r) => [r.name, r]));
    expect(byName.get("key")).toMatchObject({ type: "TEXT", pk: 1 });
    expect(byName.get("value")).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(byName.get("updated_at")).toMatchObject({ type: "TEXT", notnull: 1 });
  });

  test("existing-style snapshot insert (issue-level) still compiles + works", async () => {
    // The store.ts insert pattern from v0.5 must still work without specifying
    // any of the new columns — they fall back to SQL defaults.
    const issueId = "33333333-3333-3333-3333-333333333333";
    await db
      .insertInto("issues")
      .values({
        id: issueId,
        tenant_id: "publisher_default",
        title: "T",
        issue_number: 1,
        issue_date: "2026-04-21",
        page_size: "A4",
        typography_pairing: "Editorial Serif",
        primary_language: "en",
        bw_mode: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();
    await db
      .insertInto("snapshots")
      .values({
        id: "44444444-4444-4444-4444-444444444444",
        issue_id: issueId,
        created_at: new Date().toISOString(),
        description: "Created issue",
        state_json: "{}",
        size_bytes: 2,
        is_full: 1,
      })
      .execute();
    const got = await db
      .selectFrom("snapshots")
      .selectAll()
      .where("issue_id", "=", issueId)
      .executeTakeFirst();
    expect(got?.entity_kind).toBe("issue");
    expect(got?.starred).toBe(0);
    expect(got?.block_schema_version).toBe(1);
    expect(got?.article_id).toBeNull();
    expect(got?.label).toBeNull();
    expect(got?.diff_status).toBeNull();
  });
});
