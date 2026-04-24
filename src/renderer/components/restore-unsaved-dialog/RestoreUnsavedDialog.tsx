import React, { useState } from "react";

/**
 * Three-option dialog shown when the operator clicks Restore on a
 * snapshot AND the editor has unsaved changes (CEO plan G3).
 *
 * Operator picks one of:
 *   1. Save current draft first, then restore (primary, filled rust)
 *   2. Discard current draft and restore (secondary, outlined)
 *   3. Cancel (tertiary text)
 *
 * Mounted as a plain inline modal so it doesn't depend on the parent
 * Radix Dialog stack — matches the pattern of `ConfirmDialog` /
 * `RestoreConfirm` already used in EditArticleModal + DiffViewer.
 */
export interface RestoreUnsavedDialogProps {
  /** Whether the dialog is visible. Hides + unmounts when false. */
  open: boolean;
  /** Snapshot timestamp / label string for the body copy. */
  snapshotTimestamp: string;
  /** Save the current draft first, then restore. */
  onSaveFirst: () => Promise<void>;
  /** Restore without saving — discards current edits. */
  onDiscard: () => Promise<void>;
  /** Close without doing anything. */
  onCancel: () => void;
}

export function RestoreUnsavedDialog({
  open,
  snapshotTimestamp,
  onSaveFirst,
  onDiscard,
  onCancel,
}: RestoreUnsavedDialogProps): React.ReactElement | null {
  // Local busy flag so the operator can't double-fire either path while
  // the underlying save / restore IPC round-trip is in flight.
  const [busy, setBusy] = useState<"save" | "discard" | null>(null);

  if (!open) return null;

  async function handleSaveFirst(): Promise<void> {
    if (busy) return;
    setBusy("save");
    try {
      await onSaveFirst();
    } catch {
      // Parent surfaces the toast — we just clear busy so the operator
      // can retry from the same dialog.
    } finally {
      setBusy(null);
    }
  }

  async function handleDiscard(): Promise<void> {
    if (busy) return;
    setBusy("discard");
    try {
      await onDiscard();
    } catch {
      // Same as above — parent toasts; we just clear busy.
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-unsaved-title"
      data-testid="restore-unsaved-dialog"
      className="bg-bg-overlay fixed inset-0 z-[60] flex items-center justify-center"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-bg-surface w-[440px] rounded-xl p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="restore-unsaved-title"
          className="font-display text-display-md text-text-primary mb-2"
        >
          You have unsaved changes
        </h3>
        <p className="text-body text-text-secondary mb-6">
          Restoring the version from {snapshotTimestamp} will replace the editor body. Save your
          current draft as a new version first, or discard it and restore.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void handleSaveFirst()}
            disabled={busy !== null}
            className="bg-accent text-text-inverse hover:bg-accent-hover text-title-sm rounded-md px-4 py-2 font-semibold disabled:opacity-40"
            data-testid="restore-unsaved-save-first"
          >
            {busy === "save" ? "Saving and restoring…" : "Save current draft first, then restore"}
          </button>
          <button
            type="button"
            onClick={() => void handleDiscard()}
            disabled={busy !== null}
            className="text-accent border-accent hover:bg-accent-bg text-title-sm rounded-md border-[1.5px] bg-transparent px-4 py-2 font-semibold disabled:opacity-40"
            data-testid="restore-unsaved-discard"
          >
            {busy === "discard" ? "Restoring…" : "Discard current draft and restore"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy !== null}
            className="text-text-secondary text-title-sm rounded-md px-4 py-2 hover:bg-black/[0.04] disabled:opacity-40"
            data-testid="restore-unsaved-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
