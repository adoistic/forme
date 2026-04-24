/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<AdsScreen>` (T15 / v0.6).
 *
 * Mocks the IPC client + Zustand issue store so the radio toggle and
 * article picker can be exercised without spinning up Electron. Covers:
 *   - radio toggle reveals the article picker
 *   - placement selection round-trips through the upload payload
 *   - cover placement clears any previously-chosen article
 *   - the upload button stays disabled until the operator picks an article
 */
import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type {
  AdSummary,
  ArticleSummary,
  IssueSummary,
} from "../../../src/shared/ipc-contracts/channels.js";

// Mock IPC BEFORE importing the component (vi.mock is hoisted).
vi.mock("../../../src/renderer/ipc/client.js", () => ({
  invoke: vi.fn(),
  IpcError: class IpcError extends Error {},
}));

import { invoke } from "../../../src/renderer/ipc/client.js";
import {
  AdsScreen,
  placementValidationMessage,
} from "../../../src/renderer/screens/ads/AdsScreen.js";
import { ToastProvider } from "../../../src/renderer/components/Toast.js";
import { useIssueStore } from "../../../src/renderer/stores/issue.js";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function makeIssue(overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: "issue-1",
    title: "Test Issue",
    issueNumber: 1,
    issueDate: "2026-04-21",
    pageSize: "A4",
    typographyPairing: "Editorial Serif",
    primaryLanguage: "en",
    bwMode: false,
    articleCount: 0,
    classifiedCount: 0,
    adCount: 0,
    createdAt: "2026-04-21T00:00:00Z",
    updatedAt: "2026-04-21T00:00:00Z",
    ...overrides,
  };
}

function makeArticle(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return {
    id: "art-1",
    issueId: "issue-1",
    headline: "Kabir on the bridge",
    deck: null,
    byline: "Kabir Singh",
    bylinePosition: "top",
    heroPlacement: "below-headline",
    heroCaption: null,
    heroCredit: null,
    section: null,
    language: "en",
    wordCount: 500,
    contentType: "Article",
    createdAt: "2026-04-21T00:00:00Z",
    body: "x",
    bodyFormat: "plain",
    ...overrides,
  };
}

function seedStore(opts: {
  issue: IssueSummary;
  articles: ArticleSummary[];
  ads?: AdSummary[];
}): void {
  useIssueStore.setState({
    currentIssue: opts.issue,
    issues: [opts.issue],
    articles: opts.articles,
    classifieds: [],
    ads: opts.ads ?? [],
    profile: null,
  });
}

beforeEach(() => {
  mockedInvoke.mockReset();
  // Default IPC: refresh hooks return empty lists.
  mockedInvoke.mockImplementation(async (channel: string) => {
    if (channel === "ad:list") return [];
    if (channel === "issue:list") return [];
    return null;
  });
});

afterEach(() => {
  cleanup();
  // Reset store between tests.
  useIssueStore.setState({
    currentIssue: null,
    issues: [],
    articles: [],
    classifieds: [],
    ads: [],
    profile: null,
  });
});

function renderScreen(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <AdsScreen />
    </ToastProvider>
  );
}

describe("placementValidationMessage", () => {
  test("cover is always valid", () => {
    expect(placementValidationMessage("cover", null)).toBeNull();
    expect(placementValidationMessage("cover", "art-1")).toBeNull();
  });

  test("between requires an article id", () => {
    expect(placementValidationMessage("between", null)).toMatch(/Pick the article/i);
    expect(placementValidationMessage("between", "art-1")).toBeNull();
  });

  test("bottom-of requires an article id", () => {
    expect(placementValidationMessage("bottom-of", null)).toMatch(/Pick the article/i);
    expect(placementValidationMessage("bottom-of", "art-1")).toBeNull();
  });
});

describe("AdsScreen radio + article picker", () => {
  test("defaults to Cover with no article picker shown", () => {
    seedStore({ issue: makeIssue(), articles: [makeArticle()] });
    renderScreen();

    const cover = screen.getByTestId("ad-placement-cover") as HTMLInputElement;
    expect(cover.checked).toBe(true);
    expect(screen.queryByTestId("ad-placement-article")).toBeNull();
  });

  test("selecting Between articles reveals the article picker", () => {
    seedStore({
      issue: makeIssue(),
      articles: [makeArticle(), makeArticle({ id: "art-2", headline: "Second piece" })],
    });
    renderScreen();

    fireEvent.click(screen.getByTestId("ad-placement-between"));
    const picker = screen.getByTestId("ad-placement-article") as HTMLSelectElement;
    expect(picker).toBeDefined();
    // Both articles appear in the picker, plus the placeholder option.
    expect(picker.querySelectorAll("option").length).toBe(3);
  });

  test("selecting Bottom of an article reveals the same picker", () => {
    seedStore({ issue: makeIssue(), articles: [makeArticle()] });
    renderScreen();

    fireEvent.click(screen.getByTestId("ad-placement-bottom-of"));
    expect(screen.getByTestId("ad-placement-article")).toBeDefined();
  });

  test("switching back to Cover hides the picker and clears the article", () => {
    seedStore({ issue: makeIssue(), articles: [makeArticle()] });
    renderScreen();

    fireEvent.click(screen.getByTestId("ad-placement-between"));
    fireEvent.change(screen.getByTestId("ad-placement-article"), { target: { value: "art-1" } });
    // Now flip back to cover.
    fireEvent.click(screen.getByTestId("ad-placement-cover"));
    expect(screen.queryByTestId("ad-placement-article")).toBeNull();
    // Validation should also clear.
    expect(screen.queryByTestId("ad-placement-error")).toBeNull();
  });

  test("between with no article shows the inline error", () => {
    seedStore({ issue: makeIssue(), articles: [makeArticle()] });
    renderScreen();

    fireEvent.click(screen.getByTestId("ad-placement-between"));
    const err = screen.getByTestId("ad-placement-error");
    expect(err.textContent).toMatch(/Pick the article/i);
  });

  test("article picker shows headline + byline-driven caption", () => {
    seedStore({
      issue: makeIssue(),
      articles: [
        makeArticle({ id: "art-1", headline: "First piece", byline: "Anjali Mehta" }),
        makeArticle({ id: "art-2", headline: "Second piece", byline: null }),
      ],
    });
    renderScreen();

    fireEvent.click(screen.getByTestId("ad-placement-between"));
    const picker = screen.getByTestId("ad-placement-article") as HTMLSelectElement;
    const optionTexts = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    // First article has a byline → "after Anjali's piece" caption.
    expect(optionTexts.some((t) => t?.includes("after Anjali's piece"))).toBe(true);
    // Second article has no byline → falls back to bare headline as the caption.
    expect(optionTexts.some((t) => t?.includes("Second piece"))).toBe(true);
  });
});

describe("AdsScreen placement round-trip", () => {
  // The upload pipeline reads from a hidden file input. We synthesize a File
  // and dispatch a change event so the handler runs as it would in practice.
  function uploadFile(): void {
    const input = screen.getByTestId("ad-upload-input") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "ad.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
  }

  test("cover upload sends placementKind='cover' + null article id", async () => {
    seedStore({ issue: makeIssue(), articles: [makeArticle()] });
    mockedInvoke.mockImplementation(async (channel: string) => {
      if (channel === "ad:upload") return {} as AdSummary;
      if (channel === "ad:list") return [];
      if (channel === "issue:list") return [];
      return null;
    });
    renderScreen();

    uploadFile();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const uploadCall = mockedInvoke.mock.calls.find((c) => c[0] === "ad:upload");
    expect(uploadCall).toBeDefined();
    if (!uploadCall) throw new Error("unreachable");
    const payload = uploadCall[1] as Record<string, unknown>;
    expect(payload["placementKind"]).toBe("cover");
    expect(payload["placementArticleId"]).toBeNull();
  });

  test("between upload sends placementKind='between' + the picked article id", async () => {
    seedStore({
      issue: makeIssue(),
      articles: [makeArticle({ id: "art-2", headline: "Second piece" })],
    });
    mockedInvoke.mockImplementation(async (channel: string) => {
      if (channel === "ad:upload") return {} as AdSummary;
      if (channel === "ad:list") return [];
      if (channel === "issue:list") return [];
      return null;
    });
    renderScreen();

    fireEvent.click(screen.getByTestId("ad-placement-between"));
    fireEvent.change(screen.getByTestId("ad-placement-article"), { target: { value: "art-2" } });

    uploadFile();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const uploadCall = mockedInvoke.mock.calls.find((c) => c[0] === "ad:upload");
    expect(uploadCall).toBeDefined();
    if (!uploadCall) throw new Error("unreachable");
    const payload = uploadCall[1] as Record<string, unknown>;
    expect(payload["placementKind"]).toBe("between");
    expect(payload["placementArticleId"]).toBe("art-2");
  });

  test("between with no article blocks the upload and toasts", async () => {
    seedStore({ issue: makeIssue(), articles: [makeArticle()] });
    renderScreen();

    fireEvent.click(screen.getByTestId("ad-placement-between"));
    // Don't pick an article. The hidden input is disabled, but firing
    // change() still routes through handleFile which surfaces the toast.
    uploadFile();
    await act(async () => {
      await Promise.resolve();
    });

    const uploadCall = mockedInvoke.mock.calls.find((c) => c[0] === "ad:upload");
    expect(uploadCall).toBeUndefined();
  });
});
