import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import type { Database } from "../sqlite/schema.js";
import type { SerializedIssue } from "./types.js";
import { describeDiff } from "./diff.js";
import { makeError } from "@shared/errors/structured.js";

// Snapshot store per CEO plan Section 17 + eng-plan §1.
// Every save event (auto-save, explicit, export) writes a snapshot.
// Full snapshots only in MVP; delta snapshots are v1.1 per CEO §7F.

export interface SnapshotRecord {
  id: string;
  issue_id: string;
  created_at: string;
  description: string;
  size_bytes: number;
  is_full: boolean;
}

export interface SnapshotStore {
  save(issueId: string, state: SerializedIssue): Promise<SnapshotRecord>;
  list(issueId: string, limit?: number): Promise<SnapshotRecord[]>;
  read(snapshotId: string): Promise<SerializedIssue>;
  latest(issueId: string): Promise<SnapshotRecord | null>;
  count(issueId: string): Promise<number>;
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
        .executeTakeFirst();

      return Number(result?.count ?? 0);
    },
  };
}
