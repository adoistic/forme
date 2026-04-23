/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<RestoreUnsavedDialog>` (T20 / v0.6, CEO plan G3).
 *
 * The dialog shows three exclusive choices when the operator clicks
 * Restore on a snapshot AND the editor body is dirty: save-first,
 * discard, or cancel. The component owns its busy flag so it can keep
 * the operator from double-firing while the parent IPC round-trip is
 * in flight.
 */
import React from "react";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { RestoreUnsavedDialog } from "../../../src/renderer/components/restore-unsaved-dialog/RestoreUnsavedDialog.js";

afterEach(() => {
  cleanup();
});

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("<RestoreUnsavedDialog>", () => {
  test("renders three action buttons when open", () => {
    render(
      <RestoreUnsavedDialog
        open
        snapshotTimestamp="Apr 22, 12:00 PM"
        onSaveFirst={async () => {}}
        onDiscard={async () => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByTestId("restore-unsaved-dialog")).toBeTruthy();
    expect(screen.getByTestId("restore-unsaved-save-first")).toBeTruthy();
    expect(screen.getByTestId("restore-unsaved-discard")).toBeTruthy();
    expect(screen.getByTestId("restore-unsaved-cancel")).toBeTruthy();
  });

  test("renders nothing when open=false", () => {
    render(
      <RestoreUnsavedDialog
        open={false}
        snapshotTimestamp="Apr 22, 12:00 PM"
        onSaveFirst={async () => {}}
        onDiscard={async () => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByTestId("restore-unsaved-dialog")).toBeNull();
  });

  test("body copy mentions the supplied snapshot timestamp", () => {
    render(
      <RestoreUnsavedDialog
        open
        snapshotTimestamp="Apr 22, 12:00 PM"
        onSaveFirst={async () => {}}
        onDiscard={async () => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByTestId("restore-unsaved-dialog").textContent).toContain(
      "Apr 22, 12:00 PM"
    );
  });

  test('"Save first" calls onSaveFirst', async () => {
    const onSaveFirst = vi.fn().mockResolvedValue(undefined);
    render(
      <RestoreUnsavedDialog
        open
        snapshotTimestamp="Apr 22"
        onSaveFirst={onSaveFirst}
        onDiscard={async () => {}}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId("restore-unsaved-save-first"));
    await flushAsync();
    expect(onSaveFirst).toHaveBeenCalledTimes(1);
  });

  test('"Discard" calls onDiscard', async () => {
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    render(
      <RestoreUnsavedDialog
        open
        snapshotTimestamp="Apr 22"
        onSaveFirst={async () => {}}
        onDiscard={onDiscard}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId("restore-unsaved-discard"));
    await flushAsync();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  test('"Cancel" calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <RestoreUnsavedDialog
        open
        snapshotTimestamp="Apr 22"
        onSaveFirst={async () => {}}
        onDiscard={async () => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByTestId("restore-unsaved-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("clicking the overlay backdrop also calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <RestoreUnsavedDialog
        open
        snapshotTimestamp="Apr 22"
        onSaveFirst={async () => {}}
        onDiscard={async () => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByTestId("restore-unsaved-dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("while save-first is in flight, all buttons are disabled", async () => {
    let resolveSave: () => void = () => {};
    const onSaveFirst = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );
    render(
      <RestoreUnsavedDialog
        open
        snapshotTimestamp="Apr 22"
        onSaveFirst={onSaveFirst}
        onDiscard={async () => {}}
        onCancel={() => {}}
      />
    );

    const saveBtn = screen.getByTestId("restore-unsaved-save-first") as HTMLButtonElement;
    const discardBtn = screen.getByTestId("restore-unsaved-discard") as HTMLButtonElement;
    const cancelBtn = screen.getByTestId("restore-unsaved-cancel") as HTMLButtonElement;

    fireEvent.click(saveBtn);
    // Allow the state setter to flush so disabled flips to true.
    await flushAsync();

    expect(saveBtn.disabled).toBe(true);
    expect(discardBtn.disabled).toBe(true);
    expect(cancelBtn.disabled).toBe(true);
    expect(saveBtn.textContent).toContain("Saving and restoring");

    // Resolve the promise to clear busy.
    await act(async () => {
      resolveSave();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveBtn.disabled).toBe(false);
  });

  test("if onSaveFirst rejects, busy flag clears so the operator can retry", async () => {
    const onSaveFirst = vi.fn().mockRejectedValue(new Error("save failed"));
    render(
      <RestoreUnsavedDialog
        open
        snapshotTimestamp="Apr 22"
        onSaveFirst={onSaveFirst}
        onDiscard={async () => {}}
        onCancel={() => {}}
      />
    );
    const saveBtn = screen.getByTestId("restore-unsaved-save-first") as HTMLButtonElement;
    fireEvent.click(saveBtn);
    await flushAsync();
    expect(saveBtn.disabled).toBe(false);
  });
});
