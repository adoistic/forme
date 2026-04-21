import { randomUUID } from "node:crypto";
import Papa from "papaparse";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import {
  validateClassified,
  type ClassifiedType,
} from "@shared/schemas/classified.js";
import { makeError } from "@shared/errors/structured.js";
import type {
  AddClassifiedInput,
  ClassifiedSummary,
  ImportClassifiedsCsvInput,
  ImportClassifiedsCsvResult,
} from "@shared/ipc-contracts/channels.js";

function nowISO(): string {
  return new Date().toISOString();
}

function deriveDisplayName(type: ClassifiedType, fields: Record<string, unknown>): string {
  switch (type) {
    case "matrimonial_with_photo":
    case "matrimonial_no_photo":
      return `${fields["name"] ?? "Unnamed"}, ${fields["age"] ?? "?"} — ${fields["location"] ?? ""}`;
    case "obituary":
      return `${fields["name_of_deceased"] ?? "Unnamed"} (${fields["date_of_death"] ?? "?"})`;
    case "public_notice":
      return `Public notice by ${fields["published_by"] ?? "?"}`;
    case "announcement":
      return `${fields["occasion_type"] ?? "Announcement"}: ${fields["recipient_name"] ?? ""}`;
    case "job_vacancy":
      return `${fields["job_title"] ?? "?"} — ${fields["company_name"] ?? ""}`;
    case "job_wanted":
      return `${fields["candidate_name"] ?? "?"} seeking ${fields["location_preferences"] ?? "work"}`;
    case "property_sale":
    case "property_rent":
      return `${fields["property_type"] ?? ""} in ${fields["location"] ?? "?"}`;
    case "vehicles":
      return `${fields["make"] ?? ""} ${fields["model"] ?? ""} ${fields["year"] ?? ""}`;
    case "education":
      return `${fields["institution_name"] ?? ""}`;
    case "tender_notice":
      return `${fields["tender_title"] ?? "Tender"}`;
    default:
      return "Classified";
  }
}

export function registerClassifiedHandlers(): void {
  addHandler("classified:list", async (payload: { issueId: string | null }) => {
    const { db } = getState();
    let query = db
      .selectFrom("classifieds")
      .select([
        "id",
        "issue_id",
        "type",
        "language",
        "weeks_to_run",
        "fields_json",
        "created_at",
      ])
      .orderBy("created_at", "desc");
    if (payload.issueId === null) {
      query = query.where("issue_id", "is", null);
    } else {
      query = query.where("issue_id", "=", payload.issueId);
    }
    const rows = await query.execute();
    return rows.map<ClassifiedSummary>((r) => {
      let fields: Record<string, unknown> = {};
      try {
        fields = JSON.parse(r.fields_json) as Record<string, unknown>;
      } catch {
        // ignore
      }
      return {
        id: r.id,
        issueId: r.issue_id,
        type: r.type as ClassifiedType,
        language: r.language as "en" | "hi",
        weeksToRun: r.weeks_to_run,
        displayName: deriveDisplayName(r.type as ClassifiedType, fields),
        createdAt: r.created_at,
      };
    });
  });

  addHandler("classified:add", async (payload: AddClassifiedInput): Promise<ClassifiedSummary> => {
    const { db } = getState();

    // Validate per-type fields
    const validation = validateClassified(payload.type, payload.fields);
    if (!validation.ok) {
      throw makeError("field_validation_error", "error", {
        type: payload.type,
        issues: validation.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      });
    }

    const id = randomUUID();
    const now = nowISO();
    await db
      .insertInto("classifieds")
      .values({
        id,
        issue_id: payload.issueId,
        type: payload.type,
        language: payload.language,
        weeks_to_run: payload.weeksToRun,
        photo_blob_hash: null,
        fields_json: JSON.stringify(payload.fields),
        billing_reference: payload.billingReference,
        created_at: now,
        updated_at: now,
      })
      .execute();

    return {
      id,
      issueId: payload.issueId,
      type: payload.type,
      language: payload.language,
      weeksToRun: payload.weeksToRun,
      displayName: deriveDisplayName(
        payload.type,
        payload.fields as Record<string, unknown>
      ),
      createdAt: now,
    };
  });

  addHandler(
    "classified:import-csv",
    async (payload: ImportClassifiedsCsvInput): Promise<ImportClassifiedsCsvResult> => {
      const { db } = getState();
      const parsed = Papa.parse<Record<string, string>>(payload.csv, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      });
      if (parsed.errors.length > 0) {
        throw makeError("ipc_handler_threw", "error", {
          reason: `CSV parse error: ${parsed.errors[0]?.message ?? "unknown"}`,
        });
      }

      const imported: string[] = [];
      const errors: { row: number; reason: string }[] = [];
      const standardKeys = new Set([
        "type",
        "language",
        "weeks_to_run",
        "billing_reference",
      ]);
      const numericKeys = new Set([
        "age",
        "year",
        "kilometers",
        "expected_price",
        "asking_price",
        "rent_amount",
      ]);
      const arrayKeys = new Set(["contact_phones", "sender_names"]);

      for (let i = 0; i < parsed.data.length; i += 1) {
        const row = parsed.data[i] ?? {};
        const rowNum = i + 1;
        try {
          const type = (row["type"] ?? "").trim() as ClassifiedType;
          if (!type) {
            errors.push({ row: rowNum, reason: "missing `type`" });
            continue;
          }
          const language = ((row["language"] ?? "en").trim() || "en") as "en" | "hi";
          const weeksToRun = Number(row["weeks_to_run"]) || 1;
          const billingReference = row["billing_reference"]?.trim() || null;

          const fields: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (standardKeys.has(k)) continue;
            if (v === undefined || v === null) continue;
            const trimmed = String(v).trim();
            if (trimmed === "") continue;
            if (numericKeys.has(k)) {
              const n = Number(trimmed);
              if (!Number.isNaN(n)) fields[k] = n;
            } else if (arrayKeys.has(k)) {
              fields[k] = trimmed
                .split(/[;,]/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            } else {
              fields[k] = trimmed;
            }
          }

          const validation = validateClassified(type, fields);
          if (!validation.ok) {
            const issues = validation.issues
              .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
              .join("; ");
            errors.push({ row: rowNum, reason: issues });
            continue;
          }

          const id = randomUUID();
          const now = nowISO();
          await db
            .insertInto("classifieds")
            .values({
              id,
              issue_id: payload.issueId,
              type,
              language,
              weeks_to_run: weeksToRun,
              photo_blob_hash: null,
              fields_json: JSON.stringify(fields),
              billing_reference: billingReference,
              created_at: now,
              updated_at: now,
            })
            .execute();
          imported.push(id);
        } catch (err) {
          errors.push({ row: rowNum, reason: err instanceof Error ? err.message : String(err) });
        }
      }

      return { imported: imported.length, errors };
    }
  );
}
