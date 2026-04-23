/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<ArticleHistoryPanel>` (T7 / v0.6).
 *
 * The component fetches snapshots via the typed IPC client. Tests mock
 * the `invoke` export so we can assert on the shape of the calls and
 * stub responses without spinning up Electron's preload bridge.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { ArticleSnapshotSummary } from "../../../src/shared/ipc-contracts/channels.js";

// Mock the IPC client BEFORE importing the component. vitest hoists
// vi.mock calls, so the import below resolves to the mock.
vi.mock("../../../src/renderer/ipc/client.js", () => ({
  invoke: vi.fn(),
  IpcError: class IpcError extends Error {},
}));

import { invoke } from "../../../src/renderer/ipc/client.js";
import {
  ArticleHistoryPanel,
  bucketForDate,
} from "../../../src/renderer/components/article-history-panel/ArticleHistoryPanel.js";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

/**
 * Build a snapshot summary anchored to a known "now". Times are
 * computed relative to NOW so date-bucketing stays deterministic across
 * test runs.
 */
const NOW = new Date("2026-04-23T15:00:00Z");

function snap(
  overrides: Partial<ArticleSnapshotSummary> & { id: string; minutesAgo?: number; daysAgo?: number }
): ArticleSnapshotSummary {
  const created = new Date(NOW);
  if (overrides.minutesAgo) created.setMinutes(created.getMinutes() - overrides.minutesAgo);
  if (overrides.daysAgo) created.setDate(created.getDate() - overrides.daysAgo);
  return {
    id: overrides.id,
    articleId: "art-1",
    createdAt: created.toISOString(),
    label: overrides.label ?? null,
    starred: overrides.starred ?? false,
    sizeBytes: overrides.sizeBytes ?? 1024,
    blockSchemaVersion: overrides.blockSchemaVersion ?? 1,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockedInvoke.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Render the panel and wait for the initial snapshot:list fetch to
 * settle. Returns the resolved test utilities so callers don't need to
 * worry about act() warnings.
 */
async function renderPanel(props: {
  snapshots: ArticleSnapshotSummary[];
  selectedSnapshotId?: string | null;
  onSelect?: (id: string | null) => void;
  onRestore?: (id: string) => void;
}): Promise<ReturnType<typeof render>> {
  mockedInvoke.mockResolvedValueOnce(props.snapshots);
  const utils = render(
    <ArticleHistoryPanel
      articleId="art-1"
      selectedSnapshotId={props.selectedSnapshotId ?? null}
      onSelect={props.onSelect ?? (() => {})}
      onRestore={props.onRestore ?? (() => {})}
    />
  );
  // Flush the resolved IPC promise.
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

describe("bucketForDate (pure helper)", () => {
  test("buckets times within today as TODAY", () => {
    const t = new Date(NOW);
    t.setHours(t.getHours() - 1);
    expect(bucketForDate(t.toISOString(), NOW)).toBe("TODAY");
  });

  test("buckets yesterday's times as YESTERDAY", () => {
    const t = new Date(NOW);
    t.setDate(t.getDate() - 1);
    t.setHours(10);
    expect(bucketForDate(t.toISOString(), NOW)).toBe("YESTERDAY");
  });

  test("buckets 3-day-old times as LAST WEEK", () => {
    const t = new Date(NOW);
    t.setDate(t.getDate() - 3);
    expect(bucketForDate(t.toISOString(), NOW)).toBe("LAST WEEK");
  });

  test("buckets 30-day-old times as OLDER", () => {
    const t = new Date(NOW);
    t.setDate(t.getDate() - 30);
    expect(bucketForDate(t.toISOString(), NOW)).toBe("OLDER");
  });
});

describe("<ArticleHistoryPanel>", () => {
  test("renders the empty state when no snapshots exist", async () => {
    await renderPanel({ snapshots: [] });

    expect(mockedInvoke).toHaveBeenCalledWith("snapshot:list", { articleId: "art-1" });
    expect(screen.getByTestId("article-history-empty").textContent).toContain(
      "No version history yet"
    );
  });

  test("renders date-grouped sections with sample snapshots", async () => {
    const data = [
      snap({ id: "s1", minutesAgo: 30, label: "current draft" }),
      snap({ id: "s2", daysAgo: 1, label: "first edit pass" }),
      snap({ id: "s3", daysAgo: 3, label: "second draft" }),
      snap({ id: "s4", daysAgo: 30, label: "initial outline" }),
    ];
    await renderPanel({ snapshots: data });

    // All four bucket sections should appear, in order.
    expect(screen.getByText("TODAY")).toBeTruthy();
    expect(screen.getByText("YESTERDAY")).toBeTruthy();
    expect(screen.getByText("LAST WEEK")).toBeTruthy();
    expect(screen.getByText("OLDER")).toBeTruthy();
    expect(screen.getByText("4 versions")).toBeTruthy();
  });

  test("selected row gets the rust 2px left border", async () => {
    const data = [snap({ id: "s1", minutesAgo: 5, label: "now" })];
    await renderPanel({ snapshots: data, selectedSnapshotId: "s1" });

    const row = screen.getByTestId("article-history-row-s1");
    // DESIGN.md ScrubTimeline: "selected row: cream bg + 2px rust left border".
    expect(row.className).toContain("border-l-2");
    expect(row.className).toContain("border-accent");
    expect(row.className).toContain("bg-bg-canvas");
  });

  test("clicking a row calls onSelect with the snapshot id", async () => {
    const data = [snap({ id: "s1", minutesAgo: 5 }), snap({ id: "s2", minutesAgo: 60 })];
    const onSelect = vi.fn();
    await renderPanel({ snapshots: data, onSelect });

    fireEvent.click(screen.getByTestId("article-history-row-s2"));
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  test("ArrowDown / ArrowUp step through snapshots", async () => {
    const data = [
      snap({ id: "s1", minutesAgo: 5 }),
      snap({ id: "s2", minutesAgo: 60 }),
      snap({ id: "s3", minutesAgo: 120 }),
    ];
    const onSelect = vi.fn();
    await renderPanel({ snapshots: data, selectedSnapshotId: "s1", onSelect });

    const panel = screen.getByTestId("article-history-panel");
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith("s2");

    onSelect.mockClear();
    // Re-render with the next selection so currentIdx moves.
    cleanup();
    mockedInvoke.mockResolvedValueOnce(data);
    render(
      <ArticleHistoryPanel
        articleId="art-1"
        selectedSnapshotId="s2"
        onSelect={onSelect}
        onRestore={() => {}}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.keyDown(screen.getByTestId("article-history-panel"), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenLastCalledWith("s1");
  });

  test("Restore button hidden when no snapshot selected (current draft)", async () => {
    const data = [snap({ id: "s1", minutesAgo: 5 })];
    await renderPanel({ snapshots: data, selectedSnapshotId: null });
    expect(screen.queryByTestId("article-history-restore")).toBeNull();
  });

  test("Restore button shows when a non-current snapshot is selected, click fires onRestore", async () => {
    const data = [snap({ id: "s1", minutesAgo: 5 })];
    const onRestore = vi.fn();
    await renderPanel({ snapshots: data, selectedSnapshotId: "s1", onRestore });

    const btn = screen.getByTestId("article-history-restore");
    fireEvent.click(btn);
    expect(onRestore).toHaveBeenCalledWith("s1");
  });

  test("search input filters rows by label substring (case-insensitive)", async () => {
    const data = [
      snap({ id: "s1", minutesAgo: 5, label: "first edit pass" }),
      snap({ id: "s2", minutesAgo: 60, label: "structural cuts" }),
      snap({ id: "s3", minutesAgo: 120, label: "first draft" }),
    ];
    await renderPanel({ snapshots: data });

    const searchInput = screen.getByTestId("article-history-search") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "First" } });

    expect(screen.queryByTestId("article-history-row-s1")).toBeTruthy();
    expect(screen.queryByTestId("article-history-row-s2")).toBeNull();
    expect(screen.queryByTestId("article-history-row-s3")).toBeTruthy();
  });

  test("re-fetches snapshots when articleId changes", async () => {
    mockedInvoke.mockResolvedValueOnce([snap({ id: "s1", minutesAgo: 5 })]);
    const { rerender } = render(
      <ArticleHistoryPanel
        articleId="art-1"
        selectedSnapshotId={null}
        onSelect={() => {}}
        onRestore={() => {}}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });

    mockedInvoke.mockResolvedValueOnce([snap({ id: "s99", minutesAgo: 5 })]);
    rerender(
      <ArticleHistoryPanel
        articleId="art-2"
        selectedSnapshotId={null}
        onSelect={() => {}}
        onRestore={() => {}}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "snapshot:list", { articleId: "art-2" });
  });

  test("falls back to 'Auto-saved' when a snapshot has no label", async () => {
    const data = [snap({ id: "s1", minutesAgo: 5, label: null })];
    await renderPanel({ snapshots: data });
    expect(screen.getByText("Auto-saved")).toBeTruthy();
  });

  test("PageDown jumps 10 rows forward", async () => {
    const data = Array.from({ length: 15 }, (_, i) => snap({ id: `s${i}`, minutesAgo: i * 5 }));
    const onSelect = vi.fn();
    await renderPanel({ snapshots: data, selectedSnapshotId: "s0", onSelect });

    fireEvent.keyDown(screen.getByTestId("article-history-panel"), { key: "PageDown" });
    expect(onSelect).toHaveBeenLastCalledWith("s10");
  });
});

describe("<ArticleHistoryPanel> hover callout (T8)", () => {
  // Three snapshots, newest-first as the IPC delivers them. Relative
  // version numbers are reckoned from oldest, so:
  //   s_newest  → v3
  //   s_middle  → v2
  //   s_oldest  → v1
  const calloutData = [
    snap({ id: "s_newest", minutesAgo: 5, label: "current draft" }),
    snap({ id: "s_middle", minutesAgo: 60, label: "first edit pass", starred: true }),
    snap({ id: "s_oldest", minutesAgo: 120, label: null }),
  ];

  test("hovering a row reveals the callout", async () => {
    await renderPanel({ snapshots: calloutData });

    expect(screen.queryByTestId("article-history-hover-callout")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("article-history-row-s_newest"));
    expect(screen.getByTestId("article-history-hover-callout")).toBeTruthy();
  });

  test("callout shows the relative version number reckoned from oldest", async () => {
    await renderPanel({ snapshots: calloutData });

    // 3rd snapshot from the oldest = v3 (newest of the three).
    fireEvent.mouseEnter(screen.getByTestId("article-history-row-s_newest"));
    expect(screen.getByTestId("article-history-hover-callout").textContent).toContain("v3");

    fireEvent.mouseLeave(screen.getByTestId("article-history-row-s_newest"));
    // 1st snapshot ever saved = v1.
    fireEvent.mouseEnter(screen.getByTestId("article-history-row-s_oldest"));
    expect(screen.getByTestId("article-history-hover-callout").textContent).toContain("v1");
  });

  test("callout shows a formatted timestamp for the snapshot", async () => {
    await renderPanel({ snapshots: calloutData });

    fireEvent.mouseEnter(screen.getByTestId("article-history-row-s_newest"));
    const callout = screen.getByTestId("article-history-hover-callout");
    // Same-day snapshots format as "h:mm AM/PM" — assert on the AM/PM
    // suffix rather than a locale-specific exact string.
    expect(callout.textContent).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  test("callout shows a star icon plus the label when starred + labeled", async () => {
    await renderPanel({ snapshots: calloutData });

    fireEvent.mouseEnter(screen.getByTestId("article-history-row-s_middle"));
    const callout = screen.getByTestId("article-history-hover-callout");
    expect(screen.getByTestId("article-history-hover-callout-star")).toBeTruthy();
    expect(callout.textContent).toContain("first edit pass");
  });

  test("mouse leave hides the callout", async () => {
    await renderPanel({ snapshots: calloutData });

    fireEvent.mouseEnter(screen.getByTestId("article-history-row-s_newest"));
    expect(screen.getByTestId("article-history-hover-callout")).toBeTruthy();

    fireEvent.mouseLeave(screen.getByTestId("article-history-row-s_newest"));
    expect(screen.queryByTestId("article-history-hover-callout")).toBeNull();
  });

  test("keyboard focus on a row reveals the callout (a11y)", async () => {
    await renderPanel({ snapshots: calloutData });

    expect(screen.queryByTestId("article-history-hover-callout")).toBeNull();
    fireEvent.focus(screen.getByTestId("article-history-row-s_middle"));
    expect(screen.getByTestId("article-history-hover-callout")).toBeTruthy();
  });

  test("blur hides the callout once focus moves away", async () => {
    await renderPanel({ snapshots: calloutData });

    fireEvent.focus(screen.getByTestId("article-history-row-s_middle"));
    expect(screen.getByTestId("article-history-hover-callout")).toBeTruthy();

    fireEvent.blur(screen.getByTestId("article-history-row-s_middle"));
    expect(screen.queryByTestId("article-history-hover-callout")).toBeNull();
  });
});
