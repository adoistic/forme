import React from "react";

/**
 * Restore confirmation dialog for `<DiffViewer>`. Mounted as a tiny
 * inline modal — same shape as `DeleteConfirm` so it doesn't depend on
 * the Radix Dialog stack while the parent DiffViewer is already a Radix
 * Dialog.
 */
export interface RestoreConfirmProps {
  /** Version label shown in the prompt — e.g. "v8". */
  versionLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RestoreConfirm({
  versionLabel,
  onCancel,
  onConfirm,
}: RestoreConfirmProps): React.ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diff-viewer-restore-title"
      data-testid="diff-viewer-restore-confirm"
      className="bg-bg-overlay fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-bg-surface w-[400px] rounded-xl p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="diff-viewer-restore-title"
          className="font-display text-display-md text-text-primary mb-2"
        >
          Restore version {versionLabel}?
        </h3>
        <p className="text-body text-text-secondary mb-6">
          This will replace the current body. The current draft is auto-saved as a new
          version first, so you can come back.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-text-primary hover:bg-black/[0.04] text-title-sm rounded-md px-4 py-2 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="diff-viewer-restore-confirm-button"
            onClick={onConfirm}
            className="bg-accent text-text-inverse hover:bg-accent-hover text-title-sm rounded-md px-4 py-2 font-semibold"
          >
            Restore {versionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
