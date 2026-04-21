import type { SerializedIssue } from "./types.js";

// Generate a one-line description for a snapshot based on what changed from the
// previous snapshot. Per CEO plan Section 17.2 — examples:
//   "Edited article: Modi visits Delhi"
//   "Added 4 classifieds"
//   "Replaced cover image"
//   "Changed typography pairing to News Sans"
//   "Reordered pages 12-18"
//   "Auto-save"

export function describeDiff(prev: SerializedIssue | null, next: SerializedIssue): string {
  if (!prev) {
    return `Created issue "${truncate(next.title, 40)}"`;
  }

  // Typography pairing change
  if (prev.typography_pairing !== next.typography_pairing) {
    return `Changed typography pairing to ${next.typography_pairing}`;
  }

  // Page size change
  if (prev.page_size !== next.page_size) {
    return `Changed page size to ${next.page_size}`;
  }

  // B&W toggle
  if (prev.bw_mode !== next.bw_mode) {
    return next.bw_mode ? "Switched to black-and-white mode" : "Switched to color mode";
  }

  // Article counts
  const prevArticleIds = new Set(prev.articles.map((a) => a.id));
  const nextArticleIds = new Set(next.articles.map((a) => a.id));
  const addedArticles = next.articles.filter((a) => !prevArticleIds.has(a.id));
  const removedArticles = prev.articles.filter((a) => !nextArticleIds.has(a.id));

  if (addedArticles.length === 1 && removedArticles.length === 0) {
    return `Added article: ${truncate(addedArticles[0]!.headline, 40)}`;
  }
  if (addedArticles.length > 1 && removedArticles.length === 0) {
    return `Added ${addedArticles.length} articles`;
  }
  if (removedArticles.length === 1 && addedArticles.length === 0) {
    return `Removed article: ${truncate(removedArticles[0]!.headline, 40)}`;
  }
  if (removedArticles.length > 1 && addedArticles.length === 0) {
    return `Removed ${removedArticles.length} articles`;
  }

  // Article edit (same id, different headline)
  const editedArticle = next.articles.find((a) => {
    const prevMatch = prev.articles.find((p) => p.id === a.id);
    return prevMatch && prevMatch.headline !== a.headline;
  });
  if (editedArticle) {
    return `Edited article: ${truncate(editedArticle.headline, 40)}`;
  }

  // Classifieds
  const classifiedDelta = next.classifieds.length - prev.classifieds.length;
  if (classifiedDelta > 0) {
    // Grouped by type for friendlier message
    const byType = new Map<string, number>();
    const prevIds = new Set(prev.classifieds.map((c) => c.id));
    for (const c of next.classifieds) {
      if (!prevIds.has(c.id)) {
        byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
      }
    }
    if (byType.size === 1) {
      const entry = [...byType.entries()][0];
      if (entry) {
        const [type, count] = entry;
        return `Added ${count} ${formatClassifiedType(type)} classified${count === 1 ? "" : "s"}`;
      }
    }
    return `Added ${classifiedDelta} classified${classifiedDelta === 1 ? "" : "s"}`;
  }
  if (classifiedDelta < 0) {
    return `Removed ${Math.abs(classifiedDelta)} classified${classifiedDelta === -1 ? "" : "s"}`;
  }

  // Ads
  const adDelta = next.ads.length - prev.ads.length;
  if (adDelta > 0) {
    return `Added ${adDelta} ad${adDelta === 1 ? "" : "s"}`;
  }
  if (adDelta < 0) {
    return `Removed ${Math.abs(adDelta)} ad${adDelta === -1 ? "" : "s"}`;
  }

  // Placements
  const prevPlacementIds = new Set(prev.placements.map((p) => p.id));
  const nextPlacementIds = new Set(next.placements.map((p) => p.id));
  const addedPlacements = next.placements.filter((p) => !prevPlacementIds.has(p.id));
  const removedPlacements = prev.placements.filter((p) => !nextPlacementIds.has(p.id));

  if (addedPlacements.length > 0 && removedPlacements.length === 0) {
    if (addedPlacements.length === 1) {
      return `Placed on page ${addedPlacements[0]!.page_number}`;
    }
    return `Placed ${addedPlacements.length} items`;
  }

  // Page reorders — same ids but different page_numbers
  const reordered = next.placements.filter((p) => {
    const prev_p = prev.placements.find((q) => q.id === p.id);
    return prev_p && prev_p.page_number !== p.page_number;
  });
  if (reordered.length > 0) {
    const pages = reordered.map((p) => p.page_number).sort((a, b) => a - b);
    if (pages.length === 1) return `Moved placement to page ${pages[0]}`;
    return `Reordered pages ${pages[0]}-${pages[pages.length - 1]}`;
  }

  // Title edit
  if (prev.title !== next.title) {
    return `Renamed issue to "${truncate(next.title, 40)}"`;
  }

  return "Auto-save";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function formatClassifiedType(type: string): string {
  // matrimonial_with_photo → "matrimonial with photo"
  return type.replace(/_/g, " ");
}
