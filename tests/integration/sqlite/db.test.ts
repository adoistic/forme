import { describe, expect, test, afterEach, beforeEach } from "vitest";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDb } from "../../../src/main/sqlite/db.js";
import { allMigrations } from "../../../src/main/sqlite/migrations.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import { randomUUID } from "node:crypto";

let db: Kysely<Database>;

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });
});

afterEach(async () => {
  await db.destroy();
});

const nowISO = () => new Date().toISOString();

describe("migrations", () => {
  test("applies all migrations to a fresh DB", async () => {
    const version = await sql<{ user_version: number }>`PRAGMA user_version`.execute(db);
    expect(version.rows[0]?.user_version).toBe(allMigrations[allMigrations.length - 1]?.version);
  });

  test("is idempotent when re-run", async () => {
    // Closing and re-opening against the SAME in-memory handle is not meaningful,
    // but re-running runMigrations() on an open db should be a no-op.
    const { runMigrations } = await import("../../../src/main/sqlite/migrations.js");
    const second = await runMigrations(db);
    expect(second.applied).toEqual([]);
  });

  test("foreign keys are enabled", async () => {
    const result = await sql<{ foreign_keys: number }>`PRAGMA foreign_keys`.execute(db);
    expect(result.rows[0]?.foreign_keys).toBe(1);
  });

  test("journal mode is WAL for disk dbs (memory falls back to memory)", async () => {
    // For :memory: SQLite keeps journal_mode=memory. Just check that it ran without error.
    const result = await sql<{ journal_mode: string }>`PRAGMA journal_mode`.execute(db);
    expect(result.rows[0]?.journal_mode).toBeTruthy();
  });
});

describe("schema: issues + articles", () => {
  test("can insert and query issues", async () => {
    const issue = {
      id: randomUUID(),
      tenant_id: "publisher_default",
      title: "Test Issue 1",
      issue_number: 1,
      issue_date: "2026-04-21",
      page_size: "A4" as const,
      typography_pairing: "Editorial Serif",
      primary_language: "en" as const,
      bw_mode: 0 as const,
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    await db.insertInto("issues").values(issue).execute();
    const got = await db.selectFrom("issues").selectAll().where("id", "=", issue.id).executeTakeFirst();
    expect(got?.title).toBe("Test Issue 1");
  });

  test("cascading delete: removing an issue removes its articles", async () => {
    const issueId = randomUUID();
    await db.insertInto("issues").values({
      id: issueId,
      tenant_id: "publisher_default",
      title: "X",
      issue_number: 1,
      issue_date: "2026-04-21",
      page_size: "A4",
      typography_pairing: "Editorial Serif",
      primary_language: "en",
      bw_mode: 0,
      created_at: nowISO(),
      updated_at: nowISO(),
    }).execute();

    const articleId = randomUUID();
    await db.insertInto("articles").values({
      id: articleId,
      issue_id: issueId,
      headline: "The article",
      deck: null,
      byline: null,
      byline_position: "top",
      body: "Body text.",
      language: "en",
      word_count: 2,
      content_type: "Article",
      pull_quote: null,
      sidebar: null,
      created_at: nowISO(),
      updated_at: nowISO(),
    }).execute();

    await db.deleteFrom("issues").where("id", "=", issueId).execute();

    const orphaned = await db
      .selectFrom("articles")
      .selectAll()
      .where("id", "=", articleId)
      .executeTakeFirst();
    expect(orphaned).toBeUndefined();
  });

  test("required column constraints fire", async () => {
    await expect(
      db.insertInto("issues").values({
        // missing title + page_size
        id: "x",
        tenant_id: "publisher_default",
        title: null as unknown as string,
        issue_number: 1,
        issue_date: "2026-04-21",
        page_size: null as unknown as "A4",
        typography_pairing: "Editorial Serif",
        primary_language: "en",
        bw_mode: 0,
        created_at: nowISO(),
        updated_at: nowISO(),
      }).execute()
    ).rejects.toThrow();
  });
});

describe("schema: classifieds + ads queues", () => {
  test("classifieds index enables (type, weeks_to_run) queries", async () => {
    // Just verify insert + select works with the typical queue query shape
    await db.insertInto("classifieds").values({
      id: randomUUID(),
      issue_id: null,
      type: "matrimonial_with_photo",
      language: "en",
      weeks_to_run: 3,
      photo_blob_hash: null,
      fields_json: JSON.stringify({ name: "Jane Doe" }),
      billing_reference: "INV-001",
      created_at: nowISO(),
      updated_at: nowISO(),
    }).execute();

    const active = await db
      .selectFrom("classifieds")
      .selectAll()
      .where("type", "=", "matrimonial_with_photo")
      .where("weeks_to_run", ">", 0)
      .execute();

    expect(active.length).toBe(1);
  });
});

describe("schema: snapshots", () => {
  test("can store and retrieve a snapshot", async () => {
    const issueId = randomUUID();
    await db.insertInto("issues").values({
      id: issueId,
      tenant_id: "publisher_default",
      title: "Snapshot Test",
      issue_number: 1,
      issue_date: "2026-04-21",
      page_size: "A4",
      typography_pairing: "Editorial Serif",
      primary_language: "en",
      bw_mode: 0,
      created_at: nowISO(),
      updated_at: nowISO(),
    }).execute();

    const stateJson = JSON.stringify({ pages: [], articles: [] });
    await db.insertInto("snapshots").values({
      id: randomUUID(),
      issue_id: issueId,
      created_at: nowISO(),
      description: "Auto-save",
      state_json: stateJson,
      size_bytes: stateJson.length,
      is_full: 1,
    }).execute();

    const rows = await db.selectFrom("snapshots").selectAll().execute();
    expect(rows.length).toBe(1);
    expect(rows[0]?.description).toBe("Auto-save");
  });
});
