import { randomUUID } from "node:crypto";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { ingestImage } from "../../image-ingest/ingest.js";
import { validateAdAspect, validateResolution, AD_SLOT_TRIM_WIDTH_MM } from "@shared/schemas/ad.js";
import { makeError } from "@shared/errors/structured.js";
import type { AdSummary, UploadAdInput } from "@shared/ipc-contracts/channels.js";
import type { AdSlotType } from "@shared/schemas/ad.js";

function nowISO(): string {
  return new Date().toISOString();
}

export function registerAdHandlers(): void {
  addHandler("ad:list", async (payload: { issueId: string | null }) => {
    const { db } = getState();
    let query = db
      .selectFrom("ads")
      .select([
        "id",
        "issue_id",
        "slot_type",
        "position_label",
        "bw_flag",
        "kind",
        "creative_blob_hash",
        "creative_filename",
        "created_at",
      ])
      .orderBy("created_at", "desc");
    if (payload.issueId === null) {
      query = query.where("issue_id", "is", null);
    } else {
      query = query.where("issue_id", "=", payload.issueId);
    }
    const rows = await query.execute();
    return rows.map<AdSummary>((r) => ({
      id: r.id,
      issueId: r.issue_id,
      slotType: r.slot_type as AdSlotType,
      positionLabel: r.position_label,
      kind: r.kind as AdSummary["kind"],
      bwFlag: r.bw_flag === 1,
      creativeFilename: r.creative_filename,
      blobHash: r.creative_blob_hash,
      createdAt: r.created_at,
    }));
  });

  addHandler("ad:upload", async (payload: UploadAdInput): Promise<AdSummary> => {
    const { db, blobs } = getState();
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
    await db
      .insertInto("ads")
      .values({
        id,
        issue_id: payload.issueId,
        slot_type: payload.slotType,
        position_label: payload.positionLabel,
        bw_flag: payload.bwFlag ? 1 : 0,
        kind: payload.kind,
        creative_blob_hash: hash,
        creative_filename: payload.filename,
        billing_reference: payload.billingReference,
        created_at: now,
      })
      .execute();

    return {
      id,
      issueId: payload.issueId,
      slotType: payload.slotType,
      positionLabel: payload.positionLabel,
      kind: payload.kind,
      bwFlag: payload.bwFlag,
      creativeFilename: payload.filename,
      blobHash: hash,
      createdAt: now,
    };
  });
}
