import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import { updateAd, validatePlacement } from "../../../src/main/ipc/handlers/ad.js";

// IPC ad handlers — placement validation cases (v0.6 T15).
//
// Covers:
//  - validatePlacement allows 'cover' with null article and rejects an article
//  - validatePlacement requires an article for 'between' / 'bottom-of'
//  - validatePlacement rejects when the article doesn't exist
//  - updateAd persists structured placement, derives the legacy label,
//    and rejects invalid combinations.

let db: Kysely<Database>;
let issueId: string;

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

async function seedArticle(): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("articles")
    .values({
      id,
      issue_id: issueId,
      headline: "Host article",
      deck: null,
      byline: "Kabir",
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

async function seedAd(
  opts: {
    placementKind?: "cover" | "between" | "bottom-of";
    placementArticleId?: string | null;
    positionLabel?: string;
  } = {}
): Promise<string> {
  const id = randomUUID();
  const blobHash = "f".repeat(64);
  // Image row needs to exist before the FK insert.
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
    .onConflict((oc) => oc.column("blob_hash").doNothing())
    .execute();
  await db
    .insertInto("ads")
    .values({
      id,
      issue_id: issueId,
      slot_type: "full_page",
      position_label: opts.positionLabel ?? "Cover",
      bw_flag: 0,
      kind: "commercial",
      creative_blob_hash: blobHash,
      creative_filename: "x.jpg",
      billing_reference: null,
      placement_kind: opts.placementKind ?? "cover",
      placement_article_id: opts.placementArticleId ?? null,
      created_at: nowISO(),
    })
    .execute();
  return id;
}

beforeEach(async () => {
  db = await createDb({ filename: ":memory:" });
  issueId = await seedIssue();
});

afterEach(async () => {
  await db.destroy();
});

describe("validatePlacement", () => {
  test("cover with null article passes", async () => {
    await expect(
      validatePlacement(db, { placementKind: "cover", placementArticleId: null })
    ).resolves.toBeUndefined();
  });

  test("cover with an article id is rejected", async () => {
    const articleId = await seedArticle();
    await expect(
      validatePlacement(db, { placementKind: "cover", placementArticleId: articleId })
    ).rejects.toMatchObject({ code: "ad_placement_invalid" });
  });

  test("between requires a placement_article_id", async () => {
    await expect(
      validatePlacement(db, { placementKind: "between", placementArticleId: null })
    ).rejects.toMatchObject({ code: "ad_placement_invalid" });
  });

  test("bottom-of requires a placement_article_id", async () => {
    await expect(
      validatePlacement(db, { placementKind: "bottom-of", placementArticleId: null })
    ).rejects.toMatchObject({ code: "ad_placement_invalid" });
  });

  test("between with an unknown article id is rejected as not_found", async () => {
    await expect(
      validatePlacement(db, {
        placementKind: "between",
        placementArticleId: randomUUID(),
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  test("between with an existing article id passes", async () => {
    const articleId = await seedArticle();
    await expect(
      validatePlacement(db, { placementKind: "between", placementArticleId: articleId })
    ).resolves.toBeUndefined();
  });

  test("bottom-of with an existing article id passes", async () => {
    const articleId = await seedArticle();
    await expect(
      validatePlacement(db, { placementKind: "bottom-of", placementArticleId: articleId })
    ).resolves.toBeUndefined();
  });
});

describe("updateAd", () => {
  test("changing placement to between persists kind+article and derives label", async () => {
    const adId = await seedAd();
    const articleId = await seedArticle();

    const summary = await updateAd(
      { db },
      {
        id: adId,
        placementKind: "between",
        placementArticleId: articleId,
      }
    );

    expect(summary.placementKind).toBe("between");
    expect(summary.placementArticleId).toBe(articleId);
    expect(summary.positionLabel).toBe("Between articles");

    const row = await db
      .selectFrom("ads")
      .selectAll()
      .where("id", "=", adId)
      .executeTakeFirstOrThrow();
    expect(row.placement_kind).toBe("between");
    expect(row.placement_article_id).toBe(articleId);
    expect(row.position_label).toBe("Between articles");
  });

  test("changing placement to cover clears the article id", async () => {
    const articleId = await seedArticle();
    const adId = await seedAd({ placementKind: "between", placementArticleId: articleId });

    const summary = await updateAd(
      { db },
      { id: adId, placementKind: "cover", placementArticleId: null }
    );

    expect(summary.placementKind).toBe("cover");
    expect(summary.placementArticleId).toBeNull();
    expect(summary.positionLabel).toBe("Cover");
  });

  test("rejects an update that leaves between with no article", async () => {
    const articleId = await seedArticle();
    const adId = await seedAd({ placementKind: "cover" });

    await expect(
      updateAd({ db }, { id: adId, placementKind: "between", placementArticleId: null })
    ).rejects.toMatchObject({ code: "ad_placement_invalid" });

    // Also rejects if only the article id is cleared while kind stays
    // 'between' from a prior state.
    const id2 = await seedAd({
      placementKind: "between",
      placementArticleId: articleId,
      positionLabel: "Between articles",
    });
    await expect(updateAd({ db }, { id: id2, placementArticleId: null })).rejects.toMatchObject({
      code: "ad_placement_invalid",
    });
  });

  test("returns not_found when the ad doesn't exist", async () => {
    await expect(
      updateAd({ db }, { id: randomUUID(), placementKind: "cover", placementArticleId: null })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  test("partial updates without placement leave placement fields untouched", async () => {
    const articleId = await seedArticle();
    const adId = await seedAd({
      placementKind: "between",
      placementArticleId: articleId,
      positionLabel: "Between articles",
    });

    const summary = await updateAd({ db }, { id: adId, kind: "house" });
    expect(summary.kind).toBe("house");
    expect(summary.placementKind).toBe("between");
    expect(summary.placementArticleId).toBe(articleId);
  });
});
