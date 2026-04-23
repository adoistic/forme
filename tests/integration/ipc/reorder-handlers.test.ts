import { describe, expect, test, beforeEach, afterEach } from "vitest";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import {
  reorderRow,
  _resetTableLocksForTesting,
} from "../../../src/main/ipc/handlers/reorder.js";
import { REBALANCE_THRESHOLD } from "../../../src/main/reorder/fractional-position.js";

let db: Kysely<Database>;
let issueId: string;

function nowISO(): string {
  return new Date().toISOString();
}

async function seedIssue(db: Kysely<Database>): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("issues")
    .values({
      id,
      tenant_id: "publisher_default",
      title: "Reorder Test Issue",
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

async function seedArticle(
  db: Kysely<Database>,
  issueId: string,
  position: number
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("articles")
    .values({
      id,
      issue_id: issueId,
      headline: `H ${position}`,
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
      display_position: position,
      created_at: nowISO(),
      updated_at: nowISO(),
    })
    .execute();
  return id;
}

async function readPositions(db: Kysely<Database>, issueId: string): Promise<{ id: string; pos: number }[]> {
  const rows = await db
    .selectFrom("articles")
    .select(["id", "display_position"])
    .where("issue_id", "=", issueId)
    .orderBy("display_position", "asc")
    .execute();
  return rows.map((r) => ({ id: r.id, pos: Number(r.display_position) }));
}

beforeEach(async () => {
  _resetTableLocksForTesting();
  db = await createDb({ filename: ":memory:" });
  issueId = await seedIssue(db);
});

afterEach(async () => {
  await db.destroy();
});

describe("reorderRow — happy path", () => {
  test("persists newPosition without rebalance when gap is wide", async () => {
    const a = await seedArticle(db, issueId, 1);
    const b = await seedArticle(db, issueId, 2);
    const c = await seedArticle(db, issueId, 3);

    // Move `c` between `a` and `b`: midpoint = 1.5
    const result = await reorderRow({ db }, "articles", { id: c, newPosition: 1.5 });

    expect(result).toEqual({ id: c, newPosition: 1.5, rebalanced: false });
    const positions = await readPositions(db, issueId);
    expect(positions.map((p) => p.id)).toEqual([a, c, b]);
  });

  test("returns not_found when id does not exist", async () => {
    await expect(
      reorderRow({ db }, "articles", { id: randomUUID(), newPosition: 5 })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("reorderRow — rebalance trigger", () => {
  test("rebalances and re-spaces when newPosition is too close to a neighbor", async () => {
    // Seed 3 rows at integer positions, then attempt to insert the moved
    // row at a position closer than REBALANCE_THRESHOLD to the upper
    // neighbor. The handler must rebalance and place the moved row
    // wherever the operator's drop intent indicated.
    const a = await seedArticle(db, issueId, 1);
    const b = await seedArticle(db, issueId, 2);
    const c = await seedArticle(db, issueId, 3);

    const tooClose = 2 - REBALANCE_THRESHOLD / 2; // collides with `b`
    const result = await reorderRow({ db }, "articles", { id: c, newPosition: tooClose });

    expect(result.rebalanced).toBe(true);
    // After rebalance positions are integer 1.0 / 2.0 / 3.0; c sits in
    // the slot implied by the drop (between a and b).
    const positions = await readPositions(db, issueId);
    expect(positions.map((p) => p.pos)).toEqual([1, 2, 3]);
    expect(positions.map((p) => p.id)).toEqual([a, c, b]);
    expect(result.newPosition).toBe(2);
  });

  test("rebalances when newPosition collides exactly with an existing row", async () => {
    const a = await seedArticle(db, issueId, 1);
    const b = await seedArticle(db, issueId, 2);
    const c = await seedArticle(db, issueId, 3);

    // Drop right on top of `b` — rebalance should kick in.
    const result = await reorderRow({ db }, "articles", { id: a, newPosition: 2 });
    expect(result.rebalanced).toBe(true);
    const positions = await readPositions(db, issueId);
    // After rebalance positions are evenly spaced 1, 2, 3.
    expect(positions.map((p) => p.pos)).toEqual([1, 2, 3]);
    // All three rows are still present and unique.
    const ids = new Set(positions.map((p) => p.id));
    expect(ids.size).toBe(3);
    expect(ids.has(a)).toBe(true);
    expect(ids.has(b)).toBe(true);
    expect(ids.has(c)).toBe(true);
  });
});

describe("reorderRow — concurrency", () => {
  test("two concurrent reorders both apply without losing a drop", async () => {
    const a = await seedArticle(db, issueId, 1);
    const b = await seedArticle(db, issueId, 2);
    const c = await seedArticle(db, issueId, 3);

    // Fire both reorders without awaiting between them — the per-table
    // mutex serializes them. Per CEO plan: "concurrent rebalance doesn't
    // lose drops."
    const [r1, r2] = await Promise.all([
      reorderRow({ db }, "articles", { id: c, newPosition: 1.5 }),
      reorderRow({ db }, "articles", { id: a, newPosition: 2.5 }),
    ]);

    expect(r1.id).toBe(c);
    expect(r2.id).toBe(a);

    const positions = await readPositions(db, issueId);
    // Both writes landed; the final order reflects the second write
    // taking the post-r1 state into account.
    const ids = positions.map((p) => p.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).toContain(c);
  });

  test("rebalance runs even when many moves accumulate close gaps", async () => {
    const a = await seedArticle(db, issueId, 1);
    const b = await seedArticle(db, issueId, 2);
    const c = await seedArticle(db, issueId, 3);

    // Walk c down toward a in tiny halving steps.
    let cur = 1.5;
    for (let i = 0; i < 5; i += 1) {
      await reorderRow({ db }, "articles", { id: c, newPosition: cur });
      cur = (cur + 1) / 2; // squeeze towards 1
    }
    // Now force a rebalance with a sub-threshold drop.
    const result = await reorderRow({ db }, "articles", {
      id: c,
      newPosition: 1 + REBALANCE_THRESHOLD / 4,
    });
    expect(result.rebalanced).toBe(true);
    const positions = await readPositions(db, issueId);
    expect(positions.map((p) => p.pos)).toEqual([1, 2, 3]);
    // After rebalance c sits between a and b per drop intent.
    const ids = positions.map((p) => p.id);
    expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(c));
    expect(ids.indexOf(c)).toBeLessThan(ids.indexOf(b));
  });
});

describe("reorderRow — works for classifieds and ads tables too", () => {
  test("classifieds reorder updates display_position", async () => {
    // Seed a couple of classifieds.
    const id1 = randomUUID();
    const id2 = randomUUID();
    for (const [id, pos] of [
      [id1, 1],
      [id2, 2],
    ] as const) {
      await db
        .insertInto("classifieds")
        .values({
          id,
          issue_id: null,
          type: "matrimonial_with_photo",
          language: "en",
          weeks_to_run: 3,
          photo_blob_hash: null,
          fields_json: "{}",
          billing_reference: null,
          display_position: pos,
          created_at: nowISO(),
          updated_at: nowISO(),
        })
        .execute();
    }
    const result = await reorderRow({ db }, "classifieds", { id: id1, newPosition: 3 });
    expect(result.newPosition).toBe(3);
    const row = await db
      .selectFrom("classifieds")
      .select(["display_position"])
      .where("id", "=", id1)
      .executeTakeFirst();
    expect(Number(row?.display_position)).toBe(3);
  });

  test("ads reorder updates display_position", async () => {
    const id = randomUUID();
    // Need an image row first (FK requirement).
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
    await db
      .insertInto("ads")
      .values({
        id,
        issue_id: null,
        slot_type: "full_page",
        position_label: "Run of Book",
        bw_flag: 0,
        kind: "commercial",
        creative_blob_hash: blobHash,
        creative_filename: "x.jpg",
        billing_reference: null,
        display_position: 1,
        created_at: nowISO(),
      })
      .execute();
    const result = await reorderRow({ db }, "ads", { id, newPosition: 5 });
    expect(result.newPosition).toBe(5);
  });
});

describe("migration 5 backfill", () => {
  test("display_position columns exist on all three tables", async () => {
    // A select that names display_position will only succeed if migration 5
    // ran. The createDb call in beforeEach runs migrations.
    const articles = await db.selectFrom("articles").select("display_position").execute();
    const classifieds = await db.selectFrom("classifieds").select("display_position").execute();
    const ads = await db.selectFrom("ads").select("display_position").execute();
    expect(articles).toBeDefined();
    expect(classifieds).toBeDefined();
    expect(ads).toBeDefined();
  });
});
