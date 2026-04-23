import { describe, expect, test, beforeEach, afterEach } from "vitest";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import { migrateArticleToBlocknote } from "../../../src/main/article-migration/blocknote.js";
import { openArticleForEdit } from "../../../src/main/ipc/handlers/article.js";

let db: Kysely<Database>;
let issueId: string;
let backupDir: string;

function nowISO(): string {
  return new Date().toISOString();
}

async function insertArticle(opts: {
  id?: string;
  body: string;
  bodyFormat?: "plain" | "markdown" | "blocks";
  headline?: string;
}): Promise<string> {
  const id = opts.id ?? randomUUID();
  await db
    .insertInto("articles")
    .values({
      id,
      issue_id: issueId,
      headline: opts.headline ?? "Test Article",
      deck: null,
      byline: null,
      byline_position: "top",
      hero_placement: "below-headline",
      hero_caption: null,
      hero_credit: null,
      section: null,
      body: opts.body,
      body_format: opts.bodyFormat ?? "plain",
      language: "en",
      word_count: opts.body.split(/\s+/).filter(Boolean).length,
      content_type: "Article",
      pull_quote: null,
      sidebar: null,
      created_at: nowISO(),
      updated_at: nowISO(),
    })
    .execute();
  return id;
}

async function readJsonlLines(filePath: string): Promise<unknown[]> {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });

  // Per-test temp dir for the JSONL backup so suites can run in parallel
  // without colliding.
  backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-blocknote-mig-"));

  issueId = randomUUID();
  await db
    .insertInto("issues")
    .values({
      id: issueId,
      tenant_id: "publisher_default",
      title: "Issue 1",
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
});

afterEach(async () => {
  await db.destroy();
  await fs.rm(backupDir, { recursive: true, force: true });
});

describe("migrateArticleToBlocknote — happy path", () => {
  test("v0.5 plain article → BlockNote JSON, body_format='blocks', JSONL backup written", async () => {
    const id = await insertArticle({
      body: "First paragraph.\n\nSecond paragraph.\n\nThird.",
      headline: "Plain Article",
    });

    const result = await migrateArticleToBlocknote(db, id, { backupDir });
    expect(result.migrated).toBe(true);
    expect(result.fromFormat).toBe("plain");
    expect(result.toFormat).toBe("blocks");
    expect(result.backupPath).toBe(path.join(backupDir, "blocknote-pre.jsonl"));

    const row = await db
      .selectFrom("articles")
      .select(["body", "body_format"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.body_format).toBe("blocks");
    const blocks = JSON.parse(row.body) as {
      id: string;
      type: string;
      content: { type: string; text: string; styles: Record<string, unknown> }[];
    }[];
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(blocks.every((b) => typeof b.id === "string" && b.id.length > 0)).toBe(true);
    expect(blocks[0]!.content[0]!.text).toBe("First paragraph.");
    expect(blocks[1]!.content[0]!.text).toBe("Second paragraph.");
    expect(blocks[2]!.content[0]!.text).toBe("Third.");

    const lines = await readJsonlLines(result.backupPath!);
    expect(lines).toHaveLength(1);
  });
});

describe("migrateArticleToBlocknote — idempotency", () => {
  test("same article opened twice → no second migration, no second backup line", async () => {
    const id = await insertArticle({ body: "Hello world." });

    const first = await migrateArticleToBlocknote(db, id, { backupDir });
    expect(first.migrated).toBe(true);

    const second = await migrateArticleToBlocknote(db, id, { backupDir });
    expect(second.migrated).toBe(false);
    expect(second.fromFormat).toBe("blocks");
    expect(second.toFormat).toBe("blocks");
    expect(second.backupPath).toBeNull();

    const lines = await readJsonlLines(path.join(backupDir, "blocknote-pre.jsonl"));
    expect(lines).toHaveLength(1);
  });

  test("article with body_format='blocks' from the start → no migration runs", async () => {
    const id = await insertArticle({
      body: '[{"id":"b1","type":"paragraph","content":[]}]',
      bodyFormat: "blocks",
    });

    const result = await migrateArticleToBlocknote(db, id, { backupDir });
    expect(result.migrated).toBe(false);
    expect(result.fromFormat).toBe("blocks");
    expect(result.toFormat).toBe("blocks");
    expect(result.backupPath).toBeNull();

    // No backup file should be written when nothing migrated.
    await expect(fs.access(path.join(backupDir, "blocknote-pre.jsonl"))).rejects.toThrow();
  });

  test("article with body_format='markdown' → no migration runs", async () => {
    const id = await insertArticle({
      body: "# A heading\n\nSome body.",
      bodyFormat: "markdown",
    });

    const result = await migrateArticleToBlocknote(db, id, { backupDir });
    expect(result.migrated).toBe(false);
    expect(result.fromFormat).toBe("markdown");
    expect(result.toFormat).toBe("markdown");
    expect(result.backupPath).toBeNull();
  });
});

describe("migrateArticleToBlocknote — empty body", () => {
  test("empty plain body → migrated, single empty paragraph block", async () => {
    const id = await insertArticle({ body: "" });

    const result = await migrateArticleToBlocknote(db, id, { backupDir });
    expect(result.migrated).toBe(true);
    expect(result.toFormat).toBe("blocks");

    const row = await db
      .selectFrom("articles")
      .select(["body", "body_format"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.body_format).toBe("blocks");
    const blocks = JSON.parse(row.body) as { id: string; type: string; content: unknown[] }[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("paragraph");
    expect(blocks[0]!.content).toEqual([]);
  });
});

describe("migrateArticleToBlocknote — failure path", () => {
  test("filesystem failure: backupDir is a regular file → DB unchanged, no backup line written", async () => {
    const id = await insertArticle({ body: "Some body." });

    // Replace the backup directory with a regular file so mkdir fails.
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.writeFile(backupDir, "block-the-mkdir", "utf8");

    await expect(migrateArticleToBlocknote(db, id, { backupDir })).rejects.toThrow();

    // DB row must be untouched.
    const row = await db
      .selectFrom("articles")
      .select(["body", "body_format"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.body).toBe("Some body.");
    expect(row.body_format).toBe("plain");

    // Restore so afterEach can clean up cleanly.
    await fs.rm(backupDir, { force: true });
    await fs.mkdir(backupDir, { recursive: true });
  });
});

describe("migrateArticleToBlocknote — JSONL line shape", () => {
  test("line contains all required fields", async () => {
    const id = await insertArticle({
      body: "Body content here.",
      headline: "My Headline",
    });

    const result = await migrateArticleToBlocknote(db, id, { backupDir });
    const lines = await readJsonlLines(result.backupPath!);
    expect(lines).toHaveLength(1);
    const entry = lines[0] as Record<string, unknown>;
    expect(entry["timestamp"]).toEqual(expect.any(String));
    expect(new Date(entry["timestamp"] as string).toString()).not.toBe("Invalid Date");
    expect(entry["articleId"]).toBe(id);
    expect(entry["issueId"]).toBe(issueId);
    expect(entry["headline"]).toBe("My Headline");
    expect(entry["body"]).toBe("Body content here.");
    expect(entry["bodyFormat"]).toBe("plain");
  });
});

describe("migrateArticleToBlocknote — multiple articles", () => {
  test("each article gets its own JSONL line, in append order", async () => {
    const a = await insertArticle({ body: "A body.", headline: "A" });
    const b = await insertArticle({ body: "B body.", headline: "B" });
    const c = await insertArticle({ body: "C body.", headline: "C" });

    await migrateArticleToBlocknote(db, a, { backupDir });
    await migrateArticleToBlocknote(db, b, { backupDir });
    await migrateArticleToBlocknote(db, c, { backupDir });

    const lines = (await readJsonlLines(path.join(backupDir, "blocknote-pre.jsonl"))) as Record<
      string,
      unknown
    >[];
    expect(lines.map((l) => l["headline"])).toEqual(["A", "B", "C"]);
    expect(lines.map((l) => l["articleId"])).toEqual([a, b, c]);
  });
});

describe("openArticleForEdit handler", () => {
  test("plain article: triggers migration, returns post-migration summary with bodyFormat='blocks'", async () => {
    const id = await insertArticle({
      body: "One.\n\nTwo.",
      headline: "Open me",
    });

    const summary = await openArticleForEdit({ db, backupDir }, { id });
    expect(summary.id).toBe(id);
    expect(summary.bodyFormat).toBe("blocks");
    expect(summary.migrationWarning).toBeUndefined();

    // Confirm the body is now JSON-shaped.
    const blocks = JSON.parse(summary.body) as { type: string }[];
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
  });

  test("blocks article: no migration, no warning, body is unchanged", async () => {
    const id = await insertArticle({
      body: '[{"id":"b1","type":"paragraph","content":[]}]',
      bodyFormat: "blocks",
    });

    const summary = await openArticleForEdit({ db, backupDir }, { id });
    expect(summary.bodyFormat).toBe("blocks");
    expect(summary.body).toBe('[{"id":"b1","type":"paragraph","content":[]}]');
    expect(summary.migrationWarning).toBeUndefined();
  });

  test("migration failure: returns plain-text body + migrationWarning, editing not blocked", async () => {
    const id = await insertArticle({ body: "Plain body.", headline: "Fallback" });

    // Force the migration to fail by making backupDir a regular file.
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.writeFile(backupDir, "wedge-the-mkdir", "utf8");

    const summary = await openArticleForEdit({ db, backupDir }, { id });
    expect(summary.body).toBe("Plain body.");
    expect(summary.bodyFormat).toBe("plain");
    expect(summary.migrationWarning).toMatch(/Plain-text fallback/i);

    // Restore so afterEach can clean up.
    await fs.rm(backupDir, { force: true });
    await fs.mkdir(backupDir, { recursive: true });
  });
});
