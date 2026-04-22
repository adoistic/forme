import { randomUUID } from "node:crypto";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import type { CreateIssueInput, IssueSummary } from "@shared/ipc-contracts/channels.js";

function nowISO(): string {
  return new Date().toISOString();
}

async function toSummary(issueRow: {
  id: string;
  title: string;
  issue_number: number | null;
  issue_date: string;
  page_size: "A4" | "A5";
  typography_pairing: string;
  primary_language: "en" | "hi" | "bilingual";
  bw_mode: number;
  created_at: string;
  updated_at: string;
}): Promise<IssueSummary> {
  const { db } = getState();
  const [articles, classifieds, ads] = await Promise.all([
    db
      .selectFrom("articles")
      .select(db.fn.countAll<number>().as("n"))
      .where("issue_id", "=", issueRow.id)
      .executeTakeFirst(),
    db
      .selectFrom("classifieds")
      .select(db.fn.countAll<number>().as("n"))
      .where("issue_id", "=", issueRow.id)
      .executeTakeFirst(),
    db
      .selectFrom("ads")
      .select(db.fn.countAll<number>().as("n"))
      .where("issue_id", "=", issueRow.id)
      .executeTakeFirst(),
  ]);
  return {
    id: issueRow.id,
    title: issueRow.title,
    issueNumber: issueRow.issue_number,
    issueDate: issueRow.issue_date,
    pageSize: issueRow.page_size,
    typographyPairing: issueRow.typography_pairing,
    primaryLanguage: issueRow.primary_language,
    bwMode: issueRow.bw_mode === 1,
    articleCount: Number(articles?.n ?? 0),
    classifiedCount: Number(classifieds?.n ?? 0),
    adCount: Number(ads?.n ?? 0),
    createdAt: issueRow.created_at,
    updatedAt: issueRow.updated_at,
  };
}

export function registerIssueHandlers(): void {
  addHandler("issue:list", async () => {
    const { db } = getState();
    const rows = await db.selectFrom("issues").selectAll().orderBy("created_at", "desc").execute();
    return Promise.all(rows.map((r) => toSummary(r)));
  });

  addHandler("issue:get", async (payload: { id: string }) => {
    const { db } = getState();
    const row = await db
      .selectFrom("issues")
      .selectAll()
      .where("id", "=", payload.id)
      .executeTakeFirst();
    if (!row) return null;
    return toSummary(row);
  });

  addHandler("issue:create", async (payload: CreateIssueInput) => {
    const { db } = getState();
    const id = randomUUID();
    const now = nowISO();
    await db
      .insertInto("issues")
      .values({
        id,
        tenant_id: "publisher_default",
        title: payload.title,
        issue_number: payload.issueNumber,
        issue_date: payload.issueDate,
        page_size: payload.pageSize,
        typography_pairing: payload.typographyPairing,
        primary_language: payload.primaryLanguage,
        bw_mode: payload.bwMode ? 1 : 0,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const row = await db
      .selectFrom("issues")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return toSummary(row);
  });
}
