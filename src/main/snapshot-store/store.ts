import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import * as jsondiffpatch from "jsondiffpatch";
import type { Delta } from "jsondiffpatch";
import type { Database } from "../sqlite/schema.js";
import type { SerializedIssue } from "./types.js";
import { describeDiff } from "./diff.js";
import { makeError } from "@shared/errors/structured.js";
import { BLOCKNOTE_SCHEMA_VERSION } from "@shared/blocknote-schema.js";

// Snapshot store per CEO plan Section 17 + eng-plan §1.
// Every save event (auto-save, explicit, export) writes a snapshot.
// Issue-level: full snapshots only in MVP; delta snapshots are v1.1 per CEO §7F.
// Article-level (v0.6 CEO plan decision 6A revised): jsondiffpatch deltas keyed
// on block.id so reorders stay small. First snapshot per article (or after a
// schema version mismatch) is a fallback_full; subsequent ones are
// delta_jsonpatch from the previous article snapshot. Each delta payload
// records its `prev_snapshot_id` so the read path follows an explicit chain
// and can detect a missing link without relying on timestamp ordering.

export interface SnapshotRecord {
  id: string;
  issue_id: string;
  created_at: string;
  description: string;
  size_bytes: number;
  is_full: boolean;
}

export interface ArticleSnapshotRecord {
  id: string;
  article_id: string;
  created_at: string;
  label: string | null;
  starred: boolean;
  size_bytes: number;
  diff_status: "fallback_full" | "delta_jsonpatch" | null;
  block_schema_version: number;
}

export interface SnapshotStore {
  // Issue-level (v0.5)
  save(issueId: string, state: SerializedIssue): Promise<SnapshotRecord>;
  list(issueId: string, limit?: number): Promise<SnapshotRecord[]>;
  read(snapshotId: string): Promise<SerializedIssue>;
  latest(issueId: string): Promise<SnapshotRecord | null>;
  count(issueId: string): Promise<number>;

  // Article-level (v0.6)
  saveArticleSnapshot(
    articleId: string,
    body: string,
    opts?: { label?: string; starred?: boolean }
  ): Promise<ArticleSnapshotRecord>;
  listArticleSnapshots(articleId: string, limit?: number): Promise<ArticleSnapshotRecord[]>;
  readArticleSnapshot(snapshotId: string): Promise<{
    articleId: string;
    body: string;
    createdAt: string;
    label: string | null;
    starred: boolean;
  }>;
  deleteArticleSnapshot(snapshotId: string): Promise<void>;
  labelArticleSnapshot(snapshotId: string, label: string | null): Promise<void>;
  starArticleSnapshot(snapshotId: string, starred: boolean): Promise<void>;
  totalArticleSnapshotBytes(): Promise<number>;
}

// Block schema version bump signal — when the BlockNote / serialized block
// shape changes, increment this so the next save writes a fresh fallback_full
// instead of trying to delta against an incompatible base. Sourced from the
// shared module so renderer + main agree; must match the SQL default in
// migration 4.
const BLOCK_SCHEMA_VERSION = BLOCKNOTE_SCHEMA_VERSION;

// jsondiffpatch instance keyed on block.id so block reorders produce tiny
// "moved" deltas rather than full-replace rewrites.
const blockDiffer = jsondiffpatch.create({
  objectHash: (item: object) => {
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  },
});

interface FullPayload {
  format: "blocks";
  body: unknown;
}

interface DeltaPayload {
  format: "blocks_delta";
  // The snapshot id this delta was computed against. Read path follows this
  // chain back to a fallback_full; a broken link means snapshot_corrupt.
  prev_snapshot_id: string;
  delta: Delta;
}

export function createSnapshotStore(db: Kysely<Database>): SnapshotStore {
  return {
    async save(issueId, state) {
      const previous = await this.latest(issueId);
      let previousState: SerializedIssue | null = null;
      if (previous) {
        previousState = await this.read(previous.id);
      }

      const description = describeDiff(previousState, state);
      const stateJson = JSON.stringify(state);
      const id = randomUUID();
      const createdAt = new Date().toISOString();

      await db
        .insertInto("snapshots")
        .values({
          id,
          issue_id: issueId,
          created_at: createdAt,
          description,
          state_json: stateJson,
          size_bytes: Buffer.byteLength(stateJson, "utf8"),
          is_full: 1,
        })
        .execute();

      return {
        id,
        issue_id: issueId,
        created_at: createdAt,
        description,
        size_bytes: Buffer.byteLength(stateJson, "utf8"),
        is_full: true,
      };
    },

    async list(issueId, limit = 100) {
      const rows = await db
        .selectFrom("snapshots")
        .select(["id", "issue_id", "created_at", "description", "size_bytes", "is_full"])
        .where("issue_id", "=", issueId)
        .where("entity_kind", "=", "issue")
        .orderBy("created_at", "desc")
        .limit(limit)
        .execute();

      return rows.map((r) => ({
        id: r.id,
        issue_id: r.issue_id,
        created_at: r.created_at,
        description: r.description,
        size_bytes: r.size_bytes,
        is_full: r.is_full === 1,
      }));
    },

    async read(snapshotId) {
      const row = await db
        .selectFrom("snapshots")
        .select(["state_json"])
        .where("id", "=", snapshotId)
        .executeTakeFirst();

      if (!row) {
        throw makeError("snapshot_corrupt", "error", { snapshotId, reason: "not_found" });
      }

      try {
        return JSON.parse(row.state_json) as SerializedIssue;
      } catch {
        throw makeError("snapshot_corrupt", "error", { snapshotId, reason: "malformed_json" });
      }
    },

    async latest(issueId) {
      const row = await db
        .selectFrom("snapshots")
        .select(["id", "issue_id", "created_at", "description", "size_bytes", "is_full"])
        .where("issue_id", "=", issueId)
        .where("entity_kind", "=", "issue")
        .orderBy("created_at", "desc")
        .limit(1)
        .executeTakeFirst();

      if (!row) return null;
      return {
        id: row.id,
        issue_id: row.issue_id,
        created_at: row.created_at,
        description: row.description,
        size_bytes: row.size_bytes,
        is_full: row.is_full === 1,
      };
    },

    async count(issueId) {
      const result = await db
        .selectFrom("snapshots")
        .select(db.fn.countAll<number>().as("count"))
        .where("issue_id", "=", issueId)
        .where("entity_kind", "=", "issue")
        .executeTakeFirst();

      return Number(result?.count ?? 0);
    },

    async saveArticleSnapshot(articleId, body, opts) {
      if (typeof body !== "string" || body.length === 0) {
        throw makeError("article_snapshot_empty_body", "error", { articleId });
      }

      // Parse the incoming body so we can diff it as JSON.
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        throw makeError("article_snapshot_invalid_body", "error", {
          articleId,
          reason: "body_not_json",
        });
      }

      // Look up the most recent article snapshot for this article. If it
      // exists AND the schema version matches, we can store a delta against
      // the reconstructed previous body. Otherwise: fallback_full.
      const prev = await db
        .selectFrom("snapshots")
        .select(["id", "block_schema_version", "created_at"])
        .where("entity_kind", "=", "article")
        .where("article_id", "=", articleId)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();

      const id = randomUUID();
      // Force monotonic created_at per article so chain ordering is stable
      // even when multiple snapshots land in the same millisecond. ISO-8601
      // permits any number of fractional-second digits and SQLite text sort
      // remains lexicographic — keeping the regular millisecond-precision
      // ISO format on the wire when there's no contention.
      const createdAt = nextCreatedAt(prev?.created_at);
      const label = opts?.label ?? null;
      const starred: 0 | 1 = opts?.starred ? 1 : 0;

      let stateJson: string;
      let diffStatus: "fallback_full" | "delta_jsonpatch";

      if (!prev || prev.block_schema_version !== BLOCK_SCHEMA_VERSION) {
        const payload: FullPayload = { format: "blocks", body: parsedBody };
        stateJson = JSON.stringify(payload);
        diffStatus = "fallback_full";
      } else {
        const previousBody = await reconstructArticleBody(db, prev.id);
        const delta = blockDiffer.diff(previousBody, parsedBody);
        const payload: DeltaPayload = {
          format: "blocks_delta",
          prev_snapshot_id: prev.id,
          delta,
        };
        stateJson = JSON.stringify(payload);
        diffStatus = "delta_jsonpatch";
      }

      const sizeBytes = Buffer.byteLength(stateJson, "utf8");

      await db
        .insertInto("snapshots")
        .values({
          id,
          // CEO plan 1A keeps article snapshots on the same table; FK still
          // requires a non-null issue_id, so we look up the article's parent.
          issue_id: await getIssueIdForArticle(db, articleId),
          article_id: articleId,
          entity_kind: "article",
          created_at: createdAt,
          description: "", // legacy column; describeDiff is issue-only
          state_json: stateJson,
          size_bytes: sizeBytes,
          is_full: diffStatus === "fallback_full" ? 1 : 0,
          label,
          starred,
          diff_status: diffStatus,
          block_schema_version: BLOCK_SCHEMA_VERSION,
        })
        .execute();

      return {
        id,
        article_id: articleId,
        created_at: createdAt,
        label,
        starred: starred === 1,
        size_bytes: sizeBytes,
        diff_status: diffStatus,
        block_schema_version: BLOCK_SCHEMA_VERSION,
      };
    },

    async listArticleSnapshots(articleId, limit = 100) {
      const rows = await db
        .selectFrom("snapshots")
        .select([
          "id",
          "article_id",
          "created_at",
          "label",
          "starred",
          "size_bytes",
          "diff_status",
          "block_schema_version",
        ])
        .where("entity_kind", "=", "article")
        .where("article_id", "=", articleId)
        .orderBy("created_at", "desc")
        .limit(limit)
        .execute();

      return rows.map((r) => ({
        id: r.id,
        article_id: r.article_id ?? articleId,
        created_at: r.created_at,
        label: r.label,
        starred: r.starred === 1,
        size_bytes: r.size_bytes,
        diff_status: r.diff_status,
        block_schema_version: r.block_schema_version,
      }));
    },

    async readArticleSnapshot(snapshotId) {
      const row = await db
        .selectFrom("snapshots")
        .select(["id", "article_id", "created_at", "label", "starred", "entity_kind"])
        .where("id", "=", snapshotId)
        .executeTakeFirst();

      if (!row || row.entity_kind !== "article" || !row.article_id) {
        throw makeError("snapshot_corrupt", "error", { snapshotId, reason: "not_found" });
      }

      const body = await reconstructArticleBody(db, snapshotId);

      return {
        articleId: row.article_id,
        body: JSON.stringify(body),
        createdAt: row.created_at,
        label: row.label,
        starred: row.starred === 1,
      };
    },

    async deleteArticleSnapshot(snapshotId) {
      await db
        .deleteFrom("snapshots")
        .where("id", "=", snapshotId)
        .where("entity_kind", "=", "article")
        .execute();
    },

    async labelArticleSnapshot(snapshotId, label) {
      await db
        .updateTable("snapshots")
        .set({ label })
        .where("id", "=", snapshotId)
        .where("entity_kind", "=", "article")
        .execute();
    },

    async starArticleSnapshot(snapshotId, starred) {
      await db
        .updateTable("snapshots")
        .set({ starred: starred ? 1 : 0 })
        .where("id", "=", snapshotId)
        .where("entity_kind", "=", "article")
        .execute();
    },

    async totalArticleSnapshotBytes() {
      const result = await db
        .selectFrom("snapshots")
        .select(db.fn.sum<number>("size_bytes").as("total"))
        .where("entity_kind", "=", "article")
        .executeTakeFirst();

      return Number(result?.total ?? 0);
    },
  };
}

// Reconstruct the body at `targetSnapshotId` by walking the explicit chain
// of `prev_snapshot_id` references back to a fallback_full, then applying
// deltas forward. A missing link or unreadable payload throws snapshot_corrupt.
async function reconstructArticleBody(
  db: Kysely<Database>,
  targetSnapshotId: string
): Promise<unknown> {
  // Collect the chain of snapshot rows from the target back to (and
  // including) the most recent fallback_full.
  const chain: { id: string; state_json: string; diff_status: string | null }[] = [];

  let cursor: string | null = targetSnapshotId;
  // Bound the walk to defend against pathological cycles.
  const SAFETY_LIMIT = 10_000;
  for (let steps = 0; cursor !== null; steps += 1) {
    if (steps >= SAFETY_LIMIT) {
      throw makeError("snapshot_corrupt", "error", {
        snapshotId: targetSnapshotId,
        reason: "chain_too_long",
      });
    }

    const row = await db
      .selectFrom("snapshots")
      .select(["id", "state_json", "diff_status", "entity_kind", "article_id"])
      .where("id", "=", cursor)
      .executeTakeFirst();

    if (!row || row.entity_kind !== "article" || !row.article_id) {
      throw makeError("snapshot_corrupt", "error", {
        snapshotId: targetSnapshotId,
        reason: "broken_chain",
        missingLink: cursor,
      });
    }

    chain.push({ id: row.id, state_json: row.state_json, diff_status: row.diff_status });

    if (row.diff_status === "fallback_full") {
      break;
    }

    if (row.diff_status !== "delta_jsonpatch") {
      throw makeError("snapshot_corrupt", "error", {
        snapshotId: row.id,
        reason: "unknown_diff_status",
        diff_status: row.diff_status,
      });
    }

    // Step back via the prev_snapshot_id embedded in the delta payload.
    let payload: DeltaPayload;
    try {
      payload = JSON.parse(row.state_json) as DeltaPayload;
    } catch {
      throw makeError("snapshot_corrupt", "error", {
        snapshotId: row.id,
        reason: "malformed_delta_json",
      });
    }
    if (payload.format !== "blocks_delta" || typeof payload.prev_snapshot_id !== "string") {
      throw makeError("snapshot_corrupt", "error", {
        snapshotId: row.id,
        reason: "wrong_payload_format",
      });
    }
    cursor = payload.prev_snapshot_id;
  }

  // chain is ordered target-first; reverse to apply oldest → newest.
  chain.reverse();

  const base = chain[0];
  if (!base || base.diff_status !== "fallback_full") {
    throw makeError("snapshot_corrupt", "error", {
      snapshotId: targetSnapshotId,
      reason: "no_fallback_full_in_chain",
    });
  }

  let current = parseFullPayload(base.state_json, base.id);

  for (let i = 1; i < chain.length; i += 1) {
    const link = chain[i]!;
    let payload: DeltaPayload;
    try {
      payload = JSON.parse(link.state_json) as DeltaPayload;
    } catch {
      throw makeError("snapshot_corrupt", "error", {
        snapshotId: link.id,
        reason: "malformed_delta_json",
      });
    }
    try {
      current = blockDiffer.patch(current, payload.delta);
    } catch (err) {
      throw makeError("snapshot_corrupt", "error", {
        snapshotId: link.id,
        reason: "patch_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return current;
}

function parseFullPayload(stateJson: string, snapshotId: string): unknown {
  let payload: FullPayload;
  try {
    payload = JSON.parse(stateJson) as FullPayload;
  } catch {
    throw makeError("snapshot_corrupt", "error", { snapshotId, reason: "malformed_full_json" });
  }
  if (payload.format !== "blocks") {
    throw makeError("snapshot_corrupt", "error", {
      snapshotId,
      reason: "wrong_payload_format",
      format: payload.format,
    });
  }
  return payload.body;
}

// Produce a created_at strictly greater than `previousCreatedAt` (if any).
// Most calls return a plain ISO string at millisecond precision; when two
// saves land in the same millisecond we bump by 1ms so ordering stays
// deterministic. Wall-clock skew in the burst is bounded by the burst length
// and acceptable — the absolute timestamp matters less than the per-article
// chain ordering.
function nextCreatedAt(previousCreatedAt: string | undefined): string {
  const now = new Date().toISOString();
  if (!previousCreatedAt || now > previousCreatedAt) {
    return now;
  }
  const bumped = new Date(new Date(previousCreatedAt).getTime() + 1).toISOString();
  return bumped;
}

async function getIssueIdForArticle(db: Kysely<Database>, articleId: string): Promise<string> {
  const row = await db
    .selectFrom("articles")
    .select(["issue_id"])
    .where("id", "=", articleId)
    .executeTakeFirst();
  if (!row) {
    throw makeError("article_snapshot_unknown_article", "error", { articleId });
  }
  return row.issue_id;
}
