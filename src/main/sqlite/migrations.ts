import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "./schema.js";

// Hand-rolled migrations. Simple numbered list.
// kysely-ctl integration is a Phase 0 stretch goal; for now we run migrations
// at DB open and track state in PRAGMA user_version.

export interface Migration {
  version: number;
  name: string;
  up: (db: Kysely<Database>) => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    async up(db) {
      // Enable foreign keys for every connection
      await sql`PRAGMA foreign_keys = ON`.execute(db);

      // Publisher profile (singleton per tenant)
      await db.schema
        .createTable("publisher_profile")
        .ifNotExists()
        .addColumn("tenant_id", "text", (col) => col.primaryKey())
        .addColumn("publication_name", "text")
        .addColumn("masthead_blob_hash", "text")
        .addColumn("accent_color", "text")
        .addColumn("typography_pairing_default", "text")
        .addColumn("primary_language_default", "text", (col) => col.notNull().defaultTo("en"))
        .addColumn("page_size_default", "text", (col) => col.notNull().defaultTo("A4"))
        .addColumn("issue_cadence", "text")
        .addColumn("printer_contact", "text")
        .addColumn("printer_delivery_method", "text")
        .addColumn("ad_position_labels_json", "text")
        .addColumn("classifieds_billing_label", "text", (col) =>
          col.notNull().defaultTo("Billing Ref")
        )
        .addColumn("created_at", "text", (col) => col.notNull())
        .addColumn("updated_at", "text", (col) => col.notNull())
        .execute();

      // Issues
      await db.schema
        .createTable("issues")
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("tenant_id", "text", (col) => col.notNull().defaultTo("publisher_default"))
        .addColumn("title", "text", (col) => col.notNull())
        .addColumn("issue_number", "integer")
        .addColumn("issue_date", "text", (col) => col.notNull())
        .addColumn("page_size", "text", (col) => col.notNull())
        .addColumn("typography_pairing", "text", (col) =>
          col.notNull().defaultTo("Editorial Serif")
        )
        .addColumn("primary_language", "text", (col) => col.notNull().defaultTo("en"))
        .addColumn("bw_mode", "integer", (col) => col.notNull().defaultTo(0))
        .addColumn("created_at", "text", (col) => col.notNull())
        .addColumn("updated_at", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("idx_issues_tenant")
        .ifNotExists()
        .on("issues")
        .column("tenant_id")
        .execute();

      // Images (registered blobs + metadata)
      await db.schema
        .createTable("images")
        .ifNotExists()
        .addColumn("blob_hash", "text", (col) => col.primaryKey())
        .addColumn("filename", "text", (col) => col.notNull())
        .addColumn("mime_type", "text", (col) => col.notNull())
        .addColumn("width", "integer", (col) => col.notNull())
        .addColumn("height", "integer", (col) => col.notNull())
        .addColumn("dpi", "integer", (col) => col.notNull())
        .addColumn("color_mode", "text", (col) => col.notNull())
        .addColumn("size_bytes", "integer", (col) => col.notNull())
        .addColumn("imported_at", "text", (col) => col.notNull())
        .addColumn("tags_json", "text")
        .execute();

      // Articles
      await db.schema
        .createTable("articles")
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("issue_id", "text", (col) =>
          col.notNull().references("issues.id").onDelete("cascade")
        )
        .addColumn("headline", "text", (col) => col.notNull())
        .addColumn("deck", "text")
        .addColumn("byline", "text")
        .addColumn("body", "text", (col) => col.notNull())
        .addColumn("language", "text", (col) => col.notNull())
        .addColumn("word_count", "integer", (col) => col.notNull())
        .addColumn("content_type", "text", (col) => col.notNull())
        .addColumn("pull_quote", "text")
        .addColumn("sidebar", "text")
        .addColumn("created_at", "text", (col) => col.notNull())
        .addColumn("updated_at", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("idx_articles_issue")
        .ifNotExists()
        .on("articles")
        .column("issue_id")
        .execute();

      // Article-image join
      await db.schema
        .createTable("article_images")
        .ifNotExists()
        .addColumn("article_id", "text", (col) =>
          col.notNull().references("articles.id").onDelete("cascade")
        )
        .addColumn("blob_hash", "text", (col) =>
          col.notNull().references("images.blob_hash").onDelete("restrict")
        )
        .addColumn("position", "integer", (col) => col.notNull())
        .addColumn("caption", "text")
        .addColumn("role", "text", (col) => col.notNull().defaultTo("inline"))
        .addPrimaryKeyConstraint("article_images_pk", ["article_id", "blob_hash", "position"])
        .execute();

      // Placements
      await db.schema
        .createTable("placements")
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("issue_id", "text", (col) =>
          col.notNull().references("issues.id").onDelete("cascade")
        )
        .addColumn("page_number", "integer", (col) => col.notNull())
        .addColumn("slot_index", "integer", (col) => col.notNull().defaultTo(0))
        .addColumn("template_id", "text", (col) => col.notNull())
        .addColumn("content_kind", "text", (col) => col.notNull())
        .addColumn("article_id", "text", (col) =>
          col.references("articles.id").onDelete("set null")
        )
        .addColumn("ad_id", "text")
        .addColumn("exposed_settings_json", "text", (col) => col.notNull().defaultTo("{}"))
        .addColumn("created_at", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("idx_placements_issue_page")
        .ifNotExists()
        .on("placements")
        .columns(["issue_id", "page_number", "slot_index"])
        .execute();

      // Classifieds
      await db.schema
        .createTable("classifieds")
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("issue_id", "text", (col) => col.references("issues.id").onDelete("set null"))
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("language", "text", (col) => col.notNull().defaultTo("en"))
        .addColumn("weeks_to_run", "integer", (col) => col.notNull().defaultTo(1))
        .addColumn("photo_blob_hash", "text")
        .addColumn("fields_json", "text", (col) => col.notNull())
        .addColumn("billing_reference", "text")
        .addColumn("created_at", "text", (col) => col.notNull())
        .addColumn("updated_at", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("idx_classifieds_type_weeks")
        .ifNotExists()
        .on("classifieds")
        .columns(["type", "weeks_to_run"])
        .execute();

      // Ads
      await db.schema
        .createTable("ads")
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("issue_id", "text", (col) => col.references("issues.id").onDelete("set null"))
        .addColumn("slot_type", "text", (col) => col.notNull())
        .addColumn("position_label", "text", (col) => col.notNull())
        .addColumn("bw_flag", "integer", (col) => col.notNull().defaultTo(0))
        .addColumn("kind", "text", (col) => col.notNull().defaultTo("commercial"))
        .addColumn("creative_blob_hash", "text", (col) =>
          col.notNull().references("images.blob_hash").onDelete("restrict")
        )
        .addColumn("creative_filename", "text", (col) => col.notNull())
        .addColumn("billing_reference", "text")
        .addColumn("created_at", "text", (col) => col.notNull())
        .execute();

      // Snapshots
      await db.schema
        .createTable("snapshots")
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("issue_id", "text", (col) =>
          col.notNull().references("issues.id").onDelete("cascade")
        )
        .addColumn("created_at", "text", (col) => col.notNull())
        .addColumn("description", "text", (col) => col.notNull())
        .addColumn("state_json", "text", (col) => col.notNull())
        .addColumn("size_bytes", "integer", (col) => col.notNull())
        .addColumn("is_full", "integer", (col) => col.notNull().defaultTo(1))
        .execute();

      await db.schema
        .createIndex("idx_snapshots_issue_time")
        .ifNotExists()
        .on("snapshots")
        .columns(["issue_id", "created_at"])
        .execute();
    },
  },
  {
    version: 2,
    name: "add_byline_position",
    async up(db) {
      // byline_position lets editorials + wire-credited pieces print the
      // author at the end of the article instead of below the deck.
      await sql`ALTER TABLE articles ADD COLUMN byline_position TEXT NOT NULL DEFAULT 'top'`.execute(
        db
      );
    },
  },
  {
    version: 3,
    name: "add_article_hero_metadata",
    async up(db) {
      // Hero image placement, caption, photographer credit — operator-
      // editable from the article edit modal. hero_placement governs
      // whether the hero sits below the headline (default), above it
      // (image-led photo essay), or fills the page edge-to-edge.
      await sql`ALTER TABLE articles ADD COLUMN hero_placement TEXT NOT NULL DEFAULT 'below-headline'`.execute(
        db
      );
      await sql`ALTER TABLE articles ADD COLUMN hero_caption TEXT`.execute(db);
      await sql`ALTER TABLE articles ADD COLUMN hero_credit TEXT`.execute(db);
      await sql`ALTER TABLE articles ADD COLUMN section TEXT`.execute(db);
    },
  },
  {
    version: 4,
    name: "article_snapshots_and_body_format",
    async up(db) {
      // v0.6 Article Edit History (CEO plan decision 1A): the existing
      // snapshots table holds issue-level snapshots only. Extend it
      // additively so it can also hold per-article snapshots without
      // touching existing rows. Existing rows take entity_kind='issue'
      // via the column default; article_id stays NULL for them.
      await sql`ALTER TABLE snapshots ADD COLUMN article_id TEXT REFERENCES articles(id) ON DELETE CASCADE`.execute(
        db
      );
      await sql`ALTER TABLE snapshots ADD COLUMN entity_kind TEXT NOT NULL DEFAULT 'issue'`.execute(
        db
      );
      await sql`ALTER TABLE snapshots ADD COLUMN label TEXT`.execute(db);
      await sql`ALTER TABLE snapshots ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`.execute(db);
      await sql`ALTER TABLE snapshots ADD COLUMN diff_status TEXT`.execute(db);
      await sql`ALTER TABLE snapshots ADD COLUMN block_schema_version INTEGER NOT NULL DEFAULT 1`.execute(
        db
      );

      // Per-article timeline queries: list snapshots for an article in
      // reverse chronological order. Index supports both filter + sort.
      await db.schema
        .createIndex("idx_snapshots_article_time")
        .ifNotExists()
        .on("snapshots")
        .columns(["article_id", "created_at desc"])
        .execute();

      // body_format tracks the on-disk format of articles.body so v0.6
      // can lazy-migrate v0.5 plain-text articles to block format on
      // first open (per ER2 task T5). Existing rows stay 'plain'.
      await sql`ALTER TABLE articles ADD COLUMN body_format TEXT NOT NULL DEFAULT 'plain'`.execute(
        db
      );

      // app_settings is a generic key/value store for operator-level
      // preferences (e.g. dismissed banners, persisted UI flags). It may
      // already exist if a prior dev branch created it; create-if-not-
      // exists keeps this idempotent.
      await db.schema
        .createTable("app_settings")
        .ifNotExists()
        .addColumn("key", "text", (col) => col.primaryKey())
        .addColumn("value", "text")
        .addColumn("updated_at", "text", (col) => col.notNull())
        .execute();
    },
  },
  {
    version: 5,
    name: "display_position_for_reorder",
    async up(db) {
      // v0.6 T13: replace order-by-created_at with operator-controlled
      // order on the Articles, Classifieds, and Ads lists. Use a fractional
      // REAL position so reorder writes are O(1) — no shifting neighbors.
      // Backfill existing rows by issuing 1.0, 2.0, 3.0, ... in created_at
      // ASC order so existing lists keep the order operators saw before
      // the migration ran.
      for (const table of ["articles", "classifieds", "ads"] as const) {
        await sql
          .raw(`ALTER TABLE ${table} ADD COLUMN display_position REAL NOT NULL DEFAULT 0`)
          .execute(db);
        // Backfill: ROW_NUMBER() over created_at gives us a 1-based dense
        // ordering that matches the previous "order by created_at" UI.
        await sql
          .raw(
            `UPDATE ${table} SET display_position = (
             SELECT rn * 1.0 FROM (
               SELECT id AS _id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
               FROM ${table}
             ) WHERE _id = ${table}.id
           )`
          )
          .execute(db);
        await db.schema
          .createIndex(`idx_${table}_display_position`)
          .ifNotExists()
          .on(table)
          .column("display_position")
          .execute();
      }
    },
  },
  {
    version: 6,
    name: "structured_ad_placement",
    async up(db) {
      // v0.6 T15: replace the free-text `position_label` with a structured
      // pair (placement_kind, placement_article_id). CEO plan 4F + the
      // design-shotgun 7A decision. Additive only — `position_label` stays
      // for rollback safety and continues to drive the legacy export path
      // until the column is removed in a follow-up migration.
      //
      // placement_kind values:
      //   'cover'      → full-page cover or section opener; placement_article_id NULL
      //   'between'    → runs between two articles; placement_article_id = article it follows
      //   'bottom-of'  → tucks under one article; placement_article_id = host article
      await sql`ALTER TABLE ads ADD COLUMN placement_kind TEXT NOT NULL DEFAULT 'cover'`.execute(
        db
      );
      // ON DELETE SET NULL keeps the ad row alive when the host article
      // disappears; the operator then re-targets via the Ads screen. The
      // index supports the SET NULL scan plus future "ads on this article"
      // queries from the Issue Board.
      await sql`ALTER TABLE ads ADD COLUMN placement_article_id TEXT NULL REFERENCES articles(id) ON DELETE SET NULL`.execute(
        db
      );
      await db.schema
        .createIndex("idx_ads_placement_article")
        .ifNotExists()
        .on("ads")
        .column("placement_article_id")
        .execute();
    },
  },
];

export async function runMigrations(db: Kysely<Database>): Promise<{ applied: number[] }> {
  const current = await getUserVersion(db);
  const toApply = MIGRATIONS.filter((m) => m.version > current);
  const applied: number[] = [];

  for (const migration of toApply) {
    await migration.up(db);
    await setUserVersion(db, migration.version);
    applied.push(migration.version);
  }

  return { applied };
}

async function getUserVersion(db: Kysely<Database>): Promise<number> {
  const result = await sql<{ user_version: number }>`PRAGMA user_version`.execute(db);
  const firstRow = result.rows[0];
  return firstRow ? Number(firstRow.user_version) : 0;
}

async function setUserVersion(db: Kysely<Database>, v: number): Promise<void> {
  await sql.raw(`PRAGMA user_version = ${v}`).execute(db);
}

/** For tests + kysely-ctl integration later. */
export const allMigrations = MIGRATIONS;
