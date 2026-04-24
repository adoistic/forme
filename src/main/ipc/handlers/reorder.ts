import type { Kysely } from "kysely";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { makeError } from "@shared/errors/structured.js";
import { midpoint, rebalance, REBALANCE_THRESHOLD } from "../../reorder/fractional-position.js";
import type { Database } from "../../sqlite/schema.js";
import { createLogger } from "../../logger.js";

// v0.6 T13 — drag-reorder handlers for articles, classifieds, ads.
// Renderer computes the midpoint of the two neighbors it dropped between
// and sends `newPosition`. We persist that value on the row. If the
// renderer-supplied gap turned out to be below the float epsilon (or if
// `newPosition` would tie with another row), we rebalance the entire
// table to evenly-spaced integers — a single transaction that re-spaces
// every row 1.0, 2.0, 3.0, ...
//
// Concurrency: a per-table promise chain serializes reorder writes inside
// the main process so two drags can't race a rebalance. SQLite's default
// transaction is BEGIN IMMEDIATE in better-sqlite3; the chain prevents
// the second writer from getting a SQLITE_BUSY when the first is still
// inside the rebalance transaction.

const logger = createLogger("ipc:reorder");

type ReorderableTable = "articles" | "classifieds" | "ads";

export interface ReorderHandlerDeps {
  db: Kysely<Database>;
}

export interface ReorderResult {
  id: string;
  newPosition: number;
  rebalanced: boolean;
}

// Per-table mutex. New requests wait for the previous one to settle so
// rebalance + concurrent reorder writes can't interleave.
const tableLocks: Record<ReorderableTable, Promise<unknown>> = {
  articles: Promise.resolve(),
  classifieds: Promise.resolve(),
  ads: Promise.resolve(),
};

async function withTableLock<T>(table: ReorderableTable, fn: () => Promise<T>): Promise<T> {
  const previous = tableLocks[table];
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  tableLocks[table] = previous.then(() => next);
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

/**
 * Persist `newPosition` on the row. If the renderer's midpoint dropped
 * below the rebalance threshold (caller passed a position that's too
 * close to an existing neighbor) we rebalance the whole table first,
 * recompute, and write again.
 *
 * Returns the position actually written (which may differ from the
 * requested value when a rebalance ran) so the renderer can sync state.
 */
export async function reorderRow(
  deps: ReorderHandlerDeps,
  table: ReorderableTable,
  payload: { id: string; newPosition: number }
): Promise<ReorderResult> {
  return withTableLock(table, async () => {
    const exists = await deps.db
      .selectFrom(table)
      .select(["id"])
      .where("id", "=", payload.id)
      .executeTakeFirst();
    if (!exists) {
      throw makeError("not_found", "error", { resource: table, id: payload.id });
    }

    let needsRebalance = false;

    // Sanity-check the renderer's midpoint against current neighbors. If the
    // gap to the closer neighbor is below the rebalance threshold the float
    // is no longer safe to bisect — trigger a rebalance and recompute.
    const neighbors = await deps.db
      .selectFrom(table)
      .select(["id", "display_position"])
      .where("id", "!=", payload.id)
      .execute();

    let newPosition = payload.newPosition;

    const before = neighbors
      .filter((n) => n.display_position < payload.newPosition)
      .reduce<
        number | null
      >((acc, n) => (acc === null || n.display_position > acc ? n.display_position : acc), null);
    const after = neighbors
      .filter((n) => n.display_position > payload.newPosition)
      .reduce<
        number | null
      >((acc, n) => (acc === null || n.display_position < acc ? n.display_position : acc), null);

    // If the renderer-supplied midpoint coincides with a neighbor, or the
    // gap to either side is below the threshold, rebalance and pick a
    // fresh midpoint at the same logical insert location.
    const tooCloseBelow = before !== null && payload.newPosition - before < REBALANCE_THRESHOLD;
    const tooCloseAbove = after !== null && after - payload.newPosition < REBALANCE_THRESHOLD;
    const collidesWithExisting = neighbors.some((n) => n.display_position === payload.newPosition);

    if (tooCloseBelow || tooCloseAbove || collidesWithExisting) {
      needsRebalance = true;
    }

    if (needsRebalance) {
      const fresh = await rebalanceTable(deps.db, table, payload.id, payload.newPosition);
      newPosition = fresh;
    } else {
      await deps.db
        .updateTable(table)
        .set({ display_position: newPosition })
        .where("id", "=", payload.id)
        .execute();
    }

    return { id: payload.id, newPosition, rebalanced: needsRebalance };
  });
}

/**
 * Re-space the whole table to integer positions 1.0, 2.0, ..., placing
 * the moved row at the slot implied by the renderer's intended position.
 * Runs inside a single transaction so any concurrent reader sees either
 * the pre- or post-rebalance state, never a half-rewritten table.
 *
 * Returns the new position assigned to `movedId`.
 */
async function rebalanceTable(
  db: Kysely<Database>,
  table: ReorderableTable,
  movedId: string,
  intendedPosition: number
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    // Pull every row's current position. We compute the new ordering by
    // sorting on (position, id), but the moved row is placed using the
    // operator's intended target — the rendered drop location already
    // reflects what they want, even if its float representation collides
    // with a neighbor.
    const rows = await trx.selectFrom(table).select(["id", "display_position"]).execute();

    const others = rows.filter((r) => r.id !== movedId);
    others.sort((a, b) => {
      if (a.display_position !== b.display_position) {
        return a.display_position - b.display_position;
      }
      return a.id.localeCompare(b.id);
    });

    // Find where the moved row should sit relative to the others by
    // counting how many "others" sit below the intended position. Ties
    // break by id so the result is deterministic.
    let insertIdx = 0;
    for (const o of others) {
      if (
        o.display_position < intendedPosition ||
        (o.display_position === intendedPosition && o.id < movedId)
      ) {
        insertIdx += 1;
      }
    }

    const ordered: string[] = [
      ...others.slice(0, insertIdx).map((r) => r.id),
      movedId,
      ...others.slice(insertIdx).map((r) => r.id),
    ];
    const newPositions = rebalance(ordered.map((_, i) => i));

    for (let i = 0; i < ordered.length; i += 1) {
      const id = ordered[i];
      const pos = newPositions[i];
      if (id === undefined || pos === undefined) continue;
      await trx.updateTable(table).set({ display_position: pos }).where("id", "=", id).execute();
    }

    const movedPos = newPositions[insertIdx];
    if (movedPos === undefined) {
      // Shouldn't happen — would mean an empty list with a moved row.
      throw new Error("rebalanceTable: moved row index missing in new positions");
    }
    logger.info({ table, movedId, movedPos, total: ordered.length }, "rebalanced reorder table");
    return movedPos;
  });
}

// Helper exposed for tests so they don't have to reimplement the
// neighbor-search logic. Returns the midpoint between two existing rows
// (or null if a rebalance is needed). The thin wrapper keeps the test
// surface narrow.
export function computeMidpoint(before: number | null, after: number | null): number | null {
  return midpoint(before, after);
}

export function registerReorderHandlers(): void {
  addHandler(
    "articles:reorder",
    async (payload: { articleId: string; newPosition: number }): Promise<ReorderResult> => {
      const { db } = getState();
      return reorderRow({ db }, "articles", {
        id: payload.articleId,
        newPosition: payload.newPosition,
      });
    }
  );
  addHandler(
    "classifieds:reorder",
    async (payload: { classifiedId: string; newPosition: number }): Promise<ReorderResult> => {
      const { db } = getState();
      return reorderRow({ db }, "classifieds", {
        id: payload.classifiedId,
        newPosition: payload.newPosition,
      });
    }
  );
  addHandler(
    "ads:reorder",
    async (payload: { adId: string; newPosition: number }): Promise<ReorderResult> => {
      const { db } = getState();
      return reorderRow({ db }, "ads", { id: payload.adId, newPosition: payload.newPosition });
    }
  );
}

// Test-only export to reset the per-table mutex between tests so failures
// in one test don't deadlock the next (the chain is module-scoped).
export function _resetTableLocksForTesting(): void {
  tableLocks.articles = Promise.resolve();
  tableLocks.classifieds = Promise.resolve();
  tableLocks.ads = Promise.resolve();
}
