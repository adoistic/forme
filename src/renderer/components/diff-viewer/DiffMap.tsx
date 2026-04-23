import React from "react";
import type { DiffEntry, ChangeKind } from "./diff.js";

/**
 * 200px left-rail diff map for `<DiffViewer>`. Each row is a tinted bar
 * representing one paragraph in the diff sequence.
 *
 * Tints (DESIGN.md §9 DiffViewer overlay):
 *   - unchanged: cream  (--color-bg-canvas)
 *   - changed:   rust-muted (--color-accent-muted)
 *   - added:     rust + "+" marker
 *   - removed:   brick + "−" marker
 *
 * Click / Enter / Space jumps to that paragraph in the main pane.
 */
export interface DiffMapProps {
  entries: DiffEntry[];
  focusedIndex: number;
  onFocus: (index: number) => void;
}

export function DiffMap({ entries, focusedIndex, onFocus }: DiffMapProps): React.ReactElement {
  return (
    <nav
      className="bg-bg-surface border-border-default flex h-full w-[200px] shrink-0 flex-col border-r"
      aria-label="Diff map"
      data-testid="diff-viewer-map"
    >
      <div className="px-3 pt-4 pb-2">
        <span className="text-label-caps text-text-secondary">DIFF MAP</span>
      </div>
      <ol className="flex-1 overflow-y-auto" data-testid="diff-viewer-map-list">
        {entries.map((entry) => (
          <DiffMapRow
            key={`${entry.index}-${entry.kind}`}
            entry={entry}
            focused={entry.index === focusedIndex}
            onClick={() => onFocus(entry.index)}
          />
        ))}
      </ol>
    </nav>
  );
}

interface DiffMapRowProps {
  entry: DiffEntry;
  focused: boolean;
  onClick: () => void;
}

function DiffMapRow({ entry, focused, onClick }: DiffMapRowProps): React.ReactElement {
  const tint = tintFor(entry.kind);
  const marker = markerFor(entry.kind);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid={`diff-viewer-map-row-${entry.index}`}
        data-kind={entry.kind}
        aria-current={focused ? "true" : undefined}
        className={[
          "flex w-full items-center gap-1 px-2 py-[2px] text-left transition-colors",
          tint,
          focused ? "ring-accent ring-2 ring-inset" : "",
        ].join(" ")}
      >
        <span className="text-text-tertiary w-5 shrink-0 text-[10px] font-semibold tabular-nums">
          {entry.index + 1}
        </span>
        <span className="text-text-secondary flex-1 truncate text-[11px]">
          {labelFor(entry)}
        </span>
        {marker && (
          <span
            className="text-text-inverse w-3 shrink-0 text-center text-[11px] leading-none font-bold"
            data-testid={`diff-viewer-map-marker-${entry.index}`}
            aria-label={entry.kind}
          >
            {marker}
          </span>
        )}
      </button>
    </li>
  );
}

function tintFor(kind: ChangeKind): string {
  switch (kind) {
    case "unchanged":
      return "bg-bg-canvas hover:bg-border-default";
    case "changed":
      return "bg-accent-muted hover:bg-accent-muted/80";
    case "added":
      return "bg-accent hover:bg-accent-hover";
    case "removed":
      return "bg-error/80 hover:bg-error";
  }
}

function markerFor(kind: ChangeKind): string | null {
  if (kind === "added") return "+";
  if (kind === "removed") return "−";
  return null;
}

function labelFor(entry: DiffEntry): string {
  // Prefix with the change kind for readability when the preview text
  // alone is ambiguous (matches the variant-C mockup).
  if (entry.kind === "added") return `Added · ${entry.previewText || "—"}`;
  if (entry.kind === "removed") return `Removed · ${entry.previewText || "—"}`;
  if (entry.kind === "changed") return `Changed · ${entry.previewText || "—"}`;
  return entry.previewText || "—";
}
