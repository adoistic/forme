import React, { useMemo } from "react";
import {
  computeIntraBlockDiff,
  extractBlockText,
  type DiffEntry,
  MAX_BLOCK_SIZE_BYTES,
} from "./diff.js";
import { DiffSubColumn } from "./DiffSubColumn.js";

/**
 * Main pane for `<DiffViewer>` — shows the focused paragraph header
 * ("PARAGRAPH N · CHANGED") plus side-by-side BEFORE / AFTER columns.
 *
 * Char-level diffs are computed lazily for the focused entry only; the
 * other ~hundred entries on the diff map don't pay the diff-match-patch
 * cost up-front.
 */
export interface DiffPaneProps {
  entry: DiffEntry;
  /** Snapshot label for the LEFT (older) version, e.g. "v8 · 1:48 PM". */
  beforeLabel: string;
  /** Snapshot label for the RIGHT (newer) version. "current" for the article. */
  afterLabel: string;
}

export function DiffPane({ entry, beforeLabel, afterLabel }: DiffPaneProps): React.ReactElement {
  const beforeText = useMemo(() => extractBlockText(entry.before), [entry.before]);
  const afterText = useMemo(() => extractBlockText(entry.after), [entry.after]);

  // Char-level segments: only when CHANGED and within size cap. ADDED and
  // REMOVED render the entire side as one block; UNCHANGED just shows the
  // text with no highlights.
  const segments = useMemo(() => {
    if (entry.kind !== "changed") return null;
    if (entry.oversize) return null;
    return computeIntraBlockDiff(beforeText, afterText);
  }, [entry.kind, entry.oversize, beforeText, afterText]);

  return (
    <main
      className="flex flex-1 flex-col px-10 py-6"
      data-testid="diff-viewer-pane"
      role="region"
      aria-label={`Paragraph ${entry.index + 1} ${entry.kind}`}
    >
      <header className="mb-6 flex items-baseline justify-between">
        <h3 className="text-label-caps text-text-secondary">
          PARAGRAPH {entry.index + 1} · {entry.kind.toUpperCase()}
        </h3>
        {entry.oversize && (
          <p
            className="text-caption text-warning"
            data-testid="diff-viewer-oversize-notice"
            role="status"
          >
            Block too large for character-level diff (&gt;
            {Math.round(MAX_BLOCK_SIZE_BYTES / 1024)}KB) — showing block-level diff only.
          </p>
        )}
      </header>

      <div className="flex flex-1 gap-10">
        <DiffSubColumn
          side="before"
          versionLabel={beforeLabel}
          segments={entry.kind === "added" ? null : segments}
          fallbackText={beforeText}
          {...(entry.kind === "added"
            ? { emptyLabel: "(content added — not in this version)" }
            : {})}
        />
        <div className="border-border-default border-l" aria-hidden="true" />
        <DiffSubColumn
          side="after"
          versionLabel={afterLabel}
          segments={entry.kind === "removed" ? null : segments}
          fallbackText={afterText}
          {...(entry.kind === "removed"
            ? { emptyLabel: "(content removed — not in this version)" }
            : {})}
        />
      </div>
    </main>
  );
}
