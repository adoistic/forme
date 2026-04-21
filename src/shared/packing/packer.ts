import type { ClassifiedType } from "@shared/schemas/classified.js";
import type { Language } from "@shared/schemas/language.js";

// Classifieds packing engine per CEO plan Section 14.3.
// Greedy bin-packing: group by (type, language), sort within group, flow into
// columns top-to-bottom; start a new column when current can't fit; start a new
// page when the current page is full; insert group headers + continuation.
// Entries taller than a full column become "Extended Notice" pages per CEO 2C.

export interface ClassifiedEntry {
  id: string;
  type: ClassifiedType;
  language: Language;
  /** Computed block height in mm (from Pretext measurement). */
  heightMM: number;
  /** Operator-set sort position; lower = earlier. Fallback is creation order. */
  sortKey: number;
}

export interface PackLayout {
  /** One per physical page in the classifieds section. */
  pages: PackedPage[];
}

export interface PackedPage {
  pageNumber: number;
  kind: "standard" | "extended_notice";
  columns: PackedColumn[];
  /** Only set for extended-notice pages. */
  extendedNoticeEntryId?: string;
  /** Section headers that appear at the top of this page. */
  topHeaders: GroupHeader[];
  /** 'continued from page N' footer when a group started earlier. */
  continuedFromPage?: number;
  /** 'continued on page N' header when a group continues. */
  continuesOnPage?: number;
}

export interface PackedColumn {
  columnIndex: number;
  heightMM: number;
  entries: PackedEntry[];
}

export interface PackedEntry {
  entryId: string;
  topMM: number;
  heightMM: number;
}

export interface GroupHeader {
  type: ClassifiedType;
  language: Language;
  label: string; // operator-visible, e.g. "MATRIMONIAL — WITH PHOTO (HINDI)"
  marksContinuation: boolean; // true when group started on a prior page
}

export interface PackerGeometry {
  /** mm available per column for entries. */
  columnHeightMM: number;
  columnCount: number;
  /** Extra mm consumed by a group header. */
  headerHeightMM: number;
  /** mm consumed by "continued from" marker. */
  continuationMarkerMM: number;
  /** Space between entries in the same column. */
  entryGapMM: number;
}

// Reasonable A4 defaults (A4 content area ~250mm tall, 3 columns)
export const DEFAULT_GEOMETRY: PackerGeometry = {
  columnHeightMM: 250,
  columnCount: 3,
  headerHeightMM: 12,
  continuationMarkerMM: 6,
  entryGapMM: 3,
};

export function packClassifieds(
  entries: ClassifiedEntry[],
  geometry: PackerGeometry = DEFAULT_GEOMETRY
): PackLayout {
  if (entries.length === 0) return { pages: [] };

  // Group by (type, language), keeping group order by first-occurrence
  const groupOrder: string[] = [];
  const groups = new Map<string, ClassifiedEntry[]>();
  for (const entry of entries) {
    const key = `${entry.type}|${entry.language}`;
    if (!groups.has(key)) {
      groupOrder.push(key);
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  // Sort within each group by sortKey
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.sortKey - b.sortKey);
  }

  const pages: PackedPage[] = [];
  let currentPage = newPage(pages.length + 1);

  // Flatten into a stream of "place this entry" ops, honoring group boundaries
  for (const groupKey of groupOrder) {
    const [typeStr, langStr] = groupKey.split("|");
    const type = typeStr as ClassifiedType;
    const language = langStr as Language;
    const groupEntries = groups.get(groupKey)!;
    const label = humanGroupLabel(type, language);
    let groupStartedOnPage = currentPage.pageNumber;
    let wroteHeaderOnPage = -1;

    for (const entry of groupEntries) {
      // Entry taller than a full column → Extended Notice dedicated page (CEO 2C)
      if (entry.heightMM > geometry.columnHeightMM) {
        // Close out the current page if it has content
        if (pageHasContent(currentPage)) {
          pages.push(currentPage);
          currentPage = newPage(pages.length + 1);
        }
        // Emit extended notice page
        const extPage = newPage(pages.length + 1);
        extPage.kind = "extended_notice";
        extPage.extendedNoticeEntryId = entry.id;
        extPage.topHeaders = [{ type, language, label, marksContinuation: false }];
        // Single "column" spanning the whole content area
        extPage.columns = [
          {
            columnIndex: 0,
            heightMM: entry.heightMM,
            entries: [{ entryId: entry.id, topMM: 0, heightMM: entry.heightMM }],
          },
        ];
        pages.push(extPage);
        // Group continues on next standard page if more entries remain
        currentPage = newPage(pages.length + 1);
        continue;
      }

      // Ensure we have a header for this group on current page if it's first
      // time on this page
      if (wroteHeaderOnPage !== currentPage.pageNumber) {
        const marksContinuation = groupStartedOnPage !== currentPage.pageNumber;
        currentPage.topHeaders.push({ type, language, label, marksContinuation });
        wroteHeaderOnPage = currentPage.pageNumber;
      }

      // Try to fit into the current column; if not, advance column; if no column
      // left, advance page.
      while (true) {
        const col = currentPage.columns[currentPage.columns.length - 1]!;
        const headerUsed = currentPage.topHeaders.length * geometry.headerHeightMM;
        const used =
          col.heightMM +
          (col.entries.length > 0 ? geometry.entryGapMM : 0) +
          entry.heightMM +
          (col.columnIndex === 0 ? headerUsed : 0);

        if (used <= geometry.columnHeightMM) {
          const topMM =
            col.heightMM + (col.entries.length > 0 ? geometry.entryGapMM : 0);
          col.entries.push({ entryId: entry.id, topMM, heightMM: entry.heightMM });
          col.heightMM = topMM + entry.heightMM;
          break;
        }

        // Start a new column if we have room
        if (col.columnIndex + 1 < geometry.columnCount) {
          currentPage.columns.push({
            columnIndex: col.columnIndex + 1,
            heightMM: 0,
            entries: [],
          });
          continue;
        }

        // Page is full — flush + start new page
        pages.push(currentPage);
        currentPage = newPage(pages.length + 1);
        // Group continues, mark header as continuation on the new page
        const contHeader: GroupHeader = {
          type,
          language,
          label,
          marksContinuation: true,
        };
        currentPage.topHeaders.push(contHeader);
        wroteHeaderOnPage = currentPage.pageNumber;
        // Back to the while loop which re-evaluates against the new page's
        // fresh first column
      }
    }

    groupStartedOnPage = currentPage.pageNumber;
  }

  // Emit the final page if it has content
  if (pageHasContent(currentPage)) {
    pages.push(currentPage);
  }

  // Second pass: fill continuedFromPage / continuesOnPage links
  linkContinuations(pages);

  return { pages };
}

function newPage(pageNumber: number): PackedPage {
  return {
    pageNumber,
    kind: "standard",
    columns: [{ columnIndex: 0, heightMM: 0, entries: [] }],
    topHeaders: [],
  };
}

function pageHasContent(page: PackedPage): boolean {
  return page.columns.some((c) => c.entries.length > 0);
}

function linkContinuations(pages: PackedPage[]): void {
  // A group continues if a later page has a header with marksContinuation=true
  // and the same (type, language). For each such pair, set continuedFromPage /
  // continuesOnPage on the boundary pages.
  for (let i = 0; i < pages.length - 1; i += 1) {
    const current = pages[i]!;
    const next = pages[i + 1]!;
    for (const nextHeader of next.topHeaders) {
      if (!nextHeader.marksContinuation) continue;
      const started = current.topHeaders.find(
        (h) => h.type === nextHeader.type && h.language === nextHeader.language
      );
      if (started) {
        current.continuesOnPage = next.pageNumber;
        next.continuedFromPage = current.pageNumber;
      }
    }
  }
}

export function humanGroupLabel(type: ClassifiedType, language: Language): string {
  const typeLabel = type.replace(/_/g, " ").toUpperCase();
  const langLabel = language === "hi" ? "HINDI" : "ENGLISH";
  return `${typeLabel} (${langLabel})`;
}
