import { describe, expect, test, beforeEach, afterEach } from "vitest";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "../../../src/main/snapshot-store/store.js";
import {
  storageOverview,
  storagePerArticle,
} from "../../../src/main/ipc/handlers/storage.js";

// Storage panel handlers (T12). Verifies the overview totals + breakdown,
// the per-article join (with zero-usage articles still listed), and the
// optional issueId filter.

let db: Kysely<Database>;
let snapshots: SnapshotStore;

function nowISO(): string {
  return new Date().toISOString();
}

function bodyJson(blocks: { id: string; type: string; content: string }[]): string {
  return JSON.stringify(blocks);
}

async function seedIssue(): Promise<string> {
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
  return issueId;
}

async function seedArticle(issueId: string, headline: string): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("articles")
    .values({
      id,
      issue_id: issueId,
      headline,
      deck: null,
      byline: null,
      byline_position: "top",
      hero_placement: "below-headline",
      hero_caption: null,
      hero_credit: null,
      section: null,
      body: "[]",
      body_format: "blocks",
      language: "en",
      word_count: 0,
      content_type: "Article",
      pull_quote: null,
      sidebar: null,
      created_at: nowISO(),
      updated_at: nowISO(),
    })
    .execute();
  return id;
}

async function seedImage(blobHash: string, sizeBytes: number): Promise<void> {
  await db
    .insertInto("images")
    .values({
      blob_hash: blobHash,
      filename: `${blobHash}.jpg`,
      mime_type: "image/jpeg",
      width: 100,
      height: 100,
      dpi: 300,
      color_mode: "rgb",
      size_bytes: sizeBytes,
      imported_at: nowISO(),
      tags_json: null,
    })
    .execute();
}

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });
  snapshots = createSnapshotStore(db);
});

afterEach(async () => {
  await db.destroy();
});

describe("storage:overview", () => {
  test("returns total/snapshots/blobs with breakdown by kind", async () => {
    const issueId = await seedIssue();
    const articleId = await seedArticle(issueId, "Headliner");

    // Snapshot bytes: write a couple of article snapshots.
    await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "first" }])
    );
    await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "second" }])
    );

    // Blobs:
    //  - hero:        1 image attached as hero (1000 bytes)
    //  - ad creative: 1 image used by an ad (2000 bytes)
    //  - classified:  1 image used by a classified (3000 bytes)
    //  - other:       1 image attached inline (4000 bytes)
    const heroHash = "h".repeat(64);
    const adHash = "a".repeat(64);
    const classifiedHash = "c".repeat(64);
    const inlineHash = "i".repeat(64);

    await seedImage(heroHash, 1000);
    await seedImage(adHash, 2000);
    await seedImage(classifiedHash, 3000);
    await seedImage(inlineHash, 4000);

    await db
      .insertInto("article_images")
      .values([
        { article_id: articleId, blob_hash: heroHash, position: 0, caption: null, role: "hero" },
        {
          article_id: articleId,
          blob_hash: inlineHash,
          position: 1,
          caption: null,
          role: "inline",
        },
      ])
      .execute();

    await db
      .insertInto("ads")
      .values({
        id: randomUUID(),
        issue_id: issueId,
        slot_type: "Full Page",
        position_label: "Back Cover",
        bw_flag: 0,
        kind: "commercial",
        creative_blob_hash: adHash,
        creative_filename: "ad.jpg",
        billing_reference: null,
        created_at: nowISO(),
      })
      .execute();

    await db
      .insertInto("classifieds")
      .values({
        id: randomUUID(),
        issue_id: issueId,
        type: "matrimonial",
        language: "en",
        weeks_to_run: 1,
        photo_blob_hash: classifiedHash,
        fields_json: "{}",
        billing_reference: null,
        created_at: nowISO(),
        updated_at: nowISO(),
      })
      .execute();

    const overview = await storageOverview({ db, snapshots });

    expect(overview.snapshots).toBeGreaterThan(0);
    expect(overview.blobs).toBe(1000 + 2000 + 3000 + 4000);
    expect(overview.total).toBe(overview.snapshots + overview.blobs);
    expect(overview.blobsByKind).toEqual({
      hero: 1000,
      ad: 2000,
      classifieds: 3000,
      other: 4000,
    });
  });

  test("returns zero breakdown when no images are present", async () => {
    const issueId = await seedIssue();
    await seedArticle(issueId, "No images");

    const overview = await storageOverview({ db, snapshots });
    expect(overview.blobs).toBe(0);
    expect(overview.snapshots).toBe(0);
    expect(overview.total).toBe(0);
    expect(overview.blobsByKind).toEqual({ hero: 0, ad: 0, classifieds: 0, other: 0 });
  });
});

describe("storage:per-article", () => {
  test("returns rows with correct totals per article", async () => {
    const issueId = await seedIssue();
    const a1 = await seedArticle(issueId, "Article one");
    const a2 = await seedArticle(issueId, "Article two");

    await snapshots.saveArticleSnapshot(
      a1,
      bodyJson([{ id: "b1", type: "p", content: "v1" }])
    );
    await snapshots.saveArticleSnapshot(
      a1,
      bodyJson([{ id: "b1", type: "p", content: "v2" }])
    );
    await snapshots.saveArticleSnapshot(
      a2,
      bodyJson([{ id: "b1", type: "p", content: "x" }])
    );

    const heroA1 = "1".repeat(64);
    await seedImage(heroA1, 5000);
    await db
      .insertInto("article_images")
      .values({
        article_id: a1,
        blob_hash: heroA1,
        position: 0,
        caption: null,
        role: "hero",
      })
      .execute();

    const rows = await storagePerArticle({ db, snapshots }, {});
    expect(rows).toHaveLength(2);

    const r1 = rows.find((r) => r.articleId === a1);
    const r2 = rows.find((r) => r.articleId === a2);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    expect(r1!.snapshotCount).toBe(2);
    expect(r1!.snapshotBytes).toBeGreaterThan(0);
    expect(r1!.blobBytes).toBe(5000);
    expect(r1!.totalBytes).toBe(r1!.snapshotBytes + 5000);

    expect(r2!.snapshotCount).toBe(1);
    expect(r2!.blobBytes).toBe(0);
    expect(r2!.totalBytes).toBe(r2!.snapshotBytes);
  });

  test("articles with no snapshots and no blobs are still listed with zeros", async () => {
    const issueId = await seedIssue();
    const a = await seedArticle(issueId, "Empty");

    const rows = await storagePerArticle({ db, snapshots }, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.articleId).toBe(a);
    expect(rows[0]!.snapshotBytes).toBe(0);
    expect(rows[0]!.snapshotCount).toBe(0);
    expect(rows[0]!.blobBytes).toBe(0);
    expect(rows[0]!.totalBytes).toBe(0);
  });

  test("issueId filter scopes to one issue", async () => {
    const issueA = await seedIssue();
    const issueB = await seedIssue();
    await seedArticle(issueA, "A1");
    await seedArticle(issueA, "A2");
    await seedArticle(issueB, "B1");

    const all = await storagePerArticle({ db, snapshots }, {});
    expect(all).toHaveLength(3);

    const onlyA = await storagePerArticle({ db, snapshots }, { issueId: issueA });
    expect(onlyA).toHaveLength(2);
    expect(onlyA.every((r) => r.issueId === issueA)).toBe(true);
  });
});
