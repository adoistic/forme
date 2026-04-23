/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<StorageSettings>` (T12 / v0.6).
 *
 * Mocks the IPC client and the disk-usage event subscription so the
 * panel can be driven without spinning up Electron. Covers the render
 * paths (overview card, sortable list), the empty state, and the
 * View versions → wiring.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import type {
  StorageOverview,
  ArticleStorageRow,
} from "../../../src/shared/ipc-contracts/channels.js";

// Mock the IPC client BEFORE importing the component.
vi.mock("../../../src/renderer/ipc/client.js", () => ({
  invoke: vi.fn(),
  IpcError: class IpcError extends Error {},
}));

import { invoke } from "../../../src/renderer/ipc/client.js";
import { StorageSettings, sortRows } from "../../../src/renderer/screens/settings/StorageSettings.js";
import { ToastProvider } from "../../../src/renderer/components/Toast.js";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

let unsubscribeSpy: ReturnType<typeof vi.fn>;

function defaultOverview(overrides: Partial<StorageOverview> = {}): StorageOverview {
  return {
    total: 5_000_000,
    snapshots: 1_000_000,
    blobs: 4_000_000,
    blobsByKind: {
      hero: 1_500_000,
      ad: 1_000_000,
      classifieds: 500_000,
      other: 1_000_000,
    },
    ...overrides,
  };
}

function makeRow(overrides: Partial<ArticleStorageRow> = {}): ArticleStorageRow {
  return {
    articleId: "art-1",
    issueId: "issue-1",
    headline: "First headline",
    snapshotBytes: 200_000,
    snapshotCount: 4,
    blobBytes: 1_000_000,
    totalBytes: 1_200_000,
    ...overrides,
  };
}

function setupDefaultInvoke(opts: {
  overview?: StorageOverview;
  rows?: ArticleStorageRow[];
}): void {
  mockedInvoke.mockImplementation(async (channel: string) => {
    if (channel === "storage:overview") return opts.overview ?? defaultOverview();
    if (channel === "storage:per-article") return opts.rows ?? [];
    throw new Error(`unexpected channel: ${channel}`);
  });
}

beforeEach(() => {
  mockedInvoke.mockReset();
  unsubscribeSpy = vi.fn();

  Object.defineProperty(window, "forme", {
    writable: true,
    configurable: true,
    value: {
      invoke: vi.fn(),
      on: vi.fn(),
      onDiskUsageChanged: vi.fn(() => unsubscribeSpy),
      platform: "darwin",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPanel(props: {
  overview?: StorageOverview;
  rows?: ArticleStorageRow[];
  onViewArticle?: (row: ArticleStorageRow) => void;
}): Promise<ReturnType<typeof render>> {
  setupDefaultInvoke({
    ...(props.overview !== undefined ? { overview: props.overview } : {}),
    ...(props.rows !== undefined ? { rows: props.rows } : {}),
  });
  const utils = render(
    <ToastProvider>
      <StorageSettings {...(props.onViewArticle ? { onViewArticle: props.onViewArticle } : {})} />
    </ToastProvider>
  );
  // Two flushes: one for the initial Promise.all, one for state batch.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

describe("sortRows (pure helper)", () => {
  const a = makeRow({ articleId: "a", headline: "Apple", snapshotBytes: 100, blobBytes: 200, totalBytes: 300 });
  const b = makeRow({ articleId: "b", headline: "Banana", snapshotBytes: 50, blobBytes: 500, totalBytes: 550 });
  const c = makeRow({ articleId: "c", headline: "Cherry", snapshotBytes: 300, blobBytes: 0, totalBytes: 300 });

  test("by total descending (default)", () => {
    expect(sortRows([a, b, c], "total", "desc").map((r) => r.articleId)).toEqual(["b", "a", "c"]);
  });

  test("by snapshots ascending", () => {
    expect(sortRows([a, b, c], "snapshots", "asc").map((r) => r.articleId)).toEqual(["b", "a", "c"]);
  });

  test("by blobs descending", () => {
    expect(sortRows([a, b, c], "blobs", "desc").map((r) => r.articleId)).toEqual(["b", "a", "c"]);
  });

  test("by name ascending", () => {
    expect(sortRows([c, a, b], "name", "asc").map((r) => r.articleId)).toEqual(["a", "b", "c"]);
  });
});

describe("<StorageSettings>", () => {
  test("renders overview card with formatted bytes", async () => {
    await renderPanel({
      overview: defaultOverview({
        total: 1_500_000_000,
        snapshots: 500_000_000,
        blobs: 1_000_000_000,
        blobsByKind: { hero: 600_000_000, ad: 200_000_000, classifieds: 100_000_000, other: 100_000_000 },
      }),
    });

    const overview = await screen.findByTestId("storage-overview");
    expect(overview).toBeTruthy();
    expect(screen.getByTestId("storage-overview-total").textContent).toBe("1.5 GB");
    expect(screen.getByTestId("storage-breakdown-snapshots").textContent).toBe("500 MB");
    expect(screen.getByTestId("storage-breakdown-blobs").textContent).toBe("1.0 GB");
    expect(screen.getByTestId("storage-breakdown-hero").textContent).toBe("600 MB");
    expect(screen.getByTestId("storage-breakdown-ad").textContent).toBe("200 MB");
    expect(screen.getByTestId("storage-breakdown-classifieds").textContent).toBe("100 MB");
    expect(screen.getByTestId("storage-breakdown-other").textContent).toBe("100 MB");
  });

  test("renders article list with formatted snapshot count + sizes", async () => {
    const rows = [
      makeRow({
        articleId: "row-a",
        headline: "Alpha headline",
        snapshotBytes: 500_000,
        snapshotCount: 12,
        blobBytes: 2_000_000,
        totalBytes: 2_500_000,
      }),
      makeRow({
        articleId: "row-b",
        headline: "Bravo headline",
        snapshotBytes: 0,
        snapshotCount: 0,
        blobBytes: 0,
        totalBytes: 0,
      }),
    ];
    await renderPanel({ rows });

    const table = await screen.findByTestId("storage-article-table");
    expect(table).toBeTruthy();

    const rowA = within(screen.getByTestId("storage-row-row-a"));
    expect(rowA.getByText(/Alpha headline/)).toBeTruthy();
    expect(rowA.getByText(/12 versions/)).toBeTruthy();
    expect(rowA.getByText(/500 KB/)).toBeTruthy();
    expect(rowA.getByText(/2 MB/)).toBeTruthy();

    const rowB = within(screen.getByTestId("storage-row-row-b"));
    // Empty rows render dashes for snapshots + blobs and "0 B" for total.
    expect(rowB.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  test("clicking a column header re-sorts the list", async () => {
    const rows = [
      makeRow({ articleId: "x", headline: "Big", totalBytes: 9_000_000 }),
      makeRow({ articleId: "y", headline: "Small", totalBytes: 100_000 }),
    ];
    await renderPanel({ rows });

    // Default sort is total descending: Big before Small.
    let renderedIds = within(screen.getByTestId("storage-article-table"))
      .getAllByTestId(/^storage-row-/)
      .map((el) => el.getAttribute("data-testid"));
    expect(renderedIds).toEqual(["storage-row-x", "storage-row-y"]);

    // Click name → ascending: Big, Small (alphabetical).
    fireEvent.click(screen.getByTestId("storage-sort-name"));
    renderedIds = within(screen.getByTestId("storage-article-table"))
      .getAllByTestId(/^storage-row-/)
      .map((el) => el.getAttribute("data-testid"));
    expect(renderedIds).toEqual(["storage-row-x", "storage-row-y"]);

    // Click name again → descending: Small, Big.
    fireEvent.click(screen.getByTestId("storage-sort-name"));
    renderedIds = within(screen.getByTestId("storage-article-table"))
      .getAllByTestId(/^storage-row-/)
      .map((el) => el.getAttribute("data-testid"));
    expect(renderedIds).toEqual(["storage-row-y", "storage-row-x"]);
  });

  test("empty state when no articles", async () => {
    await renderPanel({ rows: [] });
    expect(await screen.findByTestId("storage-empty-state")).toBeTruthy();
    expect(screen.queryByTestId("storage-article-table")).toBeNull();
  });

  test("View versions → calls onViewArticle with the row", async () => {
    const rows = [makeRow({ articleId: "open-me", headline: "Open this" })];
    const handler = vi.fn();
    await renderPanel({ rows, onViewArticle: handler });

    fireEvent.click(screen.getByTestId("storage-view-open-me"));
    expect(handler).toHaveBeenCalledTimes(1);
    const firstCall = handler.mock.calls[0];
    expect(firstCall?.[0]).toMatchObject({ articleId: "open-me" });
  });

  test("subscribes to disk-usage-changed on mount, unsubscribes on unmount", async () => {
    const { unmount } = await renderPanel({});
    expect(window.forme.onDiskUsageChanged).toHaveBeenCalledTimes(1);
    expect(unsubscribeSpy).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});
