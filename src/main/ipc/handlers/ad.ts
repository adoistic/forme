import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { ingestImage } from "../../image-ingest/ingest.js";
import { validateAdAspect, validateResolution, AD_SLOT_TRIM_WIDTH_MM } from "@shared/schemas/ad.js";
import { makeError } from "@shared/errors/structured.js";
import { emitDiskUsageChanged } from "../../disk-usage-events.js";
import type {
  AdPlacementKind,
  AdSummary,
  UpdateAdInput,
  UploadAdInput,
} from "@shared/ipc-contracts/channels.js";
import type { AdSlotType } from "@shared/schemas/ad.js";
import type { Database } from "../../sqlite/schema.js";

function nowISO(): string {
  return new Date().toISOString();
}

// New ads land at the tail of the operator's list. v0.6 T13.
async function nextAdPosition(db: Kysely<Database>, issueId: string | null): Promise<number> {
  let q = db.selectFrom("ads").select((eb) => eb.fn.max<number>("display_position").as("max"));
  q = issueId === null ? q.where("issue_id", "is", null) : q.where("issue_id", "=", issueId);
  const row = await q.executeTakeFirst();
  return Number(row?.max ?? 0) + 1;
}

// v0.6 T15. Render the structured placement back into the legacy free-text
// label so the existing export-path mapping in handlers/export.ts keeps
// working until position_label is dropped in a follow-up migration. Cover
// stays "Run of Book"-flavored — exact label matches the old defaults so
// `derivePosition` in export.ts continues to map sensibly.
function derivePositionLabel(kind: AdPlacementKind): string {
  if (kind === "cover") return "Cover";
  if (kind === "between") return "Between articles";
  return "Bottom of article";
}

// Normalize a possibly-undefined placement_kind from a raw DB row into the
// strict union type. Older rows pre-migration default to 'cover' via the
// SQL default; this guard handles the empty-string / unexpected-value case.
function normalizePlacementKind(value: string | null | undefined): AdPlacementKind {
  if (value === "between" || value === "bottom-of") return value;
  return "cover";
}

export interface AdPlacementValidationInput {
  placementKind: AdPlacementKind;
  placementArticleId: string | null;
}

/**
 * v0.6 T15 placement validation. Runs in the main process; the renderer
 * also enforces the same rules so the form can disable Save before the
 * round trip. Throws StructuredError on failure.
 */
export async function validatePlacement(
  db: Kysely<Database>,
  input: AdPlacementValidationInput
): Promise<void> {
  if (input.placementKind === "cover") {
    if (input.placementArticleId !== null) {
      throw makeError("ad_placement_invalid", "error", {
        reason: "cover placement does not take an article",
      });
    }
    return;
  }
  // 'between' and 'bottom-of' both require a host article.
  if (!input.placementArticleId) {
    throw makeError("ad_placement_invalid", "error", {
      reason: `${input.placementKind} placement requires an article`,
    });
  }
  const article = await db
    .selectFrom("articles")
    .select(["id"])
    .where("id", "=", input.placementArticleId)
    .executeTakeFirst();
  if (!article) {
    throw makeError("not_found", "error", {
      resource: "article",
      id: input.placementArticleId,
    });
  }
}

interface AdRow {
  id: string;
  issue_id: string | null;
  slot_type: string;
  position_label: string;
  bw_flag: number;
  kind: string;
  creative_blob_hash: string;
  creative_filename: string;
  placement_kind: string | null;
  placement_article_id: string | null;
  created_at: string;
}

function rowToSummary(row: AdRow): AdSummary {
  return {
    id: row.id,
    issueId: row.issue_id,
    slotType: row.slot_type as AdSlotType,
    positionLabel: row.position_label,
    placementKind: normalizePlacementKind(row.placement_kind),
    placementArticleId: row.placement_article_id,
    kind: row.kind as AdSummary["kind"],
    bwFlag: row.bw_flag === 1,
    creativeFilename: row.creative_filename,
    blobHash: row.creative_blob_hash,
    createdAt: row.created_at,
  };
}

const SUMMARY_COLUMNS = [
  "id",
  "issue_id",
  "slot_type",
  "position_label",
  "bw_flag",
  "kind",
  "creative_blob_hash",
  "creative_filename",
  "placement_kind",
  "placement_article_id",
  "created_at",
] as const;

export interface AdHandlerDeps {
  db: Kysely<Database>;
}

export async function updateAd(deps: AdHandlerDeps, payload: UpdateAdInput): Promise<AdSummary> {
  const { db } = deps;
  // If the caller is changing placement, validate end-to-end. We need both
  // sides of the (kind, article_id) pair to do the check, so read the
  // current row and overlay the patch before validating.
  const existing = await db
    .selectFrom("ads")
    .select([...SUMMARY_COLUMNS])
    .where("id", "=", payload.id)
    .executeTakeFirst();
  if (!existing) {
    throw makeError("not_found", "error", { resource: "ad", id: payload.id });
  }

  const nextKind: AdPlacementKind =
    payload.placementKind ?? normalizePlacementKind(existing.placement_kind);
  const nextArticleId: string | null =
    payload.placementArticleId !== undefined
      ? payload.placementArticleId
      : existing.placement_article_id;

  if (payload.placementKind !== undefined || payload.placementArticleId !== undefined) {
    await validatePlacement(db, {
      placementKind: nextKind,
      placementArticleId: nextArticleId,
    });
  }

  const patch: Record<string, unknown> = {};
  if (payload.slotType !== undefined) patch["slot_type"] = payload.slotType;
  if (payload.bwFlag !== undefined) patch["bw_flag"] = payload.bwFlag ? 1 : 0;
  if (payload.kind !== undefined) patch["kind"] = payload.kind;
  if (payload.billingReference !== undefined) patch["billing_reference"] = payload.billingReference;
  if (payload.placementKind !== undefined || payload.placementArticleId !== undefined) {
    patch["placement_kind"] = nextKind;
    patch["placement_article_id"] = nextArticleId;
    // Keep the legacy label in sync with structured placement so the
    // export path doesn't surface a stale "Run of Book" string.
    patch["position_label"] = derivePositionLabel(nextKind);
  }

  if (Object.keys(patch).length > 0) {
    await db.updateTable("ads").set(patch).where("id", "=", payload.id).execute();
  }

  const row = await db
    .selectFrom("ads")
    .select([...SUMMARY_COLUMNS])
    .where("id", "=", payload.id)
    .executeTakeFirstOrThrow();
  return rowToSummary(row as AdRow);
}

export function registerAdHandlers(): void {
  addHandler("ad:list", async (payload: { issueId: string | null }) => {
    const { db } = getState();
    // v0.6 T13: list by display_position (operator-controlled).
    let query = db
      .selectFrom("ads")
      .select([...SUMMARY_COLUMNS])
      .orderBy("display_position", "asc")
      .orderBy("created_at", "asc");
    if (payload.issueId === null) {
      query = query.where("issue_id", "is", null);
    } else {
      query = query.where("issue_id", "=", payload.issueId);
    }
    const rows = await query.execute();
    return rows.map((r) => rowToSummary(r as AdRow));
  });

  addHandler("ad:upload", async (payload: UploadAdInput): Promise<AdSummary> => {
    const { db, blobs } = getState();

    // v0.6 T15: structured placement validation runs before any disk work.
    await validatePlacement(db, {
      placementKind: payload.placementKind,
      placementArticleId: payload.placementArticleId,
    });

    const buf = Buffer.from(payload.base64, "base64");

    const ingested = await ingestImage({ filename: payload.filename, buffer: buf });

    // Aspect check
    const aspect = validateAdAspect(payload.slotType, ingested.width, ingested.height);
    if (!aspect.ok) {
      throw makeError("ad_aspect_mismatch", "error", {
        expected_aspect: aspect.expected.toFixed(3),
        actual_aspect: aspect.actual.toFixed(3),
      });
    }

    // Resolution check (warn/reject)
    const slotWidthMM = AD_SLOT_TRIM_WIDTH_MM[payload.slotType];
    const resolution = validateResolution(ingested.width, slotWidthMM);
    if (resolution === "reject") {
      throw makeError("ad_resolution_error", "error", {
        dpi: ingested.dpi,
      });
    }

    const hash = await blobs.writeBuffer(ingested.bytes);
    const now = nowISO();
    // Register image metadata
    await db
      .insertInto("images")
      .values({
        blob_hash: hash,
        filename: payload.filename,
        mime_type: ingested.mimeType,
        width: ingested.width,
        height: ingested.height,
        dpi: ingested.dpi,
        color_mode: ingested.color_mode,
        size_bytes: ingested.size_bytes,
        imported_at: now,
        tags_json: JSON.stringify(["ad"]),
      })
      .onConflict((oc) => oc.column("blob_hash").doNothing())
      .execute();

    const id = randomUUID();
    const display_position = await nextAdPosition(db, payload.issueId);
    const positionLabel = payload.positionLabel ?? derivePositionLabel(payload.placementKind);
    await db
      .insertInto("ads")
      .values({
        id,
        issue_id: payload.issueId,
        slot_type: payload.slotType,
        position_label: positionLabel,
        bw_flag: payload.bwFlag ? 1 : 0,
        kind: payload.kind,
        creative_blob_hash: hash,
        creative_filename: payload.filename,
        billing_reference: payload.billingReference,
        display_position,
        placement_kind: payload.placementKind,
        placement_article_id: payload.placementArticleId,
        created_at: now,
      })
      .execute();

    const { snapshots } = getState();
    await emitDiskUsageChanged({ db, snapshotStore: snapshots });

    return {
      id,
      issueId: payload.issueId,
      slotType: payload.slotType,
      positionLabel,
      placementKind: payload.placementKind,
      placementArticleId: payload.placementArticleId,
      kind: payload.kind,
      bwFlag: payload.bwFlag,
      creativeFilename: payload.filename,
      blobHash: hash,
      createdAt: now,
    };
  });

  addHandler("ad:update", async (payload: UpdateAdInput): Promise<AdSummary> => {
    const { db } = getState();
    return updateAd({ db }, payload);
  });
}
