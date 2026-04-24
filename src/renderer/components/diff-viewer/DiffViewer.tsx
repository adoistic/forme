import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "../../ipc/client.js";
import type { ArticleSnapshotBody } from "@shared/ipc-contracts/channels.js";
import { DiffMap } from "./DiffMap.js";
import { DiffPane } from "./DiffPane.js";
import { IdenticalEmpty } from "./IdenticalEmpty.js";
import { RestoreConfirm } from "./RestoreConfirm.js";
import { computeBlockDiff, type BlockLike, type BlockDiffResult } from "./diff.js";

/**
 * `<DiffViewer>` — modal-on-modal full-bleed Radix Dialog overlay
 * (T9 / v0.6). DESIGN.md §9 DiffViewer overlay component spec.
 *
 * Sits on top of `<EditArticleModal>` (which is also a Radix Dialog).
 * T10 will mount this once the operator picks two snapshots to compare;
 * the parent owns the `open` state so it can pre-close any Tiptap
 * floating UI before mounting (per ER2-7).
 *
 * Map + Detail layout (variant C from design-shotgun 2026-04-22):
 *   - 64px header   — title + version pills + close (X · ESC)
 *   - 40px sub-bar  — change summary + nav arrows (J/K hint)
 *   - 200px map     — tinted paragraph rows on the left
 *   - main pane     — focused paragraph BEFORE / AFTER side-by-side
 *   - footer        — Restore v[N] (filled rust) + Cancel (ghost)
 */
export interface DiffViewerProps {
  /** Article id for context (used for current-body fetch). */
  articleId: string;
  /** Snapshot id of the older version (left side / BEFORE). */
  beforeSnapshotId: string;
  /** Snapshot id of the newer version (right side / AFTER); null = current article body. */
  afterSnapshotId: string | null;
  /** Open / closed state — controlled by parent. */
  open: boolean;
  /** Called when operator dismisses the diff (ESC, X, backdrop click). */
  onClose: () => void;
  /** Called when operator confirms restore — passes the LEFT version's snapshot id. */
  onRestore: (snapshotId: string) => void;
  /**
   * Optional version-label resolvers. Defaults to "v[snapshotIdSuffix]";
   * the parent (EditArticleModal) usually has the relative version number
   * already (v8 etc.) and passes it in.
   */
  beforeVersionLabel?: string;
  afterVersionLabel?: string;
}

interface FetchedBody {
  body: string;
  createdAt: string | null;
  label: string | null;
}

interface FetchState {
  loading: boolean;
  error: string | null;
  before: FetchedBody | null;
  after: FetchedBody | null;
}

const INITIAL_FETCH: FetchState = {
  loading: true,
  error: null,
  before: null,
  after: null,
};

export function DiffViewer({
  articleId,
  beforeSnapshotId,
  afterSnapshotId,
  open,
  onClose,
  onRestore,
  beforeVersionLabel,
  afterVersionLabel,
}: DiffViewerProps): React.ReactElement {
  const [fetched, setFetched] = useState<FetchState>(INITIAL_FETCH);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  // ---- Fetch both bodies on open / when ids change -------------------
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFetched({ loading: true, error: null, before: null, after: null });
    setFocusedIndex(0);

    Promise.all([
      invoke("snapshot:read", { snapshotId: beforeSnapshotId }),
      afterSnapshotId === null
        ? invoke("article:read-body", { id: articleId })
        : invoke("snapshot:read", { snapshotId: afterSnapshotId }),
    ])
      .then(([beforeBody, afterBody]) => {
        if (cancelled) return;
        setFetched({
          loading: false,
          error: null,
          before: snapshotToFetched(beforeBody),
          after: anyBodyToFetched(afterBody),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetched({
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : "We couldn't load one of the versions for comparison.",
          before: null,
          after: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, articleId, beforeSnapshotId, afterSnapshotId]);

  // ---- Compute diff once both bodies arrive --------------------------
  const diff = useMemo<BlockDiffResult | null>(() => {
    if (!fetched.before || !fetched.after) return null;
    const beforeBlocks = parseBlocks(fetched.before.body);
    const afterBlocks = parseBlocks(fetched.after.body);
    return computeBlockDiff(beforeBlocks, afterBlocks);
  }, [fetched.before, fetched.after]);

  // Filtered list of CHANGED-ish entry indices. Used by J/K to step
  // through *changes only*, skipping unchanged paragraphs.
  const changedIndices = useMemo<number[]>(() => {
    if (!diff) return [];
    return diff.entries.filter((e) => e.kind !== "unchanged").map((e) => e.index);
  }, [diff]);

  // Snap focusedIndex to the first changed entry when the diff first
  // arrives so the operator lands on something interesting, not on the
  // first unchanged paragraph.
  useEffect(() => {
    if (diff && changedIndices.length > 0) {
      setFocusedIndex(changedIndices[0] ?? 0);
    }
  }, [diff, changedIndices]);

  const focusedEntry = diff?.entries[focusedIndex] ?? null;

  // ---- Keyboard navigation: ↑/↓ steps any paragraph; J/K steps changes only.
  // ESC is handled by Radix Dialog (it calls onOpenChange(false) → onClose).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!diff || diff.entries.length === 0) return;
      const total = diff.entries.length;

      const stepAny = (delta: 1 | -1): void => {
        const next = Math.min(total - 1, Math.max(0, focusedIndex + delta));
        setFocusedIndex(next);
      };

      const stepChanges = (delta: 1 | -1): void => {
        if (changedIndices.length === 0) return;
        const cur = changedIndices.indexOf(focusedIndex);
        if (cur === -1) {
          // Not on a changed entry — jump to the first / last changed.
          const target =
            delta === 1 ? changedIndices[0] : changedIndices[changedIndices.length - 1];
          if (target !== undefined) setFocusedIndex(target);
          return;
        }
        const nextIdx = Math.min(changedIndices.length - 1, Math.max(0, cur + delta));
        const target = changedIndices[nextIdx];
        if (target !== undefined) setFocusedIndex(target);
      };

      if (e.key === "ArrowDown") {
        e.preventDefault();
        stepAny(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        stepAny(-1);
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        stepChanges(1);
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        stepChanges(-1);
      }
    },
    [diff, focusedIndex, changedIndices]
  );

  const beforeLabel = beforeVersionLabel ?? formatFallbackLabel(fetched.before);
  const afterLabel =
    afterVersionLabel ??
    (afterSnapshotId === null ? "current" : formatFallbackLabel(fetched.after));

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className="bg-bg-overlay fixed inset-0 z-50"
          data-testid="diff-viewer-overlay"
        />
        <Dialog.Content
          className="bg-bg-surface fixed inset-0 z-50 flex flex-col shadow-[0_8px_40px_rgba(26,26,26,0.12)] focus:outline-none"
          data-testid="diff-viewer"
          onKeyDown={handleKeyDown}
          // Stop Radix from auto-focusing the close button on mount; we
          // want focus to land on the diff surface so keyboard nav works
          // immediately. The container is `tabIndex=-1` via Radix already.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          {/* TODO(T10): EditArticleModal must pre-close any Tiptap floating UI
              (selection menus, link popovers) before opening this dialog so
              the floating layers don't outlive their owning editor surface
              (ER2-7). */}

          <Header beforeLabel={beforeLabel} afterLabel={afterLabel} />

          <SubHeader
            diff={diff}
            onStepUp={() => setFocusedIndex((i) => Math.max(0, i - 1))}
            onStepDown={() =>
              setFocusedIndex((i) => (diff ? Math.min(diff.entries.length - 1, i + 1) : i))
            }
            disabled={!diff || diff.entries.length === 0}
          />

          {/* Main row: map + pane (or empty/identical state). */}
          <div className="flex flex-1 overflow-hidden">
            {fetched.loading && (
              <p className="text-text-secondary px-10 py-10" data-testid="diff-viewer-loading">
                Loading versions for comparison…
              </p>
            )}

            {fetched.error && (
              <p className="text-error px-10 py-10" role="alert" data-testid="diff-viewer-error">
                {fetched.error}
              </p>
            )}

            {!fetched.loading &&
              !fetched.error &&
              diff &&
              renderDiffArea(diff, focusedEntry, beforeLabel, afterLabel, setFocusedIndex)}
          </div>

          <Footer
            versionLabel={beforeLabel}
            canRestore={!fetched.loading && !fetched.error && diff !== null}
            onCancel={onClose}
            onRestoreClick={() => setConfirmingRestore(true)}
          />
        </Dialog.Content>
      </Dialog.Portal>

      {confirmingRestore && (
        <RestoreConfirm
          versionLabel={beforeLabel}
          onCancel={() => setConfirmingRestore(false)}
          onConfirm={() => {
            setConfirmingRestore(false);
            onRestore(beforeSnapshotId);
          }}
        />
      )}
    </Dialog.Root>
  );
}

// ---- Subcomponents kept private to the file -------------------------------

function Header({
  beforeLabel,
  afterLabel,
}: {
  beforeLabel: string;
  afterLabel: string;
}): React.ReactElement {
  return (
    <header className="border-border-default flex h-16 items-center justify-between border-b px-8">
      <div className="flex items-center gap-4">
        <Dialog.Title className="font-display text-text-primary text-[22px] font-bold">
          Compare versions
        </Dialog.Title>
        <div
          className="border-border-default flex items-center gap-2 rounded-full border bg-transparent px-3 py-1"
          aria-label="Versions being compared"
        >
          <span
            className="text-caption text-text-secondary px-2 py-0.5"
            data-testid="diff-viewer-pill-before"
          >
            {beforeLabel}
          </span>
          <span aria-hidden="true" className="text-text-tertiary">
            →
          </span>
          <span
            className="text-caption text-text-primary px-2 py-0.5 font-semibold"
            data-testid="diff-viewer-pill-after"
          >
            {afterLabel}
          </span>
        </div>
      </div>
      <Dialog.Close asChild>
        <button
          type="button"
          aria-label="Close compare versions"
          data-testid="diff-viewer-close"
          className="text-text-secondary flex flex-col items-center rounded-md px-2 py-1 hover:bg-black/[0.04]"
        >
          <span className="text-lg leading-none">×</span>
          <span className="text-text-tertiary mt-1 text-[11px]">ESC</span>
        </button>
      </Dialog.Close>
    </header>
  );
}

function SubHeader({
  diff,
  onStepUp,
  onStepDown,
  disabled,
}: {
  diff: BlockDiffResult | null;
  onStepUp: () => void;
  onStepDown: () => void;
  disabled: boolean;
}): React.ReactElement {
  const summary = diff
    ? `${diff.changedCount} ${pluralize("paragraph", diff.changedCount)} changed · ${diff.addedCount} added · ${diff.removedCount} removed · ${diff.wordDelta >= 0 ? "+" : ""}${diff.wordDelta} ${pluralize("word", Math.abs(diff.wordDelta))}`
    : "Loading diff…";

  return (
    <div className="bg-bg-canvas border-border-default flex h-10 items-center justify-between border-b px-8">
      <span className="text-caption text-text-secondary" data-testid="diff-viewer-summary">
        {summary}
      </span>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={disabled}
            onClick={onStepUp}
            aria-label="Previous paragraph"
            data-testid="diff-viewer-step-up"
            className="text-text-secondary rounded-md px-2 py-0.5 text-sm hover:bg-black/[0.04] disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onStepDown}
            aria-label="Next paragraph"
            data-testid="diff-viewer-step-down"
            className="text-text-secondary rounded-md px-2 py-0.5 text-sm hover:bg-black/[0.04] disabled:opacity-40"
          >
            ↓
          </button>
        </div>
        <span className="text-text-tertiary text-[11px]">J/K to step</span>
      </div>
    </div>
  );
}

function Footer({
  versionLabel,
  canRestore,
  onCancel,
  onRestoreClick,
}: {
  versionLabel: string;
  canRestore: boolean;
  onCancel: () => void;
  onRestoreClick: () => void;
}): React.ReactElement {
  return (
    <footer className="border-border-default flex items-center justify-end gap-2 border-t px-8 py-4">
      <button
        type="button"
        onClick={onCancel}
        className="text-accent border-accent hover:bg-accent-bg text-title-sm rounded-md border-[1.5px] bg-transparent px-5 py-2 font-semibold"
        data-testid="diff-viewer-cancel"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onRestoreClick}
        disabled={!canRestore}
        className="bg-accent text-text-inverse hover:bg-accent-hover text-title-sm rounded-md px-5 py-2 font-semibold disabled:opacity-40"
        data-testid="diff-viewer-restore"
      >
        Restore {versionLabel}
      </button>
    </footer>
  );
}

function renderDiffArea(
  diff: BlockDiffResult,
  focusedEntry: BlockDiffResult["entries"][number] | null,
  beforeLabel: string,
  afterLabel: string,
  onFocus: (idx: number) => void
): React.ReactElement {
  if (diff.beforeEmpty && diff.afterEmpty) {
    return <IdenticalEmpty variant="empty-both" />;
  }
  if (diff.beforeEmpty) return <IdenticalEmpty variant="empty-before" />;
  if (diff.afterEmpty) return <IdenticalEmpty variant="empty-after" />;
  if (diff.identical) return <IdenticalEmpty variant="identical" />;

  return (
    <>
      <DiffMap entries={diff.entries} focusedIndex={focusedEntry?.index ?? 0} onFocus={onFocus} />
      {focusedEntry ? (
        <DiffPane entry={focusedEntry} beforeLabel={beforeLabel} afterLabel={afterLabel} />
      ) : (
        <main className="flex flex-1 items-center justify-center">
          <p className="text-text-secondary">Select a paragraph from the diff map.</p>
        </main>
      )}
    </>
  );
}

// ---- Helpers --------------------------------------------------------------

function snapshotToFetched(body: ArticleSnapshotBody): FetchedBody {
  return { body: body.body, createdAt: body.createdAt, label: body.label };
}

function anyBodyToFetched(
  body:
    | ArticleSnapshotBody
    | { id: string; body: string; bodyFormat: "plain" | "markdown" | "blocks" }
): FetchedBody {
  if ("createdAt" in body) {
    return snapshotToFetched(body);
  }
  return { body: body.body, createdAt: null, label: null };
}

function parseBlocks(body: string): BlockLike[] {
  if (!body || !body.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b): b is BlockLike => typeof b === "object" && b !== null);
  } catch {
    return [];
  }
}

function formatFallbackLabel(fetched: FetchedBody | null): string {
  if (!fetched) return "—";
  if (fetched.label) return fetched.label;
  if (fetched.createdAt) {
    try {
      const d = new Date(fetched.createdAt);
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return fetched.createdAt;
    }
  }
  return "version";
}

function pluralize(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}
