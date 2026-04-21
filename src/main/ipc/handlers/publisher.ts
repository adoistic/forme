import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import type { PublisherProfile } from "@shared/ipc-contracts/channels.js";

const TENANT = "publisher_default";

function nowISO(): string {
  return new Date().toISOString();
}

export function registerPublisherHandlers(): void {
  addHandler("publisher:get", async () => {
    const { db } = getState();
    const row = await db
      .selectFrom("publisher_profile")
      .selectAll()
      .where("tenant_id", "=", TENANT)
      .executeTakeFirst();
    if (!row) return null;
    return {
      publicationName: row.publication_name ?? "",
      accentColor: row.accent_color,
      typographyPairingDefault: row.typography_pairing_default ?? "Editorial Serif",
      primaryLanguageDefault: row.primary_language_default,
      pageSizeDefault: row.page_size_default,
      issueCadence: row.issue_cadence as PublisherProfile["issueCadence"],
      printerContact: row.printer_contact,
      classifiedsBillingLabel: row.classifieds_billing_label,
    } satisfies PublisherProfile;
  });

  addHandler("publisher:save", async (payload: PublisherProfile) => {
    const { db } = getState();
    const now = nowISO();
    const existing = await db
      .selectFrom("publisher_profile")
      .select("tenant_id")
      .where("tenant_id", "=", TENANT)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable("publisher_profile")
        .set({
          publication_name: payload.publicationName,
          accent_color: payload.accentColor,
          typography_pairing_default: payload.typographyPairingDefault,
          primary_language_default: payload.primaryLanguageDefault,
          page_size_default: payload.pageSizeDefault,
          issue_cadence: payload.issueCadence,
          printer_contact: payload.printerContact,
          classifieds_billing_label: payload.classifiedsBillingLabel,
          updated_at: now,
        })
        .where("tenant_id", "=", TENANT)
        .execute();
    } else {
      await db
        .insertInto("publisher_profile")
        .values({
          tenant_id: TENANT,
          publication_name: payload.publicationName,
          masthead_blob_hash: null,
          accent_color: payload.accentColor,
          typography_pairing_default: payload.typographyPairingDefault,
          primary_language_default: payload.primaryLanguageDefault,
          page_size_default: payload.pageSizeDefault,
          issue_cadence: payload.issueCadence,
          printer_contact: payload.printerContact,
          printer_delivery_method: null,
          ad_position_labels_json: null,
          classifieds_billing_label: payload.classifiedsBillingLabel,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }
    return payload;
  });
}
