import { describe, expect, test, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { createDb } from "../../../src/main/sqlite/db.js";
import type { Database } from "../../../src/main/sqlite/schema.js";
import { createBlobStore, type BlobStore } from "../../../src/main/blob-store/store.js";
import { createSnapshotStore, type SnapshotStore } from "../../../src/main/snapshot-store/store.js";
import { uploadHeroFile, uploadHeroUrl } from "../../../src/main/ipc/handlers/hero-upload.js";
import { setBroadcaster } from "../../../src/main/disk-usage-events.js";
import type { FetchUrlResult } from "../../../src/main/url-fetch/ssrf-guard.js";
import { makeError } from "../../../src/shared/errors/structured.js";

// Hero upload IPC handlers (T14). Verifies file/URL paths register the
// blob, link as hero, and emit disk-usage. URL path uses an injected
// fetcher stub so the SSRF guard is exercised separately.

let db: Kysely<Database>;
let blobs: BlobStore;
let snapshots: SnapshotStore;
let issueId: string;
let articleId: string;
let tmpDir: string;

function nowISO(): string {
  return new Date().toISOString();
}

async function pngBytes(): Promise<Buffer> {
  // Minimal valid PNG via sharp — small enough to keep tests fast.
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toBuffer();
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forme-hero-test-"));
  db = await createDb({ filename: ":memory:" });
  blobs = createBlobStore({ rootDir: tmpDir });
  snapshots = createSnapshotStore(db);
  setBroadcaster(() => {
    /* swallow */
  });

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
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("hero:upload-file", () => {
  test("happy path: registers image, links as hero, returns updated summary", async () => {
    const png = await pngBytes();
    const summary = await uploadHeroFile(
      { db, blobs, snapshots },
      { articleId, base64: png.toString("base64"), filename: "hero.png" }
    );

    expect(summary.id).toBe(articleId);
    expect(summary.headline).toBe("Test Article");

    const join = await db
      .selectFrom("article_images")
      .selectAll()
      .where("article_id", "=", articleId)
      .execute();
    expect(join).toHaveLength(1);
    expect(join[0]!.role).toBe("hero");

    // Image row was registered with the hero tag.
    const imageRow = await db
      .selectFrom("images")
      .selectAll()
      .where("blob_hash", "=", join[0]!.blob_hash)
      .executeTakeFirstOrThrow();
    expect(imageRow.tags_json).toContain("hero");
  });

  test("invalid base64 surfaces an ingest error", async () => {
    // Empty buffer triggers `corrupt_image` in ingestImage.
    await expect(
      uploadHeroFile({ db, blobs, snapshots }, { articleId, base64: "", filename: "broken.png" })
    ).rejects.toMatchObject({ code: "corrupt_image" });

    // No join row was created
    const join = await db
      .selectFrom("article_images")
      .selectAll()
      .where("article_id", "=", articleId)
      .execute();
    expect(join).toHaveLength(0);
  });

  test("missing article id throws not_found", async () => {
    const png = await pngBytes();
    await expect(
      uploadHeroFile(
        { db, blobs, snapshots },
        {
          articleId: randomUUID(),
          base64: png.toString("base64"),
          filename: "hero.png",
        }
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  test("uploading a second hero replaces the first", async () => {
    const png1 = await pngBytes();
    await uploadHeroFile(
      { db, blobs, snapshots },
      { articleId, base64: png1.toString("base64"), filename: "first.png" }
    );

    const png2 = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await uploadHeroFile(
      { db, blobs, snapshots },
      { articleId, base64: png2.toString("base64"), filename: "second.png" }
    );

    const heroJoins = await db
      .selectFrom("article_images")
      .selectAll()
      .where("article_id", "=", articleId)
      .where("role", "=", "hero")
      .execute();
    expect(heroJoins).toHaveLength(1);
  });
});

describe("hero:upload-url", () => {
  test("happy path: SSRF guard fetcher is called, image is registered as hero", async () => {
    const png = await pngBytes();
    const fakeFetcher = async (): Promise<FetchUrlResult> => ({
      bytes: png,
      contentType: "image/png",
      filename: "remote-hero.png",
    });

    const summary = await uploadHeroUrl(
      { db, blobs, snapshots },
      { articleId, url: "https://cdn.example.com/photo.png" },
      fakeFetcher
    );
    expect(summary.id).toBe(articleId);

    const join = await db
      .selectFrom("article_images")
      .selectAll()
      .where("article_id", "=", articleId)
      .execute();
    expect(join).toHaveLength(1);
    expect(join[0]!.role).toBe("hero");

    // Filename came from the fetcher result, not the URL caller.
    const imageRow = await db
      .selectFrom("images")
      .selectAll()
      .where("blob_hash", "=", join[0]!.blob_hash)
      .executeTakeFirstOrThrow();
    expect(imageRow.filename).toBe("remote-hero.png");
  });

  test("private IP rejection surfaces url_private_address", async () => {
    const fakeFetcher = async (): Promise<FetchUrlResult> => {
      throw makeError("url_private_address", "error", {
        url: "http://10.0.0.1/x.png",
        address: "10.0.0.1",
      });
    };
    await expect(
      uploadHeroUrl(
        { db, blobs, snapshots },
        { articleId, url: "http://10.0.0.1/x.png" },
        fakeFetcher
      )
    ).rejects.toMatchObject({ code: "url_private_address" });

    // No image was added.
    const join = await db
      .selectFrom("article_images")
      .selectAll()
      .where("article_id", "=", articleId)
      .execute();
    expect(join).toHaveLength(0);
  });

  test("non-image content surfaces url_not_image", async () => {
    const fakeFetcher = async (): Promise<FetchUrlResult> => {
      throw makeError("url_not_image", "error", { contentType: "text/html" });
    };
    await expect(
      uploadHeroUrl(
        { db, blobs, snapshots },
        { articleId, url: "https://example.com/index.html" },
        fakeFetcher
      )
    ).rejects.toMatchObject({ code: "url_not_image" });
  });
});
