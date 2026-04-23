/**
 * @vitest-environment jsdom
 *
 * Unit tests for the refactored 3-pane `<EditArticleModal>` (T10 / v0.6).
 *
 * The modal integrates ArticleBodyEditor + ArticleHistoryPanel +
 * DiffViewer behind a single Radix Dialog.Root. Tests stub the typed
 * IPC client and ResizeObserver so the wider behaviors (load, save,
 * delete, restore, compare, breakpoint collapse) are observable
 * without spinning up Electron's preload bridge.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type {
  ArticleSummary,
  ArticleSnapshotSummary,
  ArticleSnapshotBody,
} from "../../../src/shared/ipc-contracts/channels.js";

// Mock IPC BEFORE importing the component (vi.mock is hoisted).
vi.mock("../../../src/renderer/ipc/client.js", () => ({
  invoke: vi.fn(),
  IpcError: class IpcError extends Error {},
}));

import { invoke } from "../../../src/renderer/ipc/client.js";
import { EditArticleModal } from "../../../src/renderer/screens/articles/EditArticleModal.js";
import { ToastProvider } from "../../../src/renderer/components/Toast.js";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

// ---- Test fixtures + helpers --------------------------------------------

function makeArticle(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return {
    id: "art-1",
    issueId: "issue-1",
    headline: "First draft headline",
    deck: "A short subtitle.",
    byline: "Jane Doe",
    bylinePosition: "top",
    heroPlacement: "below-headline",
    heroCaption: null,
    heroCredit: null,
    section: null,
    language: "en",
    wordCount: 12,
    contentType: "Article",
    createdAt: "2026-04-22T13:48:00Z",
    body: "Hello world.",
    bodyFormat: "plain",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ArticleSnapshotSummary> = {}): ArticleSnapshotSummary {
  return {
    id: "snap-1",
    articleId: "art-1",
    createdAt: "2026-04-22T12:00:00Z",
    label: null,
    starred: false,
    sizeBytes: 1024,
    blockSchemaVersion: 1,
    ...overrides,
  };
}

function makeSnapshotBody(overrides: Partial<ArticleSnapshotBody> = {}): ArticleSnapshotBody {
  return {
    articleId: "art-1",
    body: JSON.stringify([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Snapshot paragraph.", styles: {} }],
      },
    ]),
    createdAt: "2026-04-22T12:00:00Z",
    label: null,
    starred: false,
    ...overrides,
  };
}

/**
 * Default IPC mock: open-for-edit returns the seed article, snapshot:list
 * returns whatever the test asks for. Per-test mocks layer on top of this
 * via mockedInvoke.mockImplementation overrides.
 */
function defaultInvoke(opts: {
  article: ArticleSummary;
  snapshots?: ArticleSnapshotSummary[];
  snapshotBody?: ArticleSnapshotBody;
  onUpdate?: (input: unknown) => ArticleSummary;
  onRestore?: (input: unknown) => ArticleSummary;
  onDelete?: () => void;
}) {
  return async (channel: string, payload: unknown) => {
    if (channel === "article:open-for-edit") return opts.article;
    if (channel === "snapshot:list") return opts.snapshots ?? [];
    if (channel === "snapshot:read") return opts.snapshotBody ?? makeSnapshotBody();
    if (channel === "article:update") {
      return opts.onUpdate ? opts.onUpdate(payload) : opts.article;
    }
    if (channel === "snapshot:restore") {
      return opts.onRestore ? opts.onRestore(payload) : opts.article;
    }
    if (channel === "article:delete") {
      opts.onDelete?.();
      return { id: opts.article.id, deleted: true };
    }
    if (channel === "article:read-body") {
      return { id: opts.article.id, body: opts.article.body, bodyFormat: opts.article.bodyFormat };
    }
    throw new Error(`unexpected channel: ${channel}`);
  };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountModal(props: {
  article: ArticleSummary;
  snapshots?: ArticleSnapshotSummary[];
  snapshotBody?: ArticleSnapshotBody;
  onClose?: () => void;
  onSaved?: (a: ArticleSummary) => void;
  onDeleted?: (id: string) => void;
  onUpdate?: (input: unknown) => ArticleSummary;
  onRestore?: (input: unknown) => ArticleSummary;
  onDelete?: () => void;
}): Promise<ReturnType<typeof render>> {
  mockedInvoke.mockImplementation(
    defaultInvoke({
      article: props.article,
      ...(props.snapshots !== undefined ? { snapshots: props.snapshots } : {}),
      ...(props.snapshotBody !== undefined ? { snapshotBody: props.snapshotBody } : {}),
      ...(props.onUpdate ? { onUpdate: props.onUpdate } : {}),
      ...(props.onRestore ? { onRestore: props.onRestore } : {}),
      ...(props.onDelete ? { onDelete: props.onDelete } : {}),
    })
  );
  const utils = render(
    <ToastProvider>
      <EditArticleModal
        article={props.article}
        onClose={props.onClose ?? (() => {})}
        onSaved={props.onSaved ?? (() => {})}
        onDeleted={props.onDeleted ?? (() => {})}
      />
    </ToastProvider>
  );
  // Two flushes: first to resolve open-for-edit, second to resolve
  // snapshot:list once the panel mounts.
  await flushAsync();
  await flushAsync();
  return utils;
}

// ResizeObserver capture + trigger. The modal mounts BlockNote (which
// creates its own observers), so we collect ALL active callbacks and
// fan a triggerWidth out to every one of them. The modal's own
// listener picks up the change; BlockNote's observers ignore the
// shape and stay quiet.
const observerCallbacks = new Set<(entries: ResizeObserverEntry[]) => void>();

function triggerWidth(width: number): void {
  if (observerCallbacks.size === 0) return;
  act(() => {
    for (const cb of observerCallbacks) {
      cb([
        {
          contentRect: { width } as DOMRectReadOnly,
          target: document.body,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as ResizeObserverEntry,
      ]);
    }
  });
}

beforeEach(() => {
  mockedInvoke.mockReset();
  observerCallbacks.clear();
  // jsdom-friendly stubs for BlockNote / ProseMirror.
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = (() => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    })) as () => DOMRect;
  }
  if (typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = (() => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    })) as () => DOMRectList;
  }
  // Capture every ResizeObserver instance per render so triggerWidth
  // can fan a synthetic resize out to all of them — including the
  // modal's own listener. Patch BOTH window and globalThis so the
  // bare `ResizeObserver` reference inside the component resolves
  // (jsdom doesn't provide one out of the box).
  class FakeResizeObserver {
    private cb: (entries: ResizeObserverEntry[]) => void;
    constructor(cb: (entries: ResizeObserverEntry[]) => void) {
      this.cb = cb;
      observerCallbacks.add(cb);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      observerCallbacks.delete(this.cb);
    }
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
  cleanup();
});

// ---- Tests ---------------------------------------------------------------

describe("<EditArticleModal>", () => {
  test("on mount, fetches the article via article:open-for-edit", async () => {
    const article = makeArticle();
    await mountModal({ article });

    // The very first IPC call is open-for-edit (snapshots come after).
    expect(mockedInvoke).toHaveBeenCalledWith("article:open-for-edit", { id: "art-1" });
  });

  test("3-pane layout renders all three components", async () => {
    const article = makeArticle();
    await mountModal({ article, snapshots: [makeSnapshot()] });

    // Modal shell.
    expect(screen.getByTestId("edit-article-modal")).toBeTruthy();
    // Left rail.
    expect(screen.getByTestId("article-history-panel")).toBeTruthy();
    // Center editor (BlockNote-mounted shell from ArticleBodyEditor).
    expect(screen.getByTestId("article-body-editor")).toBeTruthy();
    // Right preview pane.
    expect(screen.getByTestId("edit-article-preview")).toBeTruthy();
  });

  test("Save button is disabled until the body becomes dirty", async () => {
    const article = makeArticle();
    await mountModal({ article });

    const save = screen.getByTestId("edit-article-submit") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    // Open the details section + change the headline so we don't depend
    // on BlockNote firing onChange in jsdom.
    fireEvent.click(screen.getByTestId("edit-article-details-toggle"));
    const headline = screen.getByTestId("edit-article-headline") as HTMLInputElement;
    fireEvent.change(headline, { target: { value: "Updated headline" } });

    // Dirty indicator + Save enabled.
    expect(screen.getByTestId("edit-article-dirty-indicator")).toBeTruthy();
    expect((screen.getByTestId("edit-article-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  test("clicking Save calls article:update with body + bodyFormat", async () => {
    const article = makeArticle({ body: "Original.", bodyFormat: "plain" });
    let receivedPayload: Record<string, unknown> | null = null;
    await mountModal({
      article,
      onUpdate: (payload) => {
        receivedPayload = payload as Record<string, unknown>;
        return article;
      },
    });

    // Make a meta change to flip dirty without depending on BlockNote.
    fireEvent.click(screen.getByTestId("edit-article-details-toggle"));
    const headline = screen.getByTestId("edit-article-headline") as HTMLInputElement;
    fireEvent.change(headline, { target: { value: "Updated headline" } });

    fireEvent.click(screen.getByTestId("edit-article-submit"));
    await flushAsync();

    expect(mockedInvoke).toHaveBeenCalledWith(
      "article:update",
      expect.objectContaining({
        id: "art-1",
        headline: "Updated headline",
        body: "Original.",
        bodyFormat: "plain",
      })
    );
    expect(receivedPayload).toBeTruthy();
  });

  test("Delete with no unsaved changes shows the standard confirm copy", async () => {
    const article = makeArticle();
    await mountModal({ article });

    fireEvent.click(screen.getByTestId("edit-article-delete"));
    const dlg = screen.getByTestId("edit-article-delete-confirm");
    expect(dlg.textContent).toContain("This will delete the article and all of its history");
    expect(dlg.textContent).not.toContain("open in the editor");
  });

  test("Delete with unsaved changes shows the alt confirm copy", async () => {
    const article = makeArticle();
    await mountModal({ article });

    // Mark dirty by editing the headline.
    fireEvent.click(screen.getByTestId("edit-article-details-toggle"));
    const headline = screen.getByTestId("edit-article-headline") as HTMLInputElement;
    fireEvent.change(headline, { target: { value: "Changed" } });

    fireEvent.click(screen.getByTestId("edit-article-delete"));
    const dlg = screen.getByTestId("edit-article-delete-confirm");
    expect(dlg.textContent).toContain("This article is open in the editor");
    expect(dlg.textContent).toContain("discard any unsaved edits");
  });

  test("Confirm Delete calls article:delete + onDeleted + onClose", async () => {
    const article = makeArticle();
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    await mountModal({ article, onClose, onDeleted });

    fireEvent.click(screen.getByTestId("edit-article-delete"));
    fireEvent.click(screen.getByTestId("edit-article-delete-confirm-confirm"));
    await flushAsync();

    expect(mockedInvoke).toHaveBeenCalledWith("article:delete", { id: "art-1" });
    expect(onDeleted).toHaveBeenCalledWith("art-1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Selecting a snapshot in the history panel updates the right preview", async () => {
    const article = makeArticle();
    const snapshot = makeSnapshot({ id: "snap-42", label: "older draft" });
    const snapshotBody = makeSnapshotBody({
      body: JSON.stringify([
        {
          type: "paragraph",
          content: [{ type: "text", text: "Older draft body text.", styles: {} }],
        },
      ]),
      label: "older draft",
    });
    await mountModal({ article, snapshots: [snapshot], snapshotBody });

    // Initial state: preview shows current draft body.
    expect(screen.getByTestId("edit-article-preview-body").textContent).toContain("Hello world.");

    // Click the snapshot row.
    fireEvent.click(screen.getByTestId("article-history-row-snap-42"));
    await flushAsync();

    expect(mockedInvoke).toHaveBeenCalledWith("snapshot:read", { snapshotId: "snap-42" });
    expect(screen.getByTestId("edit-article-preview-body").textContent).toContain(
      "Older draft body text."
    );
  });

  test("Restore button on a clean editor → simple confirm → snapshot:restore", async () => {
    const article = makeArticle();
    const snapshot = makeSnapshot({ id: "snap-42" });
    let restoreCalledWith: unknown = null;
    await mountModal({
      article,
      snapshots: [snapshot],
      onRestore: (payload) => {
        restoreCalledWith = payload;
        return makeArticle({ body: "Restored body.", bodyFormat: "plain" });
      },
    });

    // Select the snapshot so the panel shows its Restore button.
    fireEvent.click(screen.getByTestId("article-history-row-snap-42"));
    await flushAsync();

    fireEvent.click(screen.getByTestId("article-history-restore"));
    // Simple confirm dialog appears (clean editor).
    expect(screen.getByTestId("edit-article-restore-confirm")).toBeTruthy();
    expect(screen.queryByTestId("restore-unsaved-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("edit-article-restore-confirm-confirm"));
    await flushAsync();

    expect(restoreCalledWith).toEqual({ snapshotId: "snap-42" });
    expect(mockedInvoke).toHaveBeenCalledWith("snapshot:restore", { snapshotId: "snap-42" });
  });

  test("Restore on a dirty editor → 3-option dialog (G3), not the simple confirm", async () => {
    const article = makeArticle();
    const snapshot = makeSnapshot({ id: "snap-42" });
    await mountModal({ article, snapshots: [snapshot] });

    // Mark dirty by editing the headline.
    fireEvent.click(screen.getByTestId("edit-article-details-toggle"));
    const headline = screen.getByTestId("edit-article-headline") as HTMLInputElement;
    fireEvent.change(headline, { target: { value: "Edited headline" } });

    fireEvent.click(screen.getByTestId("article-history-row-snap-42"));
    await flushAsync();

    fireEvent.click(screen.getByTestId("article-history-restore"));

    expect(screen.getByTestId("restore-unsaved-dialog")).toBeTruthy();
    expect(screen.queryByTestId("edit-article-restore-confirm")).toBeNull();
    // All three actions present.
    expect(screen.getByTestId("restore-unsaved-save-first")).toBeTruthy();
    expect(screen.getByTestId("restore-unsaved-discard")).toBeTruthy();
    expect(screen.getByTestId("restore-unsaved-cancel")).toBeTruthy();
  });

  test("Restore on dirty + Save-first path: article:update then snapshot:restore", async () => {
    const article = makeArticle();
    const snapshot = makeSnapshot({ id: "snap-42" });
    let updateCalled = false;
    let restoreCalled = false;
    const callOrder: string[] = [];
    await mountModal({
      article,
      snapshots: [snapshot],
      onUpdate: () => {
        updateCalled = true;
        callOrder.push("article:update");
        return article;
      },
      onRestore: () => {
        restoreCalled = true;
        callOrder.push("snapshot:restore");
        return makeArticle({ body: "Restored body.", bodyFormat: "plain" });
      },
    });

    // Mark dirty.
    fireEvent.click(screen.getByTestId("edit-article-details-toggle"));
    const headline = screen.getByTestId("edit-article-headline") as HTMLInputElement;
    fireEvent.change(headline, { target: { value: "Edited headline" } });

    fireEvent.click(screen.getByTestId("article-history-row-snap-42"));
    await flushAsync();

    fireEvent.click(screen.getByTestId("article-history-restore"));
    expect(screen.getByTestId("restore-unsaved-dialog")).toBeTruthy();

    fireEvent.click(screen.getByTestId("restore-unsaved-save-first"));
    await flushAsync();

    expect(updateCalled).toBe(true);
    expect(restoreCalled).toBe(true);
    expect(callOrder).toEqual(["article:update", "snapshot:restore"]);
    // Dialog dismissed after success.
    expect(screen.queryByTestId("restore-unsaved-dialog")).toBeNull();
  });

  test("Restore on dirty + Discard path: snapshot:restore only, no article:update", async () => {
    const article = makeArticle();
    const snapshot = makeSnapshot({ id: "snap-42" });
    let updateCalled = false;
    let restoreCalledWith: unknown = null;
    await mountModal({
      article,
      snapshots: [snapshot],
      onUpdate: () => {
        updateCalled = true;
        return article;
      },
      onRestore: (payload) => {
        restoreCalledWith = payload;
        return makeArticle({ body: "Restored body.", bodyFormat: "plain" });
      },
    });

    // Mark dirty.
    fireEvent.click(screen.getByTestId("edit-article-details-toggle"));
    const headline = screen.getByTestId("edit-article-headline") as HTMLInputElement;
    fireEvent.change(headline, { target: { value: "Edited headline" } });

    fireEvent.click(screen.getByTestId("article-history-row-snap-42"));
    await flushAsync();

    fireEvent.click(screen.getByTestId("article-history-restore"));
    fireEvent.click(screen.getByTestId("restore-unsaved-discard"));
    await flushAsync();

    expect(updateCalled).toBe(false);
    expect(restoreCalledWith).toEqual({ snapshotId: "snap-42" });
    expect(screen.queryByTestId("restore-unsaved-dialog")).toBeNull();
  });

  test("Restore on dirty + Cancel: nothing IPC-side; dialog closes", async () => {
    const article = makeArticle();
    const snapshot = makeSnapshot({ id: "snap-42" });
    let updateCalled = false;
    let restoreCalled = false;
    await mountModal({
      article,
      snapshots: [snapshot],
      onUpdate: () => {
        updateCalled = true;
        return article;
      },
      onRestore: () => {
        restoreCalled = true;
        return article;
      },
    });

    // Mark dirty.
    fireEvent.click(screen.getByTestId("edit-article-details-toggle"));
    const headline = screen.getByTestId("edit-article-headline") as HTMLInputElement;
    fireEvent.change(headline, { target: { value: "Edited headline" } });

    fireEvent.click(screen.getByTestId("article-history-row-snap-42"));
    await flushAsync();

    fireEvent.click(screen.getByTestId("article-history-restore"));
    fireEvent.click(screen.getByTestId("restore-unsaved-cancel"));
    await flushAsync();

    expect(updateCalled).toBe(false);
    expect(restoreCalled).toBe(false);
    expect(screen.queryByTestId("restore-unsaved-dialog")).toBeNull();
  });

  test("below 1000px modal width, the right preview pane is hidden", async () => {
    const article = makeArticle();
    await mountModal({ article, snapshots: [makeSnapshot()] });

    // Default shows it.
    expect(screen.queryByTestId("edit-article-preview")).toBeTruthy();

    // Shrink below the breakpoint via the captured ResizeObserver callback.
    triggerWidth(800);
    expect(screen.queryByTestId("edit-article-preview")).toBeNull();

    // Grow back — preview returns.
    triggerWidth(1100);
    expect(screen.queryByTestId("edit-article-preview")).toBeTruthy();
  });

  test("Compare button opens the DiffViewer overlay", async () => {
    const article = makeArticle();
    const snapshot = makeSnapshot({ id: "snap-42" });
    await mountModal({ article, snapshots: [snapshot] });

    // Select a snapshot so the right pane shows the Compare button.
    fireEvent.click(screen.getByTestId("article-history-row-snap-42"));
    await flushAsync();

    fireEvent.click(screen.getByTestId("edit-article-compare"));
    await flushAsync();

    expect(screen.getByTestId("diff-viewer")).toBeTruthy();
  });
});
