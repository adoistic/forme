import { describe, expect, test, beforeEach, afterEach } from "vitest";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import { createSnapshotStore, type SnapshotStore } from "../../../src/main/snapshot-store/store.js";
import type { SerializedIssue } from "../../../src/main/snapshot-store/types.js";

let db: Kysely<Database>;
let store: SnapshotStore;
let issueId: string;

function nowISO(): string {
  return new Date().toISOString();
}

function baseState(id: string, overrides: Partial<SerializedIssue> = {}): SerializedIssue {
  return {
    id,
    title: "Issue 1",
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
    ...overrides,
  };
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
});

afterEach(async () => {
  await db.destroy();
});

describe("SnapshotStore.save + list", () => {
  test("first save is 'Created issue'", async () => {
    const snap = await store.save(issueId, baseState(issueId, { title: "Created test" }));
    expect(snap.description).toMatch(/^Created issue "Created test"/);
    expect(snap.is_full).toBe(true);
    expect(snap.size_bytes).toBeGreaterThan(0);
  });

  test("subsequent save diff against previous", async () => {
    await store.save(issueId, baseState(issueId, { title: "v1" }));
    // Wait so created_at differs
    await new Promise((r) => setTimeout(r, 10));
    const snap = await store.save(
      issueId,
      baseState(issueId, { title: "v1", typography_pairing: "News Sans" })
    );
    expect(snap.description).toBe("Changed typography pairing to News Sans");
  });

  test("list returns newest first", async () => {
    await store.save(issueId, baseState(issueId, { title: "a" }));
    await new Promise((r) => setTimeout(r, 10));
    await store.save(issueId, baseState(issueId, { title: "b" }));
    await new Promise((r) => setTimeout(r, 10));
    await store.save(issueId, baseState(issueId, { title: "c" }));

    const list = await store.list(issueId);
    expect(list).toHaveLength(3);
    // Descending by created_at
    expect(new Date(list[0]!.created_at).getTime()).toBeGreaterThanOrEqual(
      new Date(list[1]!.created_at).getTime()
    );
  });

  test("list respects limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await store.save(issueId, baseState(issueId, { title: `v${i}` }));
      await new Promise((r) => setTimeout(r, 2));
    }
    const list = await store.list(issueId, 2);
    expect(list).toHaveLength(2);
  });

  test("count", async () => {
    expect(await store.count(issueId)).toBe(0);
    await store.save(issueId, baseState(issueId));
    await store.save(issueId, baseState(issueId));
    expect(await store.count(issueId)).toBe(2);
  });
});

describe("SnapshotStore.read", () => {
  test("round-trip preserves state", async () => {
    const original = baseState(issueId, {
      title: "Round trip",
      articles: [
        {
          id: "a1",
          headline: "Test Article",
          language: "hi",
          word_count: 500,
          content_type: "Article",
        },
      ],
    });
    const snap = await store.save(issueId, original);
    const loaded = await store.read(snap.id);
    expect(loaded).toEqual(original);
  });

  test("throws snapshot_corrupt for unknown id", async () => {
    await expect(store.read(randomUUID())).rejects.toMatchObject({
      code: "snapshot_corrupt",
    });
  });
});

describe("SnapshotStore.latest", () => {
  test("returns null when empty", async () => {
    expect(await store.latest(issueId)).toBeNull();
  });

  test("returns the most recent snapshot", async () => {
    await store.save(issueId, baseState(issueId, { title: "v1" }));
    await new Promise((r) => setTimeout(r, 10));
    await store.save(issueId, baseState(issueId, { title: "v2" }));
    const latest = await store.latest(issueId);
    expect(latest).not.toBeNull();
    const loaded = await store.read(latest!.id);
    expect(loaded.title).toBe("v2");
  });
});

describe("SnapshotStore cascade", () => {
  test("deleting an issue cascades to its snapshots", async () => {
    await store.save(issueId, baseState(issueId));
    await store.save(issueId, baseState(issueId));
    expect(await store.count(issueId)).toBe(2);

    await db.deleteFrom("issues").where("id", "=", issueId).execute();

    // With CASCADE, snapshots should be gone
    const remaining = await db
      .selectFrom("snapshots")
      .selectAll()
      .where("issue_id", "=", issueId)
      .execute();
    expect(remaining).toHaveLength(0);
  });
});
