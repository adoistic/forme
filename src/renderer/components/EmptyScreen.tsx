import React from "react";

interface EmptyScreenProps {
  label: string;
  headline: string;
  subline: string;
}

// Unified empty-state pattern per DESIGN.md §9 "Empty-state card".
// Used as placeholder for tabs until their full screen lands.
export function EmptyScreen({ label, headline, subline }: EmptyScreenProps): React.ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center p-12">
      <div className="max-w-[480px] text-center">
        <div className="text-label-caps text-accent mb-4">{label}</div>
        <h2 className="text-display-md font-display text-text-primary mb-3">{headline}</h2>
        <p className="text-body text-text-secondary">{subline}</p>
      </div>
    </div>
  );
}
