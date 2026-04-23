import React from "react";
import { Star } from "@phosphor-icons/react";

/**
 * Floating callout card shown when an operator hovers (or focuses) a
 * `<VersionRow>`. Approved as part of design-shotgun variant A
 * (`scrub-timeline-detail-20260422`): a small white pill that sits 8px
 * to the right of the hovered row showing
 *   `v[N] · [timestamp] · ★ [label]`
 *
 * Word delta (`+47 words`) from the variant-A mockup is intentionally
 * deferred — surfacing it requires either a new snapshots column or a
 * body fetch per row, and CEO plan ER2 prefers we avoid migrations we
 * can defer at this point in v0.6. T8 commit message notes this.
 *
 * Purely visual — no behavior beyond rendering. Positioning is the
 * caller's responsibility (see `<VersionRow>`), so the same component
 * can be reused once we wire it into the keyboard-focus path too.
 */
export interface HoverCalloutProps {
  /** 1-indexed from oldest. v1 = first snapshot, vN = newest. */
  versionNumber: number;
  /** ISO timestamp of the snapshot. */
  timestamp: string;
  /** Operator's label, or `null` for an auto-saved version. */
  label: string | null;
  starred: boolean;
}

/** Format an ISO timestamp into the compact form used inside the callout. */
function formatCalloutTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function HoverCallout({
  versionNumber,
  timestamp,
  label,
  starred,
}: HoverCalloutProps): React.ReactElement {
  const formattedTime = formatCalloutTimestamp(timestamp);
  const showStarSegment = starred || (label !== null && label.length > 0);

  return (
    <div
      role="tooltip"
      data-testid="article-history-hover-callout"
      className={[
        // Position is set by the caller — this component is purely visual.
        "pointer-events-none absolute top-1/2 left-full z-20 ml-2 -translate-y-1/2",
        "max-w-[240px] whitespace-nowrap",
        "rounded-md bg-white px-2 py-2 shadow-md",
        "text-text-primary text-[11px] leading-tight",
        // Quick fade — global prefers-reduced-motion rule (globals.css)
        // already collapses this to ~0ms; the explicit motion-reduce
        // class is belt-and-braces in case a future change loosens that.
        "duration-fast transition-opacity motion-reduce:transition-none",
      ].join(" ")}
    >
      <span className="font-medium">v{versionNumber}</span>
      <span className="text-text-tertiary mx-1">·</span>
      <span>{formattedTime}</span>
      {showStarSegment && (
        <>
          <span className="text-text-tertiary mx-1">·</span>
          {starred && (
            <Star
              size={11}
              weight="fill"
              className="text-accent -mt-0.5 mr-1 inline-block align-middle"
              data-testid="article-history-hover-callout-star"
            />
          )}
          {label && label.length > 0 && <span>{label}</span>}
        </>
      )}
    </div>
  );
}
