/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<IssueHistoryTimeline>` (T19 / v0.6).
 *
 * Mocks the IPC client + Zustand issue store so the History tab can be
 * exercised without spinning up Electron. Covers:
 *   1. Renders timeline with date-grouped entries
 *   2. Selecting an entry → preview shows that snapshot's summary
 *   3. Empty state when no snapshots
 *   4. No-issue state when there's no current issue
 *
 * Restore is intentionally not tested — it's deferred per task scope.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type {
  IssueSnapshotSummary,
  IssueSnapshotPreview,
  IssueSummary,
} from "../../../src/shared/ipc-contracts/channels.js";

// Mock IPC BEFORE importing the component (vi.mock is hoisted).
vi.mock("../../../src/renderer/ipc/client.js", () => ({
  invoke: vi.fn(),
  IpcError: class IpcError extends Error {},
}));

import { invoke } from "../../../src/renderer/ipc/client.js";
import { IssueHistoryTimeline } from "../../../src/renderer/screens/history/IssueHistoryTimeline.js";
import { useIssueStore } from "../../../src/renderer/stores/issue.js";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-04-23T15:00:00Z");

function makeIssue(overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: "issue-1",
    title: "Test Issue",
    issueNumber: 47,
    issueDate: "2026-04-21",
    pageSize: "A4",
    typographyPairing: "Editorial Serif",
    primaryLanguage: "en",
    bwMode: false,
    articleCount: 4,
    classifiedCount: 8,
    adCount: 2,
    createdAt: "2026-04-21T00:00:00Z",
    updatedAt: "2026-04-21T00:00:00Z",
    ...overrides,
  };
}

function snap(
  overrides: Partial<IssueSnapshotSummary> & {
    id: string;
    minutesAgo?: number;
    daysAgo?: number;
  }
): IssueSnapshotSummary {
  const created = new Date(NOW);
  if (overrides.minutesAgo) created.setMinutes(created.getMinutes() - overrides.minutesAgo);
  if (overrides.daysAgo) created.setDate(created.getDate() - overrides.daysAgo);
  return {
    id: overrides.id,
    issueId: "issue-1",
    createdAt: overrides.createdAt ?? created.toISOString(),
    description: overrides.description ?? "Auto-save",
    sizeBytes: overrides.sizeBytes ?? 4096,
  };
}

function preview(overrides: Partial<IssueSnapshotPreview> = {}): IssueSnapshotPreview {
  return {
    id: "s-1",
    issueId: "issue-1",
    createdAt: NOW.toISOString(),
    description: "Edited article: Modi visits Delhi",
    title: "Test Issue",
    issueNumber: 47,
    articleCount: 4,
    classifiedCount: 8,
    adCount: 2,
    articleHeadlines: ["Modi visits Delhi", "India's future"],
    ...overrides,
  };
}

function seedStore(currentIssue: IssueSummary | null): void {
  useIssueStore.setState({
    currentIssue,
    issues: currentIssue ? [currentIssue] : [],
    articles: [],
    classifieds: [],
    ads: [],
    profile: null,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockedInvoke.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useIssueStore.setState({
    currentIssue: null,
    issues: [],
    articles: [],
    classifieds: [],
    ads: [],
    profile: null,
  });
});

/**
 * Render with the IPC mock primed for the initial list + the auto-select
 * preview fetch. Lets each test focus on its assertion without
 * re-priming for routine reads.
 */
async function renderTimeline(opts: {
  issue?: IssueSummary | null;
  snapshots?: IssueSnapshotSummary[];
  previewBody?: IssueSnapshotPreview;
  /** When true, skip seeding the IPC mock — caller handles it. */
  manualMock?: boolean;
}): Promise<ReturnType<typeof render>> {
  const issue = opts.issue === undefined ? makeIssue() : opts.issue;
  seedStore(issue);
  if (!opts.manualMock) {
    mockedInvoke.mockImplementation(async (channel: string) => {
      if (channel === "issue-snapshot:list") return opts.snapshots ?? [];
      if (channel === "issue-snapshot:read") return opts.previewBody ?? preview();
      throw new Error(`unexpected channel: ${channel}`);
    });
  }
  const utils = render(<IssueHistoryTimeline />);
  // Two flushes: one for the list fetch, one for the preview fetch
  // triggered by auto-selection of the newest row.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

describe("<IssueHistoryTimeline>", () => {
  test("renders timeline with date-grouped entries (TODAY / YESTERDAY / OLDER)", async () => {
    const data = [
      snap({ id: "s1", minutesAgo: 30, description: "Edited article: Modi visits Delhi" }),
      snap({ id: "s2", minutesAgo: 90, description: "Auto-save" }),
      snap({ id: "s3", daysAgo: 1, description: "Created Issue 47" }),
      snap({ id: "s4", daysAgo: 30, description: "Initial setup" }),
    ];
    await renderTimeline({ snapshots: data });

    expect(mockedInvoke).toHaveBeenCalledWith("issue-snapshot:list", { issueId: "issue-1" });

    expect(screen.getByText("TODAY")).toBeTruthy();
    expect(screen.getByText("YESTERDAY")).toBeTruthy();
    expect(screen.getByText("OLDER")).toBeTruthy();
    // Row count summary in the timeline header.
    expect(screen.getByText("4 snapshots")).toBeTruthy();
    // Auto-generated description text shows on each row inside the timeline
    // (the preview pane echoes its own snapshot's description, so use the
    // timeline scope to disambiguate).
    const timeline = screen.getByTestId("issue-history-timeline");
    expect(timeline.textContent).toContain("Edited article: Modi visits Delhi");
    expect(timeline.textContent).toContain("Created Issue 47");
    expect(timeline.textContent).toContain("Initial setup");
  });

  test("auto-selects newest snapshot, preview pane shows that snapshot's summary", async () => {
    const data = [
      snap({ id: "s1", minutesAgo: 5, description: "Edited article: Modi visits Delhi" }),
      snap({ id: "s2", minutesAgo: 60, description: "Added 4 classifieds" }),
    ];
    const previewBody = preview({
      id: "s1",
      description: "Edited article: Modi visits Delhi",
      articleCount: 4,
      classifiedCount: 8,
      adCount: 2,
      articleHeadlines: ["Modi visits Delhi", "India's future"],
    });

    await renderTimeline({ snapshots: data, previewBody });

    // Auto-selection picked the newest row (s1).
    const selectedRow = screen.getByTestId("issue-history-row-s1");
    expect(selectedRow.getAttribute("aria-current")).toBe("true");

    // Preview header uses display serif + "Issue N at <time>, <date>".
    const title = screen.getByTestId("issue-history-preview-title");
    expect(title.textContent).toMatch(/Issue 47/);

    // Article headlines rendered.
    const headlines = screen.getByTestId("issue-history-headlines");
    expect(headlines.textContent).toContain("Modi visits Delhi");
    expect(headlines.textContent).toContain("India's future");
  });

  test("clicking a different entry → preview re-fetches with that id", async () => {
    const data = [
      snap({ id: "s1", minutesAgo: 5, description: "Latest" }),
      snap({ id: "s2", minutesAgo: 60, description: "Earlier" }),
    ];
    const newest = preview({ id: "s1", description: "Latest", articleCount: 4 });
    const earlier = preview({ id: "s2", description: "Earlier", articleCount: 2 });

    // Manual mock so we can verify which snapshotId hits the read.
    mockedInvoke.mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel === "issue-snapshot:list") return data;
      if (channel === "issue-snapshot:read") {
        const id = (payload as { snapshotId: string }).snapshotId;
        return id === "s1" ? newest : earlier;
      }
      throw new Error(`unexpected: ${channel}`);
    });

    await renderTimeline({ manualMock: true });

    // Auto-selected s1 fired one read.
    expect(mockedInvoke).toHaveBeenCalledWith("issue-snapshot:read", { snapshotId: "s1" });

    // Click s2; the preview pane re-fetches.
    fireEvent.click(screen.getByTestId("issue-history-row-s2"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedInvoke).toHaveBeenCalledWith("issue-snapshot:read", { snapshotId: "s2" });
    // Selection moved.
    expect(screen.getByTestId("issue-history-row-s2").getAttribute("aria-current")).toBe("true");
  });

  test("selected row gets cream bg + rust left border", async () => {
    const data = [snap({ id: "s1", minutesAgo: 5, description: "now" })];
    await renderTimeline({ snapshots: data });

    const row = screen.getByTestId("issue-history-row-s1");
    // Approved variant-B: selected row has cream bg + rust left border.
    expect(row.className).toContain("bg-accent-bg");
    expect(row.className).toContain("border-accent");
  });

  test("renders empty state when issue has no snapshots", async () => {
    await renderTimeline({ snapshots: [] });

    const empty = screen.getByTestId("issue-history-empty");
    expect(empty.textContent).toContain("NO HISTORY YET");
    expect(empty.textContent).toMatch(/snapshot/i);
    // No snapshot rows.
    expect(screen.queryByTestId(/issue-history-row-/)).toBeNull();
  });

  test("no-issue state when there's no current issue", async () => {
    await renderTimeline({ issue: null });

    expect(screen.getByText(/Pick an issue/i)).toBeTruthy();
    // Timeline + preview not rendered.
    expect(screen.queryByTestId("issue-history-timeline")).toBeNull();
  });

  test("surfaces an error when the list fetch fails", async () => {
    seedStore(makeIssue());
    mockedInvoke.mockImplementation(async (channel: string) => {
      if (channel === "issue-snapshot:list") throw new Error("boom");
      return null;
    });
    render(<IssueHistoryTimeline />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});
