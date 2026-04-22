// Unified disk-usage-changed broadcaster (ER2-3 / codex tension 1).
// Every main-process write or delete that touches snapshots, blobs, or
// cascading article rows should emit ONE event. The renderer subscribes via
// `window.forme.onDiskUsageChanged` and updates the Settings → Storage panel.
//
// Tests can swap the broadcaster via `setBroadcaster` so they can observe
// emissions without spinning up a BrowserWindow.

import type { Kysely } from "kysely";
import type { Database } from "./sqlite/schema.js";
import type { SnapshotStore } from "./snapshot-store/store.js";
import type { DiskUsageSnapshot } from "@shared/ipc-contracts/channels.js";

export type Broadcaster = (usage: DiskUsageSnapshot) => void;

// Default broadcaster sends to all renderer windows. Imported lazily so this
// module is safe to import from tests that don't have electron available.
let broadcaster: Broadcaster | null = null;

export function setBroadcaster(b: Broadcaster | null): void {
  broadcaster = b;
}

async function defaultBroadcaster(usage: DiskUsageSnapshot): Promise<void> {
  // Lazy require so tests don't need electron loaded.
  const electron = await import("electron");
  for (const win of electron.BrowserWindow.getAllWindows()) {
    win.webContents.send("disk-usage-changed", usage);
  }
}

export async function computeDiskUsage(
  db: Kysely<Database>,
  snapshotStore: SnapshotStore
): Promise<DiskUsageSnapshot> {
  const snapshots = await snapshotStore.totalArticleSnapshotBytes();
  // For blobs: SUM(size_bytes) on images (the only registered blob table
  // today). Ad creatives + classifieds photos go through the same images
  // table so they're already counted.
  const blobsRow = await db
    .selectFrom("images")
    .select(db.fn.sum<number>("size_bytes").as("total"))
    .executeTakeFirst();
  const blobs = Number(blobsRow?.total ?? 0);
  return { snapshots, blobs, total: snapshots + blobs };
}

export async function emitDiskUsageChanged(deps: {
  db: Kysely<Database>;
  snapshotStore: SnapshotStore;
}): Promise<DiskUsageSnapshot> {
  const usage = await computeDiskUsage(deps.db, deps.snapshotStore);
  if (broadcaster) {
    broadcaster(usage);
  } else {
    await defaultBroadcaster(usage);
  }
  return usage;
}
