import { describe, expect, test } from "vitest";
import {
  packClassifieds,
  humanGroupLabel,
  type ClassifiedEntry,
  type PackerGeometry,
} from "../../../../src/shared/packing/packer.js";

const tinyGeometry: PackerGeometry = {
  columnHeightMM: 100,
  columnCount: 3,
  headerHeightMM: 10,
  continuationMarkerMM: 4,
  entryGapMM: 2,
};

function entry(
  id: string,
  type: ClassifiedEntry["type"],
  lang: ClassifiedEntry["language"],
  height: number,
  sortKey = 0
): ClassifiedEntry {
  return { id, type, language: lang, heightMM: height, sortKey };
}

describe("packClassifieds — empty + trivial", () => {
  test("empty input → zero pages", () => {
    expect(packClassifieds([]).pages).toEqual([]);
  });

  test("single small entry fits on one page, one column", () => {
    const layout = packClassifieds([entry("a", "matrimonial_with_photo", "en", 20)], tinyGeometry);
    expect(layout.pages).toHaveLength(1);
    const p = layout.pages[0]!;
    expect(p.topHeaders).toHaveLength(1);
    expect(p.columns[0]!.entries).toHaveLength(1);
  });
});

describe("packClassifieds — grouping + headers", () => {
  test("entries of same (type, language) share one header", () => {
    const layout = packClassifieds(
      [
        entry("a1", "matrimonial_with_photo", "en", 20, 0),
        entry("a2", "matrimonial_with_photo", "en", 20, 1),
        entry("a3", "matrimonial_with_photo", "en", 20, 2),
      ],
      tinyGeometry
    );
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.topHeaders).toHaveLength(1);
  });

  test("different types get separate headers", () => {
    const layout = packClassifieds(
      [entry("a", "matrimonial_with_photo", "en", 20), entry("b", "obituary", "en", 20)],
      tinyGeometry
    );
    const headers = layout.pages[0]!.topHeaders;
    expect(headers).toHaveLength(2);
  });

  test("same type different languages are separate groups", () => {
    const layout = packClassifieds(
      [
        entry("a", "matrimonial_with_photo", "en", 20),
        entry("b", "matrimonial_with_photo", "hi", 20),
      ],
      tinyGeometry
    );
    const headers = layout.pages[0]!.topHeaders;
    expect(headers).toHaveLength(2);
    expect(headers[0]!.language).toBe("en");
    expect(headers[1]!.language).toBe("hi");
  });
});

describe("packClassifieds — column + page overflow", () => {
  test("entries fill columns top-to-bottom", () => {
    // Column is 100mm, entries are 30mm each. ~3 per column after header.
    const entries = Array.from({ length: 4 }, (_, i) =>
      entry(`e${i}`, "matrimonial_with_photo", "en", 30, i)
    );
    const layout = packClassifieds(entries, tinyGeometry);
    expect(layout.pages).toHaveLength(1);
    const cols = layout.pages[0]!.columns;
    expect(cols.length).toBeGreaterThanOrEqual(2);
  });

  test("overflow starts a new page with continuation", () => {
    // 10 entries of 30mm; 3 columns x ~3 each = 9 per page, so 10 → 2 pages
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry(`e${i}`, "matrimonial_with_photo", "en", 30, i)
    );
    const layout = packClassifieds(entries, tinyGeometry);
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const page2 = layout.pages[1]!;
    // The continuation header should mark this as a continuation
    expect(page2.topHeaders[0]!.marksContinuation).toBe(true);
    expect(page2.continuedFromPage).toBe(1);
    expect(layout.pages[0]!.continuesOnPage).toBe(2);
  });
});

describe("packClassifieds — extended notice", () => {
  test("entry taller than one column → dedicated extended_notice page", () => {
    const layout = packClassifieds(
      [
        entry("a", "matrimonial_with_photo", "en", 20),
        entry("big", "public_notice", "en", 300), // taller than 100mm column
        entry("z", "obituary", "en", 20),
      ],
      tinyGeometry
    );
    const kinds = layout.pages.map((p) => p.kind);
    expect(kinds).toContain("extended_notice");
    const ext = layout.pages.find((p) => p.kind === "extended_notice")!;
    expect(ext.extendedNoticeEntryId).toBe("big");
    expect(ext.columns).toHaveLength(1);
    expect(ext.columns[0]!.entries).toHaveLength(1);
  });

  test("extended notice doesn't eat content that came before", () => {
    const layout = packClassifieds(
      [entry("a", "matrimonial_with_photo", "en", 20), entry("big", "public_notice", "en", 400)],
      tinyGeometry
    );
    expect(layout.pages).toHaveLength(2);
    const standardPage = layout.pages[0]!;
    expect(standardPage.kind).toBe("standard");
    expect(standardPage.columns[0]!.entries).toHaveLength(1);
    expect(standardPage.columns[0]!.entries[0]!.entryId).toBe("a");
  });
});

describe("packClassifieds — sort key", () => {
  test("respects sortKey within group", () => {
    const entries = [
      entry("c", "matrimonial_with_photo", "en", 20, 2),
      entry("a", "matrimonial_with_photo", "en", 20, 0),
      entry("b", "matrimonial_with_photo", "en", 20, 1),
    ];
    const layout = packClassifieds(entries, tinyGeometry);
    const ids = layout.pages[0]!.columns.flatMap((c) => c.entries.map((e) => e.entryId));
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("humanGroupLabel", () => {
  test("formats type + language", () => {
    expect(humanGroupLabel("matrimonial_with_photo", "hi")).toBe("MATRIMONIAL WITH PHOTO (HINDI)");
    expect(humanGroupLabel("public_notice", "en")).toBe("PUBLIC NOTICE (ENGLISH)");
  });
});
