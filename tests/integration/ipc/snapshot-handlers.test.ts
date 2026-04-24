import { describe, expect, test, beforeEach, afterEach } from "vitest";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import { createSnapshotStore, type SnapshotStore } from "../../../src/main/snapshot-store/store.js";
import {
  listSnapshots,
  readSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  labelSnapshot,
  starSnapshot,
  totalBytes,
  listIssueSnapshots,
  readIssueSnapshot,
} from "../../../src/main/ipc/handlers/snapshot.js";
import { updateArticle, deleteArticle } from "../../../src/main/ipc/handlers/article.js";
import { setBroadcaster, type Broadcaster } from "../../../src/main/disk-usage-events.js";
import type { DiskUsageSnapshot } from "../../../src/shared/ipc-contracts/channels.js";

let db: Kysely<Database>;
let snapshots: SnapshotStore;
let issueId: string;
let articleId: string;
let broadcasts: DiskUsageSnapshot[];

function nowISO(): string {
  return new Date().toISOString();
}

function bodyJson(blocks: { id: string; type: string; content: string }[]): string {
  return JSON.stringify(blocks);
}

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });
  snapshots = createSnapshotStore(db);

  broadcasts = [];
  const captureBroadcaster: Broadcaster = (usage) => {
    broadcasts.push(usage);
  };
  setBroadcaster(captureBroadcaster);

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
});

afterEach(async () => {
  setBroadcaster(null);
  await db.destroy();
});

describe("article:update with body", () => {
  test("writes a snapshot, returns ArticleSummary with body", async () => {
    const newBody = bodyJson([{ id: "b1", type: "paragraph", content: "hello" }]);
    const summary = await updateArticle(
      { db, snapshots },
      { id: articleId, body: newBody, bodyFormat: "blocks" }
    );

    expect(summary.id).toBe(articleId);
    expect(summary.body).toBe(newBody);
    expect(summary.bodyFormat).toBe("blocks");
    expect(summary.snapshotWarning).toBeUndefined();

    const list = await snapshots.listArticleSnapshots(articleId);
    expect(list).toHaveLength(1);
  });

  test("rejects empty body with article_body_required", async () => {
    await expect(
      updateArticle({ db, snapshots }, { id: articleId, body: "   " })
    ).rejects.toMatchObject({ code: "article_body_required" });
    // Body unchanged in DB
    const row = await db
      .selectFrom("articles")
      .select(["body"])
      .where("id", "=", articleId)
      .executeTakeFirst();
    expect(row?.body).toBe("[]");
  });

  test("snapshot failure surfaces snapshotWarning, body still saved", async () => {
    // Force snapshots.saveArticleSnapshot to throw.
    const stubStore: SnapshotStore = {
      ...snapshots,
      saveArticleSnapshot: async () => {
        throw new Error("disk full");
      },
    };
    const newBody = bodyJson([{ id: "b1", type: "paragraph", content: "after" }]);
    const summary = await updateArticle(
      { db, snapshots: stubStore },
      { id: articleId, body: newBody, bodyFormat: "blocks" }
    );
    expect(summary.body).toBe(newBody);
    expect(summary.snapshotWarning).toMatch(/snapshot/i);
  });
});

describe("article:delete", () => {
  test("cascades: article + its snapshots gone", async () => {
    // Seed a couple of article snapshots.
    await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "x" }])
    );
    await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "y" }])
    );
    expect(await snapshots.listArticleSnapshots(articleId)).toHaveLength(2);

    const result = await deleteArticle({ db, snapshots }, { id: articleId });
    expect(result).toEqual({ id: articleId, deleted: true });

    const articleRow = await db
      .selectFrom("articles")
      .selectAll()
      .where("id", "=", articleId)
      .executeTakeFirst();
    expect(articleRow).toBeUndefined();

    expect(await snapshots.listArticleSnapshots(articleId)).toHaveLength(0);

    // disk-usage-changed fired
    expect(broadcasts.length).toBeGreaterThan(0);
  });

  test("missing id throws not_found", async () => {
    await expect(deleteArticle({ db, snapshots }, { id: randomUUID() })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("snapshot:list", () => {
  test("returns ordered article snapshots, newest first", async () => {
    const a = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "a" }])
    );
    await new Promise((r) => setTimeout(r, 5));
    const b = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "b" }])
    );
    const out = await listSnapshots({ db, snapshots }, { articleId });
    expect(out.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(out[0]!.articleId).toBe(articleId);
    expect(out[0]!.sizeBytes).toBeGreaterThan(0);
    expect(out[0]!.blockSchemaVersion).toBe(1);
  });
});

describe("snapshot:read", () => {
  test("returns body + metadata", async () => {
    const snap = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "hi" }]),
      { label: "draft" }
    );
    const out = await readSnapshot({ db, snapshots }, { snapshotId: snap.id });
    expect(out.articleId).toBe(articleId);
    expect(out.label).toBe("draft");
    expect(out.starred).toBe(false);
    expect(JSON.parse(out.body)).toEqual([{ id: "b1", type: "p", content: "hi" }]);
  });
});

describe("snapshot:restore — happy path", () => {
  test("writes before-snapshot, updates body, writes after-snapshot, emits event", async () => {
    // Write snapshot v1, then change to v2 (without snapshot), then restore v1.
    const v1 = bodyJson([{ id: "b1", type: "p", content: "version one" }]);
    const v1Snap = await snapshots.saveArticleSnapshot(articleId, v1);

    // Mutate body directly (simulate a later edit) without writing a snapshot.
    await db
      .updateTable("articles")
      .set({ body: bodyJson([{ id: "b1", type: "p", content: "now v2" }]), body_format: "blocks" })
      .where("id", "=", articleId)
      .execute();

    broadcasts.length = 0;

    const summary = await restoreSnapshot({ db, snapshots }, { snapshotId: v1Snap.id });
    expect(summary.id).toBe(articleId);
    expect(summary.body).toBe(v1);
    expect(summary.bodyFormat).toBe("blocks");

    const list = await snapshots.listArticleSnapshots(articleId);
    // 1 original + before-restore + after-restore
    expect(list).toHaveLength(3);
    const labels = list.map((s) => s.label);
    expect(labels).toContain("before-restore");
    expect(labels.some((l) => l?.startsWith("restored from"))).toBe(true);

    // disk-usage-changed fired at the end
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });
});

describe("snapshot:restore — stale", () => {
  test("throws snapshot_stale when the snapshot id is unknown", async () => {
    await expect(
      restoreSnapshot({ db, snapshots }, { snapshotId: randomUUID() })
    ).rejects.toMatchObject({ code: "snapshot_stale" });
  });
});

describe("snapshot:restore — transactional rollback", () => {
  test("if before-snapshot fails, body is unchanged", async () => {
    const v1 = bodyJson([{ id: "b1", type: "p", content: "one" }]);
    const v1Snap = await snapshots.saveArticleSnapshot(articleId, v1);

    // Set the article to a known v2 body BEFORE the restore.
    const v2 = bodyJson([{ id: "b1", type: "p", content: "two" }]);
    await db
      .updateTable("articles")
      .set({ body: v2, body_format: "blocks" })
      .where("id", "=", articleId)
      .execute();

    // Inject a tx-snapshot-store factory that always throws on
    // saveArticleSnapshot. The trx then rolls back the body update.
    const failingFactory = (): SnapshotStore => ({
      ...snapshots,
      saveArticleSnapshot: async () => {
        throw new Error("disk full mid-restore");
      },
    });

    await expect(
      restoreSnapshot(
        { db, snapshots, createSnapshotStore: failingFactory },
        { snapshotId: v1Snap.id }
      )
    ).rejects.toThrow();

    // Body must still be v2 (rollback happened)
    const after = await db
      .selectFrom("articles")
      .select(["body"])
      .where("id", "=", articleId)
      .executeTakeFirst();
    expect(after?.body).toBe(v2);
  });
});

describe("snapshot:delete", () => {
  test("removes the row, emits event", async () => {
    const snap = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "delete me" }])
    );
    broadcasts.length = 0;
    const result = await deleteSnapshot({ db, snapshots }, { snapshotId: snap.id });
    expect(result).toEqual({ snapshotId: snap.id, deleted: true });
    const list = await snapshots.listArticleSnapshots(articleId);
    expect(list).toHaveLength(0);
    expect(broadcasts.length).toBe(1);
  });
});

describe("snapshot:label + snapshot:star", () => {
  test("label persists and is returned", async () => {
    const snap = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "x" }])
    );
    const out = await labelSnapshot({ db, snapshots }, { snapshotId: snap.id, label: "approved" });
    expect(out.id).toBe(snap.id);
    expect(out.label).toBe("approved");

    const list = await snapshots.listArticleSnapshots(articleId);
    expect(list[0]!.label).toBe("approved");
  });

  test("star persists and is returned", async () => {
    const snap = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "x" }])
    );
    const out = await starSnapshot({ db, snapshots }, { snapshotId: snap.id, starred: true });
    expect(out.starred).toBe(true);

    const list = await snapshots.listArticleSnapshots(articleId);
    expect(list[0]!.starred).toBe(true);
  });
});

describe("snapshot:totalBytes", () => {
  test("returns { snapshots, blobs, total }", async () => {
    await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "a body" }])
    );
    // Add an image row so blobs has nonzero size.
    await db
      .insertInto("images")
      .values({
        blob_hash: "deadbeef".repeat(8),
        filename: "x.jpg",
        mime_type: "image/jpeg",
        width: 100,
        height: 100,
        dpi: 300,
        color_mode: "rgb",
        size_bytes: 12345,
        imported_at: nowISO(),
        tags_json: null,
      })
      .execute();

    const out = await totalBytes({ db, snapshots });
    expect(out.snapshots).toBeGreaterThan(0);
    expect(out.blobs).toBe(12345);
    expect(out.total).toBe(out.snapshots + out.blobs);
  });
});

describe("issue-snapshot:list", () => {
  test("returns issue snapshots newest-first with description", async () => {
    // Drive a couple of issue saves through the store. The shared store
    // already writes the description, sizes and ordering — the handler
    // is a thin projection over it.
    await snapshots.save(issueId, {
      id: issueId,
      title: "Test Issue",
      issue_number: 1,
      issue_date: "2026-04-21",
      page_size: "A4",
      typography_pairing: "Editorial Serif",
      primary_language: "en",
      bw_mode: false,
      articles: [],
      classifieds: [],
      ads: [],
      placements: [],
      updated_at: nowISO(),
    });
    await new Promise((r) => setTimeout(r, 5));
    await snapshots.save(issueId, {
      id: issueId,
      title: "Test Issue",
      issue_number: 1,
      issue_date: "2026-04-21",
      page_size: "A4",
      typography_pairing: "News Sans",
      primary_language: "en",
      bw_mode: false,
      articles: [],
      classifieds: [],
      ads: [],
      placements: [],
      updated_at: nowISO(),
    });

    const out = await listIssueSnapshots({ db, snapshots }, { issueId });
    expect(out).toHaveLength(2);
    // Newest first
    expect(out[0]!.description).toMatch(/typography pairing/);
    expect(out[0]!.issueId).toBe(issueId);
    expect(out[0]!.sizeBytes).toBeGreaterThan(0);
    // Article-level snapshots in the same table must NOT appear here.
    await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "x" }])
    );
    const stillIssueOnly = await listIssueSnapshots({ db, snapshots }, { issueId });
    expect(stillIssueOnly).toHaveLength(2);
  });
});

describe("issue-snapshot:read", () => {
  test("returns the title + per-collection counts + headlines for the snapshot", async () => {
    await snapshots.save(issueId, {
      id: issueId,
      title: "Test Issue",
      issue_number: 47,
      issue_date: "2026-04-21",
      page_size: "A4",
      typography_pairing: "Editorial Serif",
      primary_language: "en",
      bw_mode: false,
      articles: [
        {
          id: "a1",
          headline: "Modi visits Delhi",
          language: "en",
          word_count: 500,
          content_type: "Article",
        },
        {
          id: "a2",
          headline: "India's future",
          language: "en",
          word_count: 700,
          content_type: "Article",
        },
      ],
      classifieds: [
        { id: "c1", type: "matrimonial", language: "en", weeks_to_run: 1 },
        { id: "c2", type: "obituary", language: "en", weeks_to_run: 2 },
      ],
      ads: [{ id: "ad1", slot_type: "quarter", position_label: "p3", creative_filename: "x.jpg" }],
      placements: [],
      updated_at: nowISO(),
    });

    const list = await listIssueSnapshots({ db, snapshots }, { issueId });
    expect(list).toHaveLength(1);
    const preview = await readIssueSnapshot({ db, snapshots }, { snapshotId: list[0]!.id });
    expect(preview.title).toBe("Test Issue");
    expect(preview.issueNumber).toBe(47);
    expect(preview.articleCount).toBe(2);
    expect(preview.classifiedCount).toBe(2);
    expect(preview.adCount).toBe(1);
    expect(preview.articleHeadlines).toEqual(["Modi visits Delhi", "India's future"]);
    expect(preview.description).toMatch(/Created issue/);
  });

  test("rejects when the snapshotId points at an article snapshot", async () => {
    const snap = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "x" }])
    );
    await expect(
      readIssueSnapshot({ db, snapshots }, { snapshotId: snap.id })
    ).rejects.toMatchObject({ code: "snapshot_corrupt" });
  });
});

describe("disk-usage-changed event", () => {
  test("fires after each mutating handler", async () => {
    broadcasts.length = 0;

    // article:update with body
    await updateArticle(
      { db, snapshots },
      {
        id: articleId,
        body: bodyJson([{ id: "b1", type: "p", content: "first" }]),
        bodyFormat: "blocks",
      }
    );
    expect(broadcasts.length).toBe(1);

    // snapshot:delete
    const snap = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "second" }])
    );
    broadcasts.length = 0;
    await deleteSnapshot({ db, snapshots }, { snapshotId: snap.id });
    expect(broadcasts.length).toBe(1);

    // snapshot:restore
    const snap2 = await snapshots.saveArticleSnapshot(
      articleId,
      bodyJson([{ id: "b1", type: "p", content: "third" }])
    );
    broadcasts.length = 0;
    await restoreSnapshot({ db, snapshots }, { snapshotId: snap2.id });
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);

    // article:delete
    broadcasts.length = 0;
    await deleteArticle({ db, snapshots }, { id: articleId });
    expect(broadcasts.length).toBe(1);
  });
});
