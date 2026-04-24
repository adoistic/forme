import React from "react";
import type { DiffSegment } from "./diff.js";

/**
 * One half of the BEFORE / AFTER pair for the focused paragraph.
 *
 * Renders the segments produced by `computeIntraBlockDiff`, filtering to
 * the segments that belong on this side:
 *   - "before" side: keeps `equal` + `delete` segments (deletes shown
 *      with brick strikethrough).
 *   - "after"  side: keeps `equal` + `insert` segments (inserts shown
 *      with rust underline).
 *
 * If `segments` is null we fell back to displaying the full plain text
 * without intra-block highlights — used for ADDED, REMOVED, or oversized
 * CHANGED entries.
 */
export interface DiffSubColumnProps {
  side: "before" | "after";
  /** Snapshot label, e.g. "v8 · 1:48 PM" — rendered as the column header. */
  versionLabel: string;
  /** Per-segment diff (null for non-CHANGED entries). */
  segments: DiffSegment[] | null;
  /** Plain fallback text (used when segments is null). */
  fallbackText: string;
  /** Show "(content removed)" / "(content added)" placeholder when fallback is empty. */
  emptyLabel?: string;
}

export function DiffSubColumn({
  side,
  versionLabel,
  segments,
  fallbackText,
  emptyLabel,
}: DiffSubColumnProps): React.ReactElement {
  return (
    <section
      className="flex-1"
      data-testid={`diff-viewer-pane-${side}`}
      aria-label={`${side === "before" ? "Before" : "After"} ${versionLabel}`}
    >
      <header className="text-label-caps text-text-secondary mb-3">
        {side === "before" ? "BEFORE " : "AFTER "}
        {versionLabel}
      </header>
      <p className="font-display text-text-primary text-[16px] leading-7">
        {segments ? renderSegments(segments, side) : renderFallback(fallbackText, emptyLabel)}
      </p>
    </section>
  );
}

function renderSegments(segments: DiffSegment[], side: "before" | "after"): React.ReactNode {
  return segments.map((seg, idx) => {
    if (seg.op === "equal") {
      return <span key={idx}>{seg.text}</span>;
    }
    if (seg.op === "delete" && side === "before") {
      return (
        <span
          key={idx}
          data-testid="diff-viewer-removed-marker"
          className="text-error line-through decoration-1"
        >
          {seg.text}
        </span>
      );
    }
    if (seg.op === "insert" && side === "after") {
      return (
        <span
          key={idx}
          data-testid="diff-viewer-added-marker"
          className="text-accent decoration-accent underline decoration-1 underline-offset-2"
        >
          {seg.text}
        </span>
      );
    }
    // delete on after-side or insert on before-side: this segment doesn't
    // belong here, skip it.
    return null;
  });
}

function renderFallback(text: string, emptyLabel?: string): React.ReactNode {
  if (text.trim().length > 0) return text;
  return <span className="text-text-tertiary italic">{emptyLabel ?? "(empty paragraph)"}</span>;
}
