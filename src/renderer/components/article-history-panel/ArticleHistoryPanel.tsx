import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "../../ipc/client.js";
import type { ArticleSnapshotSummary } from "@shared/ipc-contracts/channels.js";
import { bucketForDate, BUCKET_ORDER, type DateBucket } from "./bucket.js";
import { SearchInput } from "./SearchInput.js";
import { VersionRow } from "./VersionRow.js";
import { DeleteConfirm } from "./DeleteConfirm.js";

// Re-export the date helpers so tests + future callers can import from
// the panel module without reaching into internals.
export { bucketForDate, formatRowTime } from "./bucket.js";

/**
 * `<ArticleHistoryPanel>` — the 200px left rail of EditArticleModal in
 * 3-pane mode (T7 / v0.6).
 *
 * Approved variant: design-shotgun "Vertical Type Specimen" (variant A,
 * 2026-04-22). DESIGN.md §9 ScrubTimeline.
 *
 * The panel owns the snapshot list for one article: it fetches on mount,
 * groups rows by date (TODAY / YESTERDAY / LAST WEEK / OLDER), filters
 * by label substring, and supports arrow-key + PgUp/PgDn navigation.
 * Star and label edits + per-version delete go straight through IPC; the
 * caller only needs to react to selection / restore.
 *
 * The selected row + restore button are CONTROLLED by the caller (the
 * EditArticleModal — T10), so the panel can be reused later for the diff
 * compare overlay (T11) without becoming the source of truth.
 */
export interface ArticleHistoryPanelProps {
  articleId: string;
  /** Currently selected snapshot id (controlled). null = current draft. */
  selectedSnapshotId: string | null;
  /** Called when operator clicks a different snapshot row. */
  onSelect: (snapshotId: string | null) => void;
  /** Called when operator restores a snapshot. */
  onRestore: (snapshotId: string) => void;
  /** Optional: max width in px (default 200). */
  width?: number;
}

interface GroupedSnapshots {
  bucket: DateBucket;
  rows: ArticleSnapshotSummary[];
}

export function ArticleHistoryPanel({
  articleId,
  selectedSnapshotId,
  onSelect,
  onRestore,
  width = 200,
}: ArticleHistoryPanelProps): React.ReactElement {
  const [snapshots, setSnapshots] = useState<ArticleSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Stable "now" per fetch. Recomputed when snapshots reload — sufficient
  // because edits happen seconds-to-minutes apart and a hard reload would
  // pick up any drift.
  const now = useMemo(() => new Date(), [snapshots]);

  // ---- Fetch on mount + when articleId changes ------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke("snapshot:list", { articleId })
      .then((rows) => {
        if (cancelled) return;
        setSnapshots(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load history.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  // ---- Filter by label substring (case-insensitive) -------------------
  const visible = useMemo(() => {
    if (!query.trim()) return snapshots;
    const q = query.toLowerCase();
    return snapshots.filter((s) => (s.label ?? "").toLowerCase().includes(q));
  }, [snapshots, query]);

  // ---- Group by date bucket ------------------------------------------
  const groups = useMemo<GroupedSnapshots[]>(() => {
    const byBucket = new Map<DateBucket, ArticleSnapshotSummary[]>();
    for (const s of visible) {
      const b = bucketForDate(s.createdAt, now);
      const arr = byBucket.get(b) ?? [];
      arr.push(s);
      byBucket.set(b, arr);
    }
    return BUCKET_ORDER.flatMap((bucket) => {
      const rows = byBucket.get(bucket);
      return rows && rows.length > 0 ? [{ bucket, rows }] : [];
    });
  }, [visible, now]);

  // Flat order used by keyboard nav + index lookup.
  const flatOrder = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  // ---- Keyboard navigation -------------------------------------------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (flatOrder.length === 0) return;
      const currentIdx = selectedSnapshotId
        ? flatOrder.findIndex((s) => s.id === selectedSnapshotId)
        : -1;

      let nextIdx: number;
      if (e.key === "ArrowDown") nextIdx = Math.min(flatOrder.length - 1, currentIdx + 1);
      else if (e.key === "ArrowUp") nextIdx = Math.max(0, currentIdx - 1);
      else if (e.key === "PageDown") nextIdx = Math.min(flatOrder.length - 1, currentIdx + 10);
      else if (e.key === "PageUp") nextIdx = Math.max(0, currentIdx - 10);
      else return;

      e.preventDefault();
      // If nothing was selected and we step "up", land on first row.
      const target = nextIdx < 0 ? flatOrder[0] : flatOrder[nextIdx];
      if (target) onSelect(target.id);
    },
    [flatOrder, selectedSnapshotId, onSelect]
  );

  // ---- Snapshot mutations (label / star / delete) --------------------
  async function handleStar(snap: ArticleSnapshotSummary): Promise<void> {
    try {
      const updated = await invoke("snapshot:star", {
        snapshotId: snap.id,
        starred: !snap.starred,
      });
      setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch {
      // Surface via parent toast in T10; for now swallow to avoid a UI
      // dead-end. The optimistic state stays consistent because we only
      // commit on success.
    }
  }

  async function handleLabelCommit(snap: ArticleSnapshotSummary, next: string): Promise<void> {
    setEditingLabelId(null);
    const trimmed = next.trim();
    if ((snap.label ?? "") === trimmed) return;
    try {
      const updated = await invoke("snapshot:label", {
        snapshotId: snap.id,
        label: trimmed.length > 0 ? trimmed : null,
      });
      setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch {
      // Same rationale as handleStar.
    }
  }

  async function handleDelete(snapshotId: string): Promise<void> {
    setConfirmDeleteId(null);
    setOpenMenuId(null);
    try {
      await invoke("snapshot:delete", { snapshotId });
      setSnapshots((prev) => prev.filter((s) => s.id !== snapshotId));
      if (selectedSnapshotId === snapshotId) onSelect(null);
    } catch {
      // No-op — same reasoning as the other mutations.
    }
  }

  const isCurrentDraftSelected = selectedSnapshotId === null;

  return (
    <div
      className="bg-bg-surface border-border-default flex h-full shrink-0 flex-col border-r"
      style={{ width }}
      role="region"
      aria-label="Article version history"
      data-testid="article-history-panel"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Header — UPPERCASE label + version count */}
      <div className="flex items-baseline justify-between px-3 pt-4 pb-2">
        <span className="text-label-caps text-text-secondary">VERSION HISTORY</span>
        <span className="text-caption text-text-tertiary">
          {snapshots.length} {snapshots.length === 1 ? "version" : "versions"}
        </span>
      </div>

      {/* Search input with ⌘F hint */}
      <div className="px-3 pb-3">
        <SearchInput ref={searchRef} value={query} onChange={setQuery} />
      </div>

      {/* Scrolling list */}
      <div className="flex-1 overflow-y-auto" data-testid="article-history-list">
        {loading && (
          <p className="text-caption text-text-tertiary px-3 py-4">Loading versions…</p>
        )}
        {error && !loading && (
          <p className="text-caption text-error px-3 py-4" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && snapshots.length === 0 && (
          <p
            className="text-text-tertiary font-display px-3 py-6 text-[14px] italic"
            data-testid="article-history-empty"
          >
            No version history yet. Save the article to start a timeline.
          </p>
        )}
        {!loading && !error && snapshots.length > 0 && visible.length === 0 && (
          <p className="text-caption text-text-tertiary px-3 py-4">No matching versions.</p>
        )}

        {groups.map(({ bucket, rows }) => (
          <section key={bucket} aria-label={bucket}>
            {/* Date divider */}
            <div className="px-3 pt-3 pb-1">
              <div className="border-border-default flex items-center border-b pb-1">
                <span className="text-label-caps text-text-tertiary">{bucket}</span>
              </div>
            </div>
            {rows.map((snap) => (
              <VersionRow
                key={snap.id}
                snap={snap}
                isSelected={snap.id === selectedSnapshotId}
                isMenuOpen={openMenuId === snap.id}
                isEditingLabel={editingLabelId === snap.id}
                now={now}
                onClick={() => onSelect(snap.id)}
                onToggleMenu={() => setOpenMenuId((id) => (id === snap.id ? null : snap.id))}
                onCloseMenu={() => setOpenMenuId(null)}
                onStar={() => void handleStar(snap)}
                onStartLabelEdit={() => setEditingLabelId(snap.id)}
                onCommitLabel={(next) => void handleLabelCommit(snap, next)}
                onAskDelete={() => setConfirmDeleteId(snap.id)}
              />
            ))}
          </section>
        ))}
      </div>

      {/* Restore button — only when a non-current snapshot is selected */}
      {!isCurrentDraftSelected && selectedSnapshotId && (
        <div className="border-border-default border-t p-3">
          <button
            type="button"
            data-testid="article-history-restore"
            onClick={() => onRestore(selectedSnapshotId)}
            className="text-accent border-accent hover:bg-accent-bg text-title-sm w-full rounded-md border-[1.5px] bg-transparent px-3 py-2 font-semibold transition-colors"
          >
            Restore this version
          </button>
        </div>
      )}

      {/* Keyboard hints — bottom of rail per ER2-7 */}
      <div className="border-border-default text-text-tertiary border-t px-3 py-2 text-[11px]">
        ↑ ↓ to step · PgUp PgDn for ×10 · ⌘F to search
      </div>

      {/* Delete confirm dialog */}
      {confirmDeleteId && (
        <DeleteConfirm
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => void handleDelete(confirmDeleteId)}
        />
      )}
    </div>
  );
}
