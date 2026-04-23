// Lazy migration of v0.5 plain-text article bodies to BlockNote JSON.
// Per CEO plan §9A: when the operator opens a v0.5 article in v0.6 for the
// first time, transparently convert the plain-text body into BlockNote
// document JSON, persist `body_format='blocks'`, and write a JSONL backup
// line BEFORE the conversion so the operation is reversible.
//
// The function is idempotent: a second call is a no-op because
// `body_format` is now `'blocks'`.

import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import type { Kysely } from "kysely";
import type { Database } from "../sqlite/schema.js";

export type BodyFormat = "plain" | "markdown" | "blocks";

export interface BlocknoteMigrationResult {
  /** True if conversion ran. False if the article was already in a non-plain format. */
  migrated: boolean;
  fromFormat: BodyFormat;
  toFormat: BodyFormat;
  /** Absolute path to the JSONL backup file. Null when no migration ran. */
  backupPath: string | null;
}

interface BackupLine {
  timestamp: string;
  articleId: string;
  issueId: string;
  headline: string;
  body: string;
  bodyFormat: "plain";
}

// Resolve the directory that holds the JSONL backup. In production this
// lives under Electron's userData; tests inject `backupDir` directly so the
// migration can be exercised without bootstrapping electron.
async function resolveBackupDir(backupDir: string | undefined): Promise<string> {
  if (backupDir) return backupDir;
  // Lazy require so this module remains import-safe outside Electron (tests).
  const electron = (await import("electron")) as { app?: { getPath(name: string): string } };
  const userData = electron.app?.getPath("userData");
  if (!userData) {
    throw new Error(
      "blocknote-migration: app.getPath('userData') unavailable; pass backupDir explicitly"
    );
  }
  return path.join(userData, "migrations");
}

/**
 * Convert plain text into BlockNote document JSON shape. Mirrors
 * `deserializeToBlocks` in `src/renderer/components/article-body-editor/
 * ArticleBodyEditor.tsx` for the "plain" branch — paragraph splitting on
 * `\n{2,}`, trim each, drop empty. Empty input yields a single empty
 * paragraph block so the editor has a cursor to render.
 */
function plainToBlocks(text: string): unknown[] {
  const trimmed = text ?? "";
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return [
      {
        id: randomUUID(),
        type: "paragraph",
        content: [],
      },
    ];
  }

  return paragraphs.map((paragraph) => ({
    id: randomUUID(),
    type: "paragraph",
    content: [{ type: "text", text: paragraph, styles: {} }],
  }));
}

/**
 * Migrate a single article from v0.5 plain-text body to BlockNote JSON.
 * Idempotent: if `body_format !== 'plain'` the function returns
 * `{ migrated: false }` without touching the DB or filesystem.
 *
 * Migration order:
 *   1. Read article (returns false if not 'plain').
 *   2. Convert body → BlockNote blocks.
 *   3. Append JSONL backup line BEFORE the DB update so the operation is
 *      reversible from disk.
 *   4. Update articles.body + body_format inside a transaction so the two
 *      column writes are atomic.
 */
export async function migrateArticleToBlocknote(
  db: Kysely<Database>,
  articleId: string,
  opts?: { backupDir?: string }
): Promise<BlocknoteMigrationResult> {
  const row = await db
    .selectFrom("articles")
    .select(["id", "issue_id", "headline", "body", "body_format"])
    .where("id", "=", articleId)
    .executeTakeFirst();

  if (!row) {
    throw new Error(`migrateArticleToBlocknote: article not found (id=${articleId})`);
  }

  const fromFormat = (row.body_format ?? "plain") as BodyFormat;
  if (fromFormat !== "plain") {
    return { migrated: false, fromFormat, toFormat: fromFormat, backupPath: null };
  }

  const blocks = plainToBlocks(row.body);
  const newBody = JSON.stringify(blocks);

  // Backup BEFORE mutating the DB so a crash mid-migration leaves the
  // operator with both the unchanged DB row and the JSONL line on disk.
  const backupDir = await resolveBackupDir(opts?.backupDir);
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "blocknote-pre.jsonl");
  const line: BackupLine = {
    timestamp: new Date().toISOString(),
    articleId,
    issueId: row.issue_id,
    headline: row.headline,
    body: row.body,
    bodyFormat: "plain",
  };
  await fs.appendFile(backupPath, JSON.stringify(line) + "\n", "utf8");

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("articles")
      .set({ body: newBody, body_format: "blocks", updated_at: new Date().toISOString() })
      .where("id", "=", articleId)
      .execute();
  });

  return {
    migrated: true,
    fromFormat: "plain",
    toFormat: "blocks",
    backupPath,
  };
}
