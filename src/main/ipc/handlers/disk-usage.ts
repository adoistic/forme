import type { Kysely } from "kysely";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { computeDiskUsage } from "../../disk-usage-events.js";
import type { DiskUsageSnapshot } from "@shared/ipc-contracts/channels.js";
import type { Database } from "../../sqlite/schema.js";
import type { SnapshotStore } from "../../snapshot-store/store.js";

// `disk-usage:current` — synchronous read of the current disk-usage
// snapshot. The renderer's `<StorageThresholdBanner>` calls this on mount
// so it can render the right tier before any `disk-usage-changed` event
// fires (T11). Mutating handlers continue to broadcast via
// `emitDiskUsageChanged`; this is the read-side companion.

export interface DiskUsageHandlerDeps {
  db: Kysely<Database>;
  snapshots: SnapshotStore;
}

export async function currentDiskUsage(deps: DiskUsageHandlerDeps): Promise<DiskUsageSnapshot> {
  return computeDiskUsage(deps.db, deps.snapshots);
}

export function registerDiskUsageHandlers(): void {
  addHandler("disk-usage:current", async () => {
    const { db, snapshots } = getState();
    return currentDiskUsage({ db, snapshots });
  });
}
