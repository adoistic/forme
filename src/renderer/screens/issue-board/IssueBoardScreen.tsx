import React from "react";

// Phase 0 minimal Issue Board shell.
// Full spread-grid + auto-fit integration lands in Phase 2+.
export function IssueBoardScreen(): React.ReactElement {
  return (
    <>
      {/* Canvas header per Pass 1 IA fix — masthead + issue metadata + status */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-default bg-bg-canvas/80 px-8 app-region-drag">
        <div className="app-region-no-drag">
          <div className="text-label-caps text-text-tertiary">NO PUBLICATION YET · NO ISSUE</div>
        </div>
        <div className="app-region-no-drag flex items-center gap-4">
          <span className="text-caption text-text-tertiary" data-testid="autosave-indicator">
            Not saved yet
          </span>
          <button
            type="button"
            data-testid="check-my-issue-button"
            disabled
            className="rounded-md border border-accent px-4 py-1.5 text-title-sm text-accent opacity-40 disabled:cursor-default"
          >
            Check my issue
          </button>
        </div>
      </header>

      {/* Main content: empty-state CTA per empty-issue-board approved mockup */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-8">
        <div className="max-w-[480px] text-center">
          <div className="mb-4 text-label-caps text-accent">START</div>
          <h2 className="mb-3 font-display text-display-md text-text-primary">
            Let&apos;s set up your publication.
          </h2>
          <p className="mb-6 text-body text-text-secondary">
            First-run wizard lands in a later phase. For now, Forme is booting to verify the foundation
            is wired up correctly. Use the tabs on the left to see the empty-state layouts.
          </p>
          <div className="text-caption text-text-tertiary">Phase 0 · foundation · v0.0.1</div>
        </div>
      </div>
    </>
  );
}
