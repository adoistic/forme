import path from "node:path";
import { addHandler } from "../register.js";
import { getState } from "../../app-state.js";
import { buildPptx } from "@shared/pptx-builder/build.js";
import { preLayoutForTemplate } from "../../pptx-prelayout/layout.js";
import { makeError } from "@shared/errors/structured.js";
import type {
  ExportIssueInput,
  ExportIssueResult,
} from "@shared/ipc-contracts/channels.js";
import type {
  PptxAd,
  PptxClassified,
  PptxPlacement,
} from "@shared/pptx-builder/types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("export");

/**
 * Turn a classified's raw fields into a displayable title + body lines.
 * Handles the 5 common types directly; falls back to a key: value listing
 * for the rest. Keeps the PPTX builder dumb.
 */
function renderClassified(
  type: string,
  f: Record<string, unknown>
): { displayName: string; bodyLines: string[] } {
  const s = (k: string): string => String(f[k] ?? "").trim();
  const phones = (k: string): string => {
    const v = f[k];
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "string") return v;
    return "";
  };
  switch (type) {
    case "matrimonial_with_photo":
    case "matrimonial_no_photo": {
      const title = [s("name"), s("age")].filter(Boolean).join(", ");
      const lines = [
        [s("education"), s("occupation")].filter(Boolean).join(", "),
        [s("location"), s("religion_community")].filter(Boolean).join(" · "),
        [s("contact_name"), phones("contact_phones")].filter(Boolean).join(" — "),
      ].filter(Boolean);
      return { displayName: title || "Match sought", bodyLines: lines };
    }
    case "obituary": {
      const title = s("name_of_deceased") || "Obituary";
      const ageLine = s("age") ? `Age ${s("age")}` : "";
      const deathLine = s("date_of_death") ? `Passed ${s("date_of_death")}` : "";
      const lines = [
        [ageLine, deathLine].filter(Boolean).join(" · "),
        s("life_summary"),
        s("surviving_family"),
        s("prayer_meeting"),
      ].filter(Boolean);
      return { displayName: title, bodyLines: lines };
    }
    case "public_notice": {
      const title = s("notice_type")
        ? `Public notice — ${s("notice_type").replace(/_/g, " ")}`
        : "Public notice";
      const lines = [
        s("notice_text"),
        s("published_by") ? `Published by ${s("published_by")}` : "",
        s("date"),
      ].filter(Boolean);
      return { displayName: title, bodyLines: lines };
    }
    case "announcement": {
      const occasion = s("occasion_type").replace(/_/g, " ");
      const title = s("recipient_name")
        ? `${occasion}: ${s("recipient_name")}`
        : occasion || "Announcement";
      const senders = Array.isArray(f["sender_names"])
        ? (f["sender_names"] as string[]).join(", ")
        : s("sender_names");
      const lines = [s("message_text"), senders ? `— ${senders}` : ""].filter(Boolean);
      return { displayName: title, bodyLines: lines };
    }
    case "vehicles": {
      const title = [s("year"), s("make"), s("model")].filter(Boolean).join(" ");
      const km = s("kilometers") ? `${s("kilometers")} km` : "";
      const lines = [
        [km, s("fuel_type")].filter(Boolean).join(" · "),
        s("expected_price"),
        s("location"),
        phones("contact_phones"),
      ].filter(Boolean);
      return { displayName: title || "Vehicle for sale", bodyLines: lines };
    }
    default: {
      // Fallback: list fields as key: value pairs. Skips nested objects.
      const entries = Object.entries(f).filter(
        ([, v]) => v !== null && v !== undefined && v !== ""
      );
      const displayName =
        (typeof f["title"] === "string" && f["title"]) ||
        (typeof f["headline"] === "string" && f["headline"]) ||
        type.replace(/_/g, " ");
      const lines = entries
        .slice(0, 6)
        .map(([k, v]) => {
          if (Array.isArray(v)) return `${labelize(k)}: ${v.join(", ")}`;
          return `${labelize(k)}: ${String(v)}`;
        });
      return { displayName: String(displayName), bodyLines: lines };
    }
  }
}

function labelize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pull initials from a display name, e.g. "Aanya Sharma, 29" → "AS".
 * Falls back to the first two letters when only one word is available.
 */
function monogramInitials(displayName: string): string {
  const cleaned = displayName.replace(/[,(].*$/, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

/**
 * Tiny SVG monogram used as a placeholder when matrimonial_with_photo
 * lacks a real photo. Keeps the layout exercising the "image present"
 * branch so the rendered page still demonstrates the type's visual
 * treatment. Returns base64-encoded SVG bytes.
 */
function monogramSvg(initials: string): string {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="#F5EFE7"/>
  <circle cx="100" cy="100" r="92" fill="none" stroke="#C96E4E" stroke-width="2"/>
  <text x="100" y="120" font-family="Georgia, serif" font-size="80" font-weight="700"
        text-anchor="middle" fill="#C96E4E">${initials}</text>
</svg>`;
  return Buffer.from(svg, "utf-8").toString("base64");
}

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
    const { db, templates, exportDir, blobs } = getState();

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

    // Templates available for this issue's page size
    const matchingTemplates = templates.filter((t) => t.page_size === issueRow.page_size);
    if (matchingTemplates.length === 0) {
      throw makeError("no_viable_template", "error", {
        reason: `no templates for page size ${issueRow.page_size}`,
      });
    }
    const featureTemplate =
      matchingTemplates.find((t) => t.id === "standard_feature_a4") ??
      matchingTemplates[0]!;
    const photoEssayTemplate = matchingTemplates.find((t) => t.id === "photo_essay_a4");

    /**
     * Pick the right template per article. Rules (MVP, will become a
     * Phase-11 auto-fit scoring pass):
     *   - content_type === "Photo Essay" → photo_essay layout
     *   - hero image present AND body short OR explicitly visual →
     *     photo_essay layout
     *   - everything else → standard feature
     *
     * For now any article with a hero image gets the photo-essay
     * treatment — image-driven stories deserve the wider, two-column
     * layout. Pure-text articles stay with the three-column feature.
     */
    const pickTemplate = (article: { body: string; content_type: string }, hasHero: boolean) => {
      if (photoEssayTemplate && (article.content_type === "Photo Essay" || hasHero)) {
        return photoEssayTemplate;
      }
      return featureTemplate;
    };

    // Build placements — Phase 2 scope: each article becomes its own placement,
    // starting pages are sequential. Phase 11+ will add auto-fit scoring + real
    // multi-template composition.
    let nextPageNumber = 1;
    const placements: PptxPlacement[] = [];    for (const article of articleRows) {
      // Load hero image (if any) — first article_images row with role=hero
      let heroImage:
        | { mimeType: string; base64: string; widthPx: number; heightPx: number }
        | undefined;
      const heroRow = await db
        .selectFrom("article_images")
        .innerJoin("images", "images.blob_hash", "article_images.blob_hash")
        .select([
          "article_images.blob_hash",
          "images.mime_type",
          "images.width",
          "images.height",
        ])
        .where("article_images.article_id", "=", article.id)
        .where("article_images.role", "=", "hero")
        .orderBy("article_images.position", "asc")
        .executeTakeFirst();
      if (heroRow) {
        try {
          const bytes = await blobs.readBuffer(heroRow.blob_hash);
          heroImage = {
            mimeType: heroRow.mime_type,
            base64: bytes.toString("base64"),
            widthPx: heroRow.width,
            heightPx: heroRow.height,
          };
        } catch (err) {
          logger.warn(
            { articleId: article.id, err: String(err) },
            "hero image blob read failed — article will export without it"
          );
        }
      }

      const bylinePosition: "top" | "end" =
        article.byline_position === "end" ? "end" : "top";
      const language = article.language as "en" | "hi" | "bilingual";
      const chosenTemplate = pickTemplate(article, !!heroImage);

      // Hero placement: prefer the operator-set value from the article
      // edit modal. Fall back to "above-headline" for any article routed
      // to the photo_essay template. Final fallback is "below-headline".
      const dbHeroPlacement = article.hero_placement as
        | "below-headline"
        | "above-headline"
        | "full-bleed"
        | undefined;
      let heroPlacement: "below-headline" | "above-headline" | "full-bleed";
      if (
        dbHeroPlacement === "above-headline" ||
        dbHeroPlacement === "full-bleed" ||
        dbHeroPlacement === "below-headline"
      ) {
        heroPlacement = dbHeroPlacement;
      } else if (
        chosenTemplate.family === "photo_essay" ||
        article.content_type === "Photo Essay"
      ) {
        heroPlacement = heroImage ? "above-headline" : "below-headline";
      } else {
        heroPlacement = "below-headline";
      }
      // No hero → no point honoring above-headline / full-bleed.
      if (!heroImage) heroPlacement = "below-headline";

      // Pre-break the body into per-page-per-column lines so PowerPoint's
      // text engine can't re-wrap and overflow the column boxes.
      let prelaidPages: string[][][] = [];
      try {
        prelaidPages = await preLayoutForTemplate({
          body: article.body,
          language,
          hasDeck: !!article.deck,
          hasTopByline: !!article.byline && bylinePosition === "top",
          hasHero: !!heroImage,
          heroPlacement,
          template: {
            trim_mm: chosenTemplate.geometry.trim_mm,
            margins_mm: chosenTemplate.geometry.margins_mm,
            columns: chosenTemplate.geometry.columns,
            gutter_mm: chosenTemplate.geometry.gutter_mm,
            typography: {
              headline_pt: chosenTemplate.typography.headline_pt,
              ...(chosenTemplate.typography.deck_pt !== undefined
                ? { deck_pt: chosenTemplate.typography.deck_pt }
                : {}),
              body_pt: chosenTemplate.typography.body_pt,
              body_leading_pt: chosenTemplate.typography.body_leading_pt,
            },
            page_count_range: chosenTemplate.page_count_range,
          },
        });
      } catch (err) {
        logger.warn(
          { articleId: article.id, err: String(err) },
          "pretext layout failed — falling back to legacy heuristic"
        );
      }

      // Caption + credit: prefer operator-set; fall back to deck +
      // generic credit for image-led layouts.
      const heroCaption =
        article.hero_caption ??
        (heroPlacement !== "below-headline" && article.deck ? article.deck : undefined);
      const heroCredit =
        article.hero_credit ??
        (heroPlacement !== "below-headline" ? "Lorem Picsum / Unsplash" : undefined);

      // Section override: operator-set value wins.
      const section =
        article.section ??
        (chosenTemplate.family === "photo_essay"
          ? "Photo Essay"
          : article.content_type === "Opinion"
          ? "Opinion"
          : article.content_type === "Interview"
          ? "Interview"
          : "Features");

      placements.push({
        articleId: article.id,
        template: chosenTemplate,
        startingPageNumber: nextPageNumber,
        article: {
          headline: article.headline,
          // Drop the deck on image-led layouts when we've already used it
          // as the image caption — avoids duplicating the same line.
          deck:
            heroPlacement !== "below-headline" && heroCaption === article.deck
              ? null
              : article.deck,
          byline: article.byline,
          bylinePosition,
          section,
          body: article.body,
          language,
          heroPlacement,
          ...(heroCaption ? { heroCaption } : {}),
          ...(heroCredit ? { heroCredit } : {}),
          ...(prelaidPages.length > 0 ? { prelaidPages } : {}),
          ...(heroImage ? { heroImage } : {}),
        },
      });
      nextPageNumber += Math.max(prelaidPages.length, chosenTemplate.page_count_range[0]);
    }

    // Load ads for this issue, read their image bytes, base64-encode
    const adRows = await db
      .selectFrom("ads")
      .selectAll()
      .where("issue_id", "=", payload.issueId)
      .orderBy("created_at", "asc")
      .execute();
    const ads: PptxAd[] = [];
    for (const ad of adRows) {
      try {
        const imgMeta = await db
          .selectFrom("images")
          .select(["mime_type", "width", "height"])
          .where("blob_hash", "=", ad.creative_blob_hash)
          .executeTakeFirst();
        if (!imgMeta) continue;
        const { blobs } = getState();
        const bytes = await blobs.readBuffer(ad.creative_blob_hash);
        ads.push({
          slotType: ad.slot_type,
          positionLabel: ad.position_label,
          kind: ad.kind as PptxAd["kind"],
          bwFlag: ad.bw_flag === 1,
          mimeType: imgMeta.mime_type,
          base64: bytes.toString("base64"),
          widthPx: imgMeta.width,
          heightPx: imgMeta.height,
        });
      } catch (err) {
        logger.warn({ adId: ad.id, err: String(err) }, "skipping ad (blob read failed)");
      }
    }

    // Load classifieds and turn each into a displayable entry
    const classifiedRows = await db
      .selectFrom("classifieds")
      .selectAll()
      .where((eb) => eb.or([eb("issue_id", "=", payload.issueId), eb("issue_id", "is", null)]))
      .orderBy("type", "asc")
      .orderBy("created_at", "asc")
      .execute();
    const classifieds: PptxClassified[] = [];
    for (const row of classifiedRows) {
      let fields: Record<string, unknown> = {};
      try {
        fields = JSON.parse(row.fields_json) as Record<string, unknown>;
      } catch {
        fields = {};
      }
      const rendered = renderClassified(row.type, fields);
      let photoBase64: string | undefined;
      let photoMimeType: string | undefined;
      // Real photo from blob store, if any
      if (row.photo_blob_hash) {
        try {
          const bytes = await blobs.readBuffer(row.photo_blob_hash);
          const meta = await db
            .selectFrom("images")
            .select(["mime_type"])
            .where("blob_hash", "=", row.photo_blob_hash)
            .executeTakeFirst();
          photoBase64 = bytes.toString("base64");
          photoMimeType = meta?.mime_type ?? "image/png";
        } catch {
          // missing blob — fall through to placeholder/none
        }
      }
      // For matrimonial_with_photo without a real photo, drop in a
      // generic monogram so the visual treatment still demonstrates.
      if (!photoBase64 && row.type === "matrimonial_with_photo") {
        const initials = monogramInitials(rendered.displayName);
        photoBase64 = monogramSvg(initials);
        photoMimeType = "image/svg+xml";
      }
      classifieds.push({
        type: row.type,
        language: row.language as "en" | "hi",
        displayName: rendered.displayName,
        bodyLines: rendered.bodyLines,
        ...(photoBase64 ? { photoBase64 } : {}),
        ...(photoMimeType ? { photoMimeType } : {}),
      });
    }

    const filename = `${slugify(issueRow.title)}-${issueRow.issue_date}.pptx`;
    const outputPath = path.join(exportDir, filename);

    logger.info(
      {
        issueId: payload.issueId,
        outputPath,
        articles: placements.length,
        ads: ads.length,
        classifieds: classifieds.length,
      },
      "Exporting issue"
    );

    // Cover image: reuse the first article's hero (visually strong + already
    // loaded). Fall back to none if no article has a hero.
    const firstHero = placements.find((p) => p.article.heroImage)?.article.heroImage;
    const profileRow = await db
      .selectFrom("publisher_profile")
      .select(["publication_name"])
      .where("tenant_id", "=", "publisher_default")
      .executeTakeFirst();
    const profileName = profileRow?.publication_name?.trim();
    // If no publisher profile is set, derive a publication name from the
    // issue title — strip anything after " — " or " - " so the cover
    // wordmark stays short.
    const publicationName =
      profileName && profileName.length > 0
        ? profileName
        : issueRow.title.split(/\s+[—-]\s+/)[0]!.trim();

    const result = await buildPptx(
      {
        issueTitle: issueRow.title,
        issueNumber: issueRow.issue_number,
        issueDate: issueRow.issue_date,
        publicationName,
        placements,
        ads,
        classifieds,
        ...(firstHero ? { coverImage: firstHero } : {}),
        coverLines: placements.slice(0, 4).map((p) => p.article.headline),
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
