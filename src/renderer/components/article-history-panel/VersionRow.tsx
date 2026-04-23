import React, { useState } from "react";
import { Star, DotsThree } from "@phosphor-icons/react";
import type { ArticleSnapshotSummary } from "@shared/ipc-contracts/channels.js";
import { formatRowTime } from "./bucket.js";
import { HoverCallout } from "./HoverCallout.js";

/**
 * A single snapshot row in `<ArticleHistoryPanel>`. Displays timestamp +
 * label, with a star toggle and a three-dot action menu on the right.
 *
 * The label is editable inline — clicking it swaps in a small input that
 * commits on blur or Enter.
 */
export interface VersionRowProps {
  snap: ArticleSnapshotSummary;
  isSelected: boolean;
  isMenuOpen: boolean;
  isEditingLabel: boolean;
  now: Date;
  /** 1-indexed from oldest. v1 = first snapshot, vN = newest. */
  versionNumber: number;
  onClick: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onStar: () => void;
  onStartLabelEdit: () => void;
  onCommitLabel: (next: string) => void;
  onAskDelete: () => void;
}

export function VersionRow({
  snap,
  isSelected,
  isMenuOpen,
  isEditingLabel,
  now,
  versionNumber,
  onClick,
  onToggleMenu,
  onCloseMenu,
  onStar,
  onStartLabelEdit,
  onCommitLabel,
  onAskDelete,
}: VersionRowProps): React.ReactElement {
  // Hover and focus both reveal the floating callout. Tracking them as
  // separate flags lets either signal hold the callout open
  // independently — important so a focused row doesn't lose the callout
  // when the operator's mouse drifts away mid keyboard-navigation.
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const showCallout = isHovered || isFocused;

  const time = formatRowTime(snap.createdAt, now);
  const label = snap.label ?? "Auto-saved";

  return (
    <div
      data-testid={`article-history-row-${snap.id}`}
      className={[
        "group relative flex h-14 items-center gap-2 px-3",
        "hover:bg-bg-canvas transition-colors",
        isSelected ? "bg-bg-canvas border-accent border-l-2" : "border-l-2 border-transparent",
      ].join(" ")}
      role="button"
      tabIndex={-1}
      aria-pressed={isSelected}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onToggleMenu();
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary truncate">{time}</div>
        {isEditingLabel ? (
          <input
            type="text"
            defaultValue={snap.label ?? ""}
            autoFocus
            data-testid={`article-history-label-input-${snap.id}`}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onCommitLabel(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitLabel(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCommitLabel(snap.label ?? "");
              }
            }}
            className="text-caption text-text-secondary border-border-default w-full rounded-sm border bg-white px-1 py-0.5 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartLabelEdit();
            }}
            className="text-caption text-text-secondary hover:text-text-primary block max-w-full truncate text-left"
            title="Click to edit label"
          >
            {label}
          </button>
        )}
      </div>

      {/* Star toggle */}
      <button
        type="button"
        aria-label={snap.starred ? "Unstar version" : "Star version"}
        data-testid={`article-history-star-${snap.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onStar();
        }}
        className="text-text-tertiary hover:text-accent shrink-0 p-1"
      >
        <Star
          size={14}
          weight={snap.starred ? "fill" : "regular"}
          className={snap.starred ? "text-accent" : ""}
        />
      </button>

      {/* Three-dot menu */}
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="Version actions"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          data-testid={`article-history-menu-${snap.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu();
          }}
          className="text-text-tertiary hover:text-text-primary p-1"
        >
          <DotsThree size={16} weight="bold" />
        </button>
        {isMenuOpen && (
          <div
            role="menu"
            data-testid={`article-history-menu-popup-${snap.id}`}
            className="border-border-default absolute right-0 z-10 mt-1 min-w-[160px] rounded-md border bg-white py-1 shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCloseMenu();
                onAskDelete();
              }}
              className="text-body text-error hover:bg-error-bg block w-full px-3 py-1.5 text-left"
            >
              Delete this version
            </button>
          </div>
        )}
      </div>

      {/* Hover/focus callout — design-shotgun variant A polish detail.
          Positioned by the component itself; the parent row supplies the
          relative positioning context. */}
      {showCallout && (
        <HoverCallout
          versionNumber={versionNumber}
          timestamp={snap.createdAt}
          label={snap.label}
          starred={snap.starred}
        />
      )}
    </div>
  );
}
