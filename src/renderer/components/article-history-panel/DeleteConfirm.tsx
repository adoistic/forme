import React from "react";

/**
 * Permanent-delete confirmation dialog for a snapshot row. Plain modal
 * so it doesn't depend on the Radix Dialog stack — the parent panel
 * owns whether it's mounted.
 */
export interface DeleteConfirmProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirm({ onCancel, onConfirm }: DeleteConfirmProps): React.ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="article-history-delete-title"
      data-testid="article-history-delete-confirm"
      className="bg-bg-overlay fixed inset-0 z-50 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-bg-surface w-[360px] rounded-xl p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="article-history-delete-title"
          className="font-display text-display-md text-text-primary mb-2"
        >
          Delete this version?
        </h3>
        <p className="text-body text-text-secondary mb-6">
          Permanent — this version will be gone forever.
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
            data-testid="article-history-delete-confirm-button"
            onClick={onConfirm}
            className="text-error border-error hover:bg-error-bg text-title-sm rounded-md border-[1.5px] bg-transparent px-4 py-2 font-semibold"
          >
            Delete version
          </button>
        </div>
      </div>
    </div>
  );
}
