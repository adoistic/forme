/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<DiffViewer>` (T9 / v0.6).
 *
 * The component fetches snapshot bodies via the typed IPC client and
 * runs them through pure block + char diff helpers. We mock `invoke` so
 * tests don't need an Electron preload bridge, and we exercise both the
 * pure diff (in isolation) and the rendered DiffViewer surface.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// Mock IPC client BEFORE importing the component (vitest hoists vi.mock).
vi.mock("../../../src/renderer/ipc/client.js", () => ({
  invoke: vi.fn(),
  IpcError: class IpcError extends Error {},
}));

import { invoke } from "../../../src/renderer/ipc/client.js";
import { DiffViewer } from "../../../src/renderer/components/diff-viewer/DiffViewer.js";
import {
  computeBlockDiff,
  extractBlockText,
  computeIntraBlockDiff,
  type BlockLike,
} from "../../../src/renderer/components/diff-viewer/diff.js";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

// ---- Test helpers ---------------------------------------------------------

interface MockSnapshotBody {
  articleId: string;
  body: string;
  createdAt: string;
  label: string | null;
  starred: boolean;
}

function makeBlock(id: string, text: string): BlockLike {
  return {
    id,
    type: "paragraph",
    content: [{ type: "text", text, styles: {} }],
  };
}

function blocksToBody(blocks: BlockLike[]): string {
  return JSON.stringify(blocks);
}

function snapshotBody(opts: {
  body: string;
  label?: string | null;
  createdAt?: string;
}): MockSnapshotBody {
  return {
    articleId: "art-1",
    body: opts.body,
    createdAt: opts.createdAt ?? "2026-04-22T13:48:00Z",
    label: opts.label ?? null,
    starred: false,
  };
}

// Render the DiffViewer with both bodies pre-mocked. Returns the test
// utilities + a flush helper that lets the IPC promises settle.
async function renderViewer(props: {
  beforeBlocks: BlockLike[];
  afterBlocks: BlockLike[] | null;
  beforeSnapshotId?: string;
  afterSnapshotId?: string | null;
  onClose?: () => void;
  onRestore?: (id: string) => void;
}): Promise<ReturnType<typeof render>> {
  const beforeBody = snapshotBody({
    body: blocksToBody(props.beforeBlocks),
    label: "before-label",
  });

  // Mock the two IPC calls in the order DiffViewer issues them
  // (snapshot:read for BEFORE, then snapshot:read OR article:read-body for AFTER).
  mockedInvoke.mockImplementation(async (channel: string) => {
    if (channel === "snapshot:read") {
      // First call returns BEFORE; subsequent calls return AFTER (snapshot mode).
      const callIdx = mockedInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "snapshot:read"
      ).length;
      if (callIdx === 1) return beforeBody;
      return snapshotBody({
        body: blocksToBody(props.afterBlocks ?? []),
        label: "after-label",
      });
    }
    if (channel === "article:read-body") {
      return {
        id: "art-1",
        body: blocksToBody(props.afterBlocks ?? []),
        bodyFormat: "blocks" as const,
      };
    }
    throw new Error(`unexpected channel: ${channel}`);
  });

  const utils = render(
    <DiffViewer
      articleId="art-1"
      beforeSnapshotId={props.beforeSnapshotId ?? "snap-before"}
      afterSnapshotId={props.afterSnapshotId === undefined ? null : props.afterSnapshotId}
      open
      onClose={props.onClose ?? (() => {})}
      onRestore={props.onRestore ?? (() => {})}
      beforeVersionLabel="v8"
      afterVersionLabel="current"
    />
  );

  // Two awaits — first to resolve Promise.all, second to flush React's
  // setState batching after the resolution.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  mockedInvoke.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---- Pure diff helpers ----------------------------------------------------

describe("extractBlockText", () => {
  test("extracts text from a simple paragraph block", () => {
    const block = makeBlock("b1", "Hello world.");
    expect(extractBlockText(block)).toBe("Hello world.");
  });

  test("concatenates inline runs", () => {
    const block: BlockLike = {
      id: "b1",
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world." },
      ],
    };
    expect(extractBlockText(block)).toBe("Hello world.");
  });

  test("returns empty string for null / no content", () => {
    expect(extractBlockText(null)).toBe("");
    expect(extractBlockText({ id: "b1", type: "paragraph" })).toBe("");
  });
});

describe("computeBlockDiff", () => {
  test("identical bodies → identical=true, no entries with kind!=unchanged", () => {
    const blocks = [makeBlock("b1", "A"), makeBlock("b2", "B")];
    const result = computeBlockDiff(blocks, blocks);
    expect(result.identical).toBe(true);
    expect(result.changedCount).toBe(0);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(0);
    expect(result.entries.every((e) => e.kind === "unchanged")).toBe(true);
  });

  test("paragraph text changed → kind=changed", () => {
    const before = [makeBlock("b1", "Hello world.")];
    const after = [makeBlock("b1", "Hello mars.")];
    const result = computeBlockDiff(before, after);
    expect(result.changedCount).toBe(1);
    expect(result.entries[0]?.kind).toBe("changed");
  });

  test("new block in AFTER → kind=added", () => {
    const before = [makeBlock("b1", "A")];
    const after = [makeBlock("b1", "A"), makeBlock("b2", "B")];
    const result = computeBlockDiff(before, after);
    expect(result.addedCount).toBe(1);
    expect(result.entries.find((e) => e.kind === "added")?.after).toEqual(makeBlock("b2", "B"));
  });

  test("missing block in AFTER → kind=removed", () => {
    const before = [makeBlock("b1", "A"), makeBlock("b2", "B")];
    const after = [makeBlock("b1", "A")];
    const result = computeBlockDiff(before, after);
    expect(result.removedCount).toBe(1);
    expect(result.entries.find((e) => e.kind === "removed")?.before).toEqual(makeBlock("b2", "B"));
  });

  test("oversize blocks set entry.oversize=true", () => {
    const huge = "x".repeat(80 * 1024); // 80KB > 75KB cap
    const before = [makeBlock("b1", huge)];
    const after = [makeBlock("b1", huge + "y")];
    const result = computeBlockDiff(before, after);
    expect(result.entries[0]?.oversize).toBe(true);
  });
});

describe("computeIntraBlockDiff", () => {
  test("returns equal segments when texts match", () => {
    const segs = computeIntraBlockDiff("hello", "hello");
    expect(segs).toEqual([{ op: "equal", text: "hello" }]);
  });

  test("returns insert + delete + equal segments for partial change", () => {
    const segs = computeIntraBlockDiff("hello world", "hello mars");
    // Should contain at least one of each non-equal op.
    expect(segs.some((s) => s.op === "delete")).toBe(true);
    expect(segs.some((s) => s.op === "insert")).toBe(true);
  });
});

// ---- Rendered <DiffViewer> ------------------------------------------------

describe("<DiffViewer>", () => {
  test("renders the header with version pills", async () => {
    await renderViewer({
      beforeBlocks: [makeBlock("b1", "A")],
      afterBlocks: [makeBlock("b1", "A")],
      afterSnapshotId: "snap-after",
    });
    expect(screen.getByText("Compare versions")).toBeTruthy();
    expect(screen.getByTestId("diff-viewer-pill-before").textContent).toContain("v8");
    expect(screen.getByTestId("diff-viewer-pill-after").textContent).toContain("current");
  });

  test("identical bodies show 'Identical.'", async () => {
    await renderViewer({
      beforeBlocks: [makeBlock("b1", "A")],
      afterBlocks: [makeBlock("b1", "A")],
      afterSnapshotId: "snap-after",
    });
    expect(screen.getByTestId("diff-viewer-identical")).toBeTruthy();
    expect(screen.queryByTestId("diff-viewer-map")).toBeNull();
  });

  test("CHANGED block shows char-level diff (removed + added markers)", async () => {
    await renderViewer({
      beforeBlocks: [makeBlock("b1", "Hello world.")],
      afterBlocks: [makeBlock("b1", "Hello mars.")],
      afterSnapshotId: "snap-after",
    });
    // The focused entry should be the changed paragraph.
    expect(screen.getByTestId("diff-viewer-pane")).toBeTruthy();
    expect(screen.getAllByTestId("diff-viewer-removed-marker").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("diff-viewer-added-marker").length).toBeGreaterThan(0);
  });

  test("ADDED block shows + marker on map rail", async () => {
    await renderViewer({
      beforeBlocks: [makeBlock("b1", "A")],
      afterBlocks: [makeBlock("b1", "A"), makeBlock("b2", "Brand new paragraph.")],
      afterSnapshotId: "snap-after",
    });
    // The map row for the added entry must have data-kind="added".
    const addedRow = document.querySelector(
      '[data-testid^="diff-viewer-map-row-"][data-kind="added"]'
    );
    expect(addedRow).not.toBeNull();
    // And carry the per-row "+" marker badge.
    const marker = addedRow?.querySelector('[data-testid^="diff-viewer-map-marker-"]');
    expect(marker?.textContent).toBe("+");
  });

  test("REMOVED block shows − marker on map rail", async () => {
    await renderViewer({
      beforeBlocks: [makeBlock("b1", "A"), makeBlock("b2", "Going away.")],
      afterBlocks: [makeBlock("b1", "A")],
      afterSnapshotId: "snap-after",
    });
    const removedRow = document.querySelector('[data-testid^="diff-viewer-map-row-"][data-kind="removed"]');
    expect(removedRow).not.toBeNull();
  });

  test("clicking a map row sets focused index (different paragraph in pane)", async () => {
    await renderViewer({
      beforeBlocks: [
        makeBlock("b1", "First paragraph."),
        makeBlock("b2", "Second paragraph."),
      ],
      afterBlocks: [
        makeBlock("b1", "First paragraph CHANGED."),
        makeBlock("b2", "Second paragraph also CHANGED."),
      ],
      afterSnapshotId: "snap-after",
    });
    // Initial focus lands on the first changed entry (index 0).
    expect(screen.getByTestId("diff-viewer-pane").getAttribute("aria-label")).toContain(
      "Paragraph 1"
    );

    // Click row 1 (index 1) → pane updates to Paragraph 2.
    const row2 = screen.getByTestId("diff-viewer-map-row-1");
    fireEvent.click(row2);
    expect(screen.getByTestId("diff-viewer-pane").getAttribute("aria-label")).toContain(
      "Paragraph 2"
    );
  });

  test("ESC closes the diff (Radix Dialog → onClose)", async () => {
    const onClose = vi.fn();
    await renderViewer({
      beforeBlocks: [makeBlock("b1", "A")],
      afterBlocks: [makeBlock("b1", "B")],
      afterSnapshotId: "snap-after",
      onClose,
    });
    // Radix listens for Escape on the Dialog.Content. Fire on the document body.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Restore button → confirm dialog → onRestore called with LEFT snapshot id", async () => {
    const onRestore = vi.fn();
    await renderViewer({
      beforeBlocks: [makeBlock("b1", "A")],
      afterBlocks: [makeBlock("b1", "B")],
      beforeSnapshotId: "snap-before-id-42",
      afterSnapshotId: "snap-after",
      onRestore,
    });
    fireEvent.click(screen.getByTestId("diff-viewer-restore"));
    // Confirm dialog appears.
    expect(screen.getByTestId("diff-viewer-restore-confirm")).toBeTruthy();
    // Confirming fires onRestore with the BEFORE snapshot id.
    fireEvent.click(screen.getByTestId("diff-viewer-restore-confirm-button"));
    expect(onRestore).toHaveBeenCalledWith("snap-before-id-42");
  });

  test("oversize CHANGED block falls back to 'block too large' notice", async () => {
    const huge = "lorem ".repeat(20 * 1024); // ~120KB
    await renderViewer({
      beforeBlocks: [makeBlock("b1", huge)],
      afterBlocks: [makeBlock("b1", huge + "tiny suffix")],
      afterSnapshotId: "snap-after",
    });
    expect(screen.getByTestId("diff-viewer-oversize-notice")).toBeTruthy();
    // Char-level markers should NOT be present in oversize fallback.
    expect(screen.queryByTestId("diff-viewer-removed-marker")).toBeNull();
    expect(screen.queryByTestId("diff-viewer-added-marker")).toBeNull();
  });

  test("empty BEFORE body shows the empty-version state", async () => {
    await renderViewer({
      beforeBlocks: [],
      afterBlocks: [makeBlock("b1", "Some content.")],
      afterSnapshotId: "snap-after",
    });
    expect(screen.getByTestId("diff-viewer-empty-before")).toBeTruthy();
  });

  test("ArrowDown / ArrowUp moves focused paragraph", async () => {
    await renderViewer({
      beforeBlocks: [
        makeBlock("b1", "Para 1."),
        makeBlock("b2", "Para 2."),
        makeBlock("b3", "Para 3."),
      ],
      afterBlocks: [
        makeBlock("b1", "Para 1 changed."),
        makeBlock("b2", "Para 2 also changed."),
        makeBlock("b3", "Para 3 too."),
      ],
      afterSnapshotId: "snap-after",
    });
    // Initial focus on first changed (index 0).
    const dialog = screen.getByTestId("diff-viewer");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(screen.getByTestId("diff-viewer-pane").getAttribute("aria-label")).toContain(
      "Paragraph 2"
    );
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expect(screen.getByTestId("diff-viewer-pane").getAttribute("aria-label")).toContain(
      "Paragraph 1"
    );
  });

  test("J / K step through changes only, skipping unchanged paragraphs", async () => {
    await renderViewer({
      beforeBlocks: [
        makeBlock("b1", "Unchanged paragraph."),
        makeBlock("b2", "Changing paragraph."),
        makeBlock("b3", "Another unchanged one."),
        makeBlock("b4", "Also changing."),
      ],
      afterBlocks: [
        makeBlock("b1", "Unchanged paragraph."),
        makeBlock("b2", "Changing paragraph CHANGED."),
        makeBlock("b3", "Another unchanged one."),
        makeBlock("b4", "Also changing CHANGED."),
      ],
      afterSnapshotId: "snap-after",
    });
    // First changed paragraph (index 1, "Paragraph 2") is initial focus.
    expect(screen.getByTestId("diff-viewer-pane").getAttribute("aria-label")).toContain(
      "Paragraph 2"
    );
    const dialog = screen.getByTestId("diff-viewer");
    fireEvent.keyDown(dialog, { key: "j" });
    // J skips unchanged → next change is Paragraph 4.
    expect(screen.getByTestId("diff-viewer-pane").getAttribute("aria-label")).toContain(
      "Paragraph 4"
    );
    fireEvent.keyDown(dialog, { key: "k" });
    expect(screen.getByTestId("diff-viewer-pane").getAttribute("aria-label")).toContain(
      "Paragraph 2"
    );
  });
});
