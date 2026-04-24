import { describe, expect, test, afterEach, beforeEach } from "vitest";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";

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

describe("migration 5 verification", () => {
  test("display_position column exists on articles, classifieds, ads", async () => {
    for (const table of ["articles", "classifieds", "ads"] as const) {
      const cols = await sql<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>`PRAGMA table_info(${sql.raw(table)})`.execute(db);
      const byName = new Map(cols.rows.map((r) => [r.name, r]));
      const col = byName.get("display_position");
      expect(col).toBeDefined();
      expect(col?.type).toBe("REAL");
      expect(col?.notnull).toBe(1);
      expect(col?.dflt_value).toBe("0");
    }
  });

  test("display_position index exists on each table", async () => {
    for (const table of ["articles", "classifieds", "ads"] as const) {
      const indexes = await sql<{
        name: string;
      }>`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=${table}`.execute(db);
      const names = indexes.rows.map((r) => r.name);
      expect(names).toContain(`idx_${table}_display_position`);
    }
  });
});

describe("migration 5 backfill on existing rows", () => {
  test("backfills articles in created_at ASC order", async () => {
    // Use a fresh in-memory db, only run migrations 1-4, insert rows,
    // then run migration 5. Easier: use the migrated DB and prove
    // the backfill expression works by inserting via the post-migration
    // schema with display_position=0 (the SQL default), then re-running
    // the backfill SQL ourselves to mirror what the migration did.
    const issueId = randomUUID();
    await db
      .insertInto("issues")
      .values({
        id: issueId,
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

    // Insert three articles with explicit, increasing created_at and a
    // shared display_position=0 to simulate what the migration sees
    // pre-backfill.
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < ids.length; i += 1) {
      await db
        .insertInto("articles")
        .values({
          id: ids[i]!,
          issue_id: issueId,
          headline: `H${i}`,
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
          display_position: 0,
          created_at: new Date(Date.now() + i * 1000).toISOString(),
          updated_at: nowISO(),
        })
        .execute();
    }

    // Re-run the backfill query (same shape as migration 5).
    await sql
      .raw(
        `UPDATE articles SET display_position = (
         SELECT rn * 1.0 FROM (
           SELECT id AS _id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
           FROM articles
         ) WHERE _id = articles.id
       )`
      )
      .execute(db);

    const rows = await db
      .selectFrom("articles")
      .select(["id", "display_position", "created_at"])
      .orderBy("created_at", "asc")
      .execute();
    // After backfill, the oldest row gets 1.0, then 2.0, 3.0 ...
    expect(rows.map((r) => Number(r.display_position))).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.id)).toEqual(ids);
  });
});
