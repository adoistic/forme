import path from "node:path";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { buildPptx } from "@shared/pptx-builder/build.js";
import { makeError } from "@shared/errors/structured.js";
import type {
  ExportIssueInput,
  ExportIssueResult,
} from "@shared/ipc-contracts/channels.js";
import type { PptxPlacement } from "@shared/pptx-builder/types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("export");

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "issue"
  );
}

export function registerExportHandlers(): void {
  addHandler("export:pptx", async (payload: ExportIssueInput): Promise<ExportIssueResult> => {
    const { db, templates, exportDir } = getState();

    const issueRow = await db
      .selectFrom("issues")
      .selectAll()
      .where("id", "=", payload.issueId)
      .executeTakeFirst();
    if (!issueRow) {
      throw makeError("ipc_handler_threw", "error", {
        reason: `issue not found: ${payload.issueId}`,
      });
    }

    const articleRows = await db
      .selectFrom("articles")
      .selectAll()
      .where("issue_id", "=", payload.issueId)
      .orderBy("created_at", "asc")
      .execute();

    if (articleRows.length === 0) {
      throw makeError("template_incomplete", "error", {
        article_title: issueRow.title,
        field: "at least one article",
      });
    }

    // Default template: first matching page_size for this issue
    const matchingTemplates = templates.filter((t) => t.page_size === issueRow.page_size);
    const template = matchingTemplates.find((t) => t.id === "standard_feature_a4") ?? matchingTemplates[0];
    if (!template) {
      throw makeError("no_viable_template", "error", {
        reason: `no templates for page size ${issueRow.page_size}`,
      });
    }

    // Build placements — Phase 2 scope: each article becomes its own placement,
    // starting pages are sequential. Phase 11+ will add auto-fit scoring + real
    // multi-template composition.
    let nextPageNumber = 1;
    const placements: PptxPlacement[] = [];
    for (const article of articleRows) {
      placements.push({
        articleId: article.id,
        template,
        startingPageNumber: nextPageNumber,
        article: {
          headline: article.headline,
          deck: article.deck,
          byline: article.byline,
          body: article.body,
          language: article.language as "en" | "hi" | "bilingual",
        },
      });
      nextPageNumber += template.page_count_range[0];
    }

    const filename = `${slugify(issueRow.title)}-${issueRow.issue_date}.pptx`;
    const outputPath = path.join(exportDir, filename);

    logger.info({ issueId: payload.issueId, outputPath, placements: placements.length }, "Exporting issue");

    const result = await buildPptx(
      {
        issueTitle: issueRow.title,
        issueNumber: issueRow.issue_number,
        issueDate: issueRow.issue_date,
        publicationName: "Forme",
        placements,
      },
      outputPath
    );

    return {
      outputPath: result.outputPath,
      bytes: result.bytes,
      pageCount: result.pageCount,
      warnings: result.warnings,
    };
  });
}
