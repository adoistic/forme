import React from "react";

/**
 * Empty / identical state messages for `<DiffViewer>` (T9).
 *
 * Rendered in place of the diff map + main pane when the two bodies
 * compare equal, or when one or both bodies are empty BlockNote arrays.
 * DESIGN.md §9: "identical bodies show 'Identical.' in display-md italic
 * charcoal-secondary, no diff highlights, no map markers".
 */
export interface IdenticalEmptyProps {
  variant: "identical" | "empty-before" | "empty-after" | "empty-both";
}

export function IdenticalEmpty({ variant }: IdenticalEmptyProps): React.ReactElement {
  const message = messageFor(variant);
  return (
    <div
      className="flex flex-1 items-center justify-center"
      data-testid={`diff-viewer-${variant}`}
    >
      <p className="font-display text-display-md text-text-secondary italic">{message}</p>
    </div>
  );
}

function messageFor(variant: IdenticalEmptyProps["variant"]): string {
  switch (variant) {
    case "identical":
      return "Identical.";
    case "empty-before":
      return "Empty version (before).";
    case "empty-after":
      return "Empty version (after).";
    case "empty-both":
      return "Both versions are empty.";
  }
}
