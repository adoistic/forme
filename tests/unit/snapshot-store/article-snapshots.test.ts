import { describe, expect, test, beforeEach, afterEach } from "vitest";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import { createSnapshotStore, type SnapshotStore } from "../../../src/main/snapshot-store/store.js";

// v0.6 article-level snapshots — jsondiffpatch deltas keyed on block.id.
// First snapshot per article stores fallback_full; subsequent snapshots store
// delta_jsonpatch rows that walk back to the most recent fallback_full.

let db: Kysely<Database>;
let store: SnapshotStore;
let issueId: string;
let articleId: string;

function nowISO(): string {
  return new Date().toISOString();
}

interface Block {
  id: string;
  type: string;
  content: string;
}

function block(id: string, content: string, type = "paragraph"): Block {
  return { id, type, content };
}

function bodyJson(blocks: Block[]): string {
  return JSON.stringify(blocks);
}

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });
  store = createSnapshotStore(db);

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

  articleId = randomUUID();
  await db
    .insertInto("articles")
    .values({
      id: articleId,
      issue_id: issueId,
      headline: "Test Article",
      deck: null,
      byline: null,
      byline_position: "top",
      hero_placement: "below-headline",
      hero_caption: null,
      hero_credit: null,
      section: null,
      body: "[]",
      language: "en",
      word_count: 0,
      content_type: "Article",
      pull_quote: null,
      sidebar: null,
      created_at: nowISO(),
      updated_at: nowISO(),
    })
    .execute();
});

afterEach(async () => {
  await db.destroy();
});

describe("saveArticleSnapshot — fallback_full vs delta_jsonpatch", () => {
  test("first snapshot for an article is fallback_full", async () => {
    const snap = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "hello world")]));
    expect(snap.diff_status).toBe("fallback_full");
    expect(snap.article_id).toBe(articleId);
    expect(snap.size_bytes).toBeGreaterThan(0);
    expect(snap.block_schema_version).toBe(1);
    expect(snap.starred).toBe(false);
    expect(snap.label).toBeNull();
  });

  test("second snapshot stores delta_jsonpatch with smaller payload than the full body", async () => {
    const big = bodyJson(
      Array.from({ length: 20 }, (_, i) => block(`b${i}`, "lorem ipsum ".repeat(40)))
    );
    const first = await store.saveArticleSnapshot(articleId, big);
    expect(first.diff_status).toBe("fallback_full");

    // Tiny edit: change one block's content
    const updated = JSON.parse(big) as Block[];
    updated[0]!.content = "lorem ipsum changed once";
    const second = await store.saveArticleSnapshot(articleId, JSON.stringify(updated));
    expect(second.diff_status).toBe("delta_jsonpatch");
    // Delta payload should be much smaller than the full-body payload.
    expect(second.size_bytes).toBeLessThan(first.size_bytes / 4);
  });
});

describe("readArticleSnapshot — round-trip", () => {
  test("returns identical body to what was saved (single snapshot)", async () => {
    const body = bodyJson([block("b1", "alpha"), block("b2", "beta")]);
    const snap = await store.saveArticleSnapshot(articleId, body);
    const out = await store.readArticleSnapshot(snap.id);
    expect(JSON.parse(out.body)).toEqual(JSON.parse(body));
    expect(out.articleId).toBe(articleId);
    expect(out.label).toBeNull();
    expect(out.starred).toBe(false);
  });

  test("returns identical body across a 4-snapshot delta chain", async () => {
    const v1 = [block("b1", "one"), block("b2", "two")];
    const v2 = [block("b1", "ONE"), block("b2", "two")];
    const v3 = [block("b1", "ONE"), block("b2", "two"), block("b3", "three")];
    const v4 = [block("b2", "two"), block("b1", "ONE"), block("b3", "three!")];

    const s1 = await store.saveArticleSnapshot(articleId, JSON.stringify(v1));
    const s2 = await store.saveArticleSnapshot(articleId, JSON.stringify(v2));
    const s3 = await store.saveArticleSnapshot(articleId, JSON.stringify(v3));
    const s4 = await store.saveArticleSnapshot(articleId, JSON.stringify(v4));

    expect(s1.diff_status).toBe("fallback_full");
    expect(s2.diff_status).toBe("delta_jsonpatch");
    expect(s3.diff_status).toBe("delta_jsonpatch");
    expect(s4.diff_status).toBe("delta_jsonpatch");

    expect(JSON.parse((await store.readArticleSnapshot(s1.id)).body)).toEqual(v1);
    expect(JSON.parse((await store.readArticleSnapshot(s2.id)).body)).toEqual(v2);
    expect(JSON.parse((await store.readArticleSnapshot(s3.id)).body)).toEqual(v3);
    expect(JSON.parse((await store.readArticleSnapshot(s4.id)).body)).toEqual(v4);
  });
});

describe("deleteArticleSnapshot — chain integrity", () => {
  test("deleting a fallback_full snapshot in the middle breaks subsequent reads with snapshot_corrupt", async () => {
    const v1 = [block("b1", "one")];
    const v2 = [block("b1", "two")];
    const v3 = [block("b1", "three")];

    const s1 = await store.saveArticleSnapshot(articleId, JSON.stringify(v1));
    const s2 = await store.saveArticleSnapshot(articleId, JSON.stringify(v2));
    const s3 = await store.saveArticleSnapshot(articleId, JSON.stringify(v3));
    expect(s1.diff_status).toBe("fallback_full");
    expect(s2.diff_status).toBe("delta_jsonpatch");
    expect(s3.diff_status).toBe("delta_jsonpatch");

    // Removing the only fallback_full leaves s2/s3 as orphan deltas.
    await store.deleteArticleSnapshot(s1.id);

    await expect(store.readArticleSnapshot(s2.id)).rejects.toMatchObject({
      code: "snapshot_corrupt",
    });
    await expect(store.readArticleSnapshot(s3.id)).rejects.toMatchObject({
      code: "snapshot_corrupt",
    });
  });

  test("deleting a delta in the middle breaks reads of later deltas (chain corrupt)", async () => {
    const v1 = [block("b1", "one")];
    const v2 = [block("b1", "two")];
    const v3 = [block("b1", "three")];

    const s1 = await store.saveArticleSnapshot(articleId, JSON.stringify(v1));
    const s2 = await store.saveArticleSnapshot(articleId, JSON.stringify(v2));
    const s3 = await store.saveArticleSnapshot(articleId, JSON.stringify(v3));

    // The fallback_full + s3 still exist but s2's delta is gone, so v3
    // cannot be reconstructed cleanly. Reading s1 still works (it's the
    // fallback_full); reading s3 throws snapshot_corrupt because applying
    // s3's delta against v1 (skipping v2) is unsafe.
    await store.deleteArticleSnapshot(s2.id);

    const out1 = await store.readArticleSnapshot(s1.id);
    expect(JSON.parse(out1.body)).toEqual(v1);

    await expect(store.readArticleSnapshot(s3.id)).rejects.toMatchObject({
      code: "snapshot_corrupt",
    });
  });
});

describe("listArticleSnapshots", () => {
  test("returns rows ordered by created_at DESC", async () => {
    const a = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "a")]));
    await new Promise((r) => setTimeout(r, 10));
    const b = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "b")]));
    await new Promise((r) => setTimeout(r, 10));
    const c = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "c")]));

    const list = await store.listArticleSnapshots(articleId);
    expect(list.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });

  test("respects limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await store.saveArticleSnapshot(articleId, bodyJson([block("b1", `v${i}`)]));
      await new Promise((r) => setTimeout(r, 2));
    }
    const list = await store.listArticleSnapshots(articleId, 2);
    expect(list).toHaveLength(2);
  });

  test("excludes snapshots from other articles", async () => {
    const otherArticle = randomUUID();
    await db
      .insertInto("articles")
      .values({
        id: otherArticle,
        issue_id: issueId,
        headline: "Other",
        deck: null,
        byline: null,
        byline_position: "top",
        hero_placement: "below-headline",
        hero_caption: null,
        hero_credit: null,
        section: null,
        body: "[]",
        language: "en",
        word_count: 0,
        content_type: "Article",
        pull_quote: null,
        sidebar: null,
        created_at: nowISO(),
        updated_at: nowISO(),
      })
      .execute();

    await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "mine")]));
    await store.saveArticleSnapshot(otherArticle, bodyJson([block("b1", "theirs")]));

    const mine = await store.listArticleSnapshots(articleId);
    expect(mine).toHaveLength(1);
  });
});

describe("labelArticleSnapshot + starArticleSnapshot", () => {
  test("label persists and is returned by list + read", async () => {
    const snap = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "x")]));
    await store.labelArticleSnapshot(snap.id, "first draft");

    const list = await store.listArticleSnapshots(articleId);
    expect(list[0]!.label).toBe("first draft");

    const out = await store.readArticleSnapshot(snap.id);
    expect(out.label).toBe("first draft");

    // Clearing back to null also works.
    await store.labelArticleSnapshot(snap.id, null);
    const list2 = await store.listArticleSnapshots(articleId);
    expect(list2[0]!.label).toBeNull();
  });

  test("starred persists and is returned by list + read", async () => {
    const snap = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "x")]));
    expect(snap.starred).toBe(false);

    await store.starArticleSnapshot(snap.id, true);
    const list = await store.listArticleSnapshots(articleId);
    expect(list[0]!.starred).toBe(true);

    const out = await store.readArticleSnapshot(snap.id);
    expect(out.starred).toBe(true);

    await store.starArticleSnapshot(snap.id, false);
    const list2 = await store.listArticleSnapshots(articleId);
    expect(list2[0]!.starred).toBe(false);
  });

  test("save accepts label + starred via opts", async () => {
    const snap = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "x")]), {
      label: "draft",
      starred: true,
    });
    expect(snap.label).toBe("draft");
    expect(snap.starred).toBe(true);
  });
});

describe("block reorder produces a small delta", () => {
  test("pure reorder of large blocks yields delta much smaller than the full body", async () => {
    const blocks = Array.from({ length: 10 }, (_, i) =>
      block(`b${i}`, "lorem ipsum dolor sit amet ".repeat(20))
    );
    const first = await store.saveArticleSnapshot(articleId, JSON.stringify(blocks));

    // Reverse the array — same ids, same content, just re-ordered.
    const reordered = [...blocks].reverse();
    const second = await store.saveArticleSnapshot(articleId, JSON.stringify(reordered));

    expect(second.diff_status).toBe("delta_jsonpatch");
    // jsondiffpatch with objectHash:id should encode this as cheap moves.
    expect(second.size_bytes).toBeLessThan(first.size_bytes / 5);

    // Round-trip still recovers the reordered body.
    const out = await store.readArticleSnapshot(second.id);
    expect(JSON.parse(out.body)).toEqual(reordered);
  });
});

describe("edge cases", () => {
  test("empty body throws an error", async () => {
    await expect(store.saveArticleSnapshot(articleId, "")).rejects.toMatchObject({
      code: "article_snapshot_empty_body",
    });
  });

  test("readArticleSnapshot of an unknown id throws snapshot_corrupt", async () => {
    await expect(store.readArticleSnapshot(randomUUID())).rejects.toMatchObject({
      code: "snapshot_corrupt",
    });
  });

  test("readArticleSnapshot rejects an issue-level snapshot id", async () => {
    // Insert an issue-level snapshot directly.
    const id = randomUUID();
    await db
      .insertInto("snapshots")
      .values({
        id,
        issue_id: issueId,
        created_at: nowISO(),
        description: "Created issue",
        state_json: "{}",
        size_bytes: 2,
        is_full: 1,
      })
      .execute();
    await expect(store.readArticleSnapshot(id)).rejects.toMatchObject({
      code: "snapshot_corrupt",
    });
  });
});

describe("totalArticleSnapshotBytes", () => {
  test("sums size_bytes across all article snapshots and excludes issue snapshots", async () => {
    // Article snapshot
    const a = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "x")]));
    const b = await store.saveArticleSnapshot(articleId, bodyJson([block("b1", "y")]));

    // Issue snapshot — should be excluded from the sum.
    await db
      .insertInto("snapshots")
      .values({
        id: randomUUID(),
        issue_id: issueId,
        created_at: nowISO(),
        description: "Created issue",
        state_json: "{}",
        size_bytes: 9999,
        is_full: 1,
      })
      .execute();

    // Confirm the issue snapshot is really there with entity_kind=issue.
    const issueRows = await sql<{
      cnt: number;
    }>`SELECT COUNT(*) as cnt FROM snapshots WHERE entity_kind = 'issue'`.execute(db);
    expect(Number(issueRows.rows[0]!.cnt)).toBe(1);

    const total = await store.totalArticleSnapshotBytes();
    expect(total).toBe(a.size_bytes + b.size_bytes);
  });
});
