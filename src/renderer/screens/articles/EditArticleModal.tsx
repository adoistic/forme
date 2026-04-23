import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../../components/Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import { ArticleBodyEditor } from "../../components/article-body-editor/ArticleBodyEditor.js";
import { ArticleHistoryPanel } from "../../components/article-history-panel/ArticleHistoryPanel.js";
import { DiffViewer } from "../../components/diff-viewer/DiffViewer.js";
import { RestoreUnsavedDialog } from "../../components/restore-unsaved-dialog/RestoreUnsavedDialog.js";
import type { BodyFormat } from "../../components/article-body-editor/ArticleBodyEditor.js";
import type { ArticleSummary } from "@shared/ipc-contracts/channels.js";
import type { BylinePosition, HeroPlacement, ContentType } from "@shared/schemas/article.js";

interface Props {
  article: ArticleSummary;
  onClose: () => void;
  onSaved: (updated: ArticleSummary) => void;
  onDeleted: (id: string) => void;
}

const CONTENT_TYPES: ContentType[] = [
  "Article",
  "Photo Essay",
  "Interview",
  "Opinion",
  "Brief",
  "Letter",
  "Poem",
];

const HERO_PLACEMENT_OPTIONS: { value: HeroPlacement; label: string; hint: string }[] = [
  {
    value: "below-headline",
    label: "Below headline",
    hint: "Standard feature — image after byline.",
  },
  {
    value: "above-headline",
    label: "Above headline",
    hint: "Image-led — hero on top, headline beneath.",
  },
  {
    value: "full-bleed",
    label: "Full bleed",
    hint: "Image fills the page edge-to-edge; headline overlays.",
  },
];

/**
 * Width below which we collapse the modal to 2-pane (editor + history),
 * hiding the right-side print preview rail. Per ER2-5 fix from codex.
 */
const TWO_PANE_BREAKPOINT_PX = 1000;

/**
 * Article editor modal — 3-pane layout (T10 / v0.6).
 *
 *   200px  ArticleHistoryPanel    (left rail)
 *   flex-1 ArticleBodyEditor       (center editor, ~516px at default width)
 *   280px  Print preview pane      (right rail; collapses below 1000px)
 *
 * Loads the article via `article:open-for-edit` so the lazy v0.5→v0.6
 * BlockNote migration runs (T5). Save / Delete / Restore / Compare flows
 * route through their respective IPC handlers + a fresh snapshot list
 * fetch on mutation.
 *
 * Article meta fields (deck, byline, hero, section, etc.) collapse into
 * an "Article details" disclosure below the editor so the body remains
 * the focal surface.
 */
export function EditArticleModal({
  article,
  onClose,
  onSaved,
  onDeleted,
}: Props): React.ReactElement {
  const toast = useToast();

  // ---- Article load via open-for-edit (triggers BlockNote migration) ---
  const [loaded, setLoaded] = useState<ArticleSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke("article:open-for-edit", { id: article.id })
      .then((opened) => {
        if (cancelled) return;
        setLoaded(opened);
        if (opened.migrationWarning) {
          toast.push("info", opened.migrationWarning);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
    // toast is referentially stable from context.
  }, [article.id, toast]);

  if (loadError) {
    return (
      <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="bg-bg-overlay fixed inset-0 z-40" />
          <Dialog.Content className="bg-bg-surface fixed inset-x-1/2 top-1/2 z-40 w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 shadow-lg">
            <Dialog.Title className="font-display text-display-md text-text-primary mb-2">
              Couldn't open this article.
            </Dialog.Title>
            <p className="text-body text-text-secondary mb-6">{loadError}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="bg-accent text-text-inverse hover:bg-accent-hover text-title-sm rounded-md px-4 py-2 font-semibold"
              >
                Close
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (!loaded) {
    // Tiny loading shell — matches modal Z-index so the underlying
    // articles list doesn't paint through.
    return (
      <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="bg-bg-overlay fixed inset-0 z-40" />
          <Dialog.Content
            className="bg-bg-surface fixed inset-x-1/2 top-1/2 z-40 w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 text-center shadow-lg"
            data-testid="edit-article-modal-loading"
          >
            <Dialog.Title className="text-text-secondary text-body">
              Opening article…
            </Dialog.Title>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return <EditArticleModalReady article={loaded} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />;
}

// ---- Inner ready component: drives state once article is loaded ----------

interface ReadyProps {
  article: ArticleSummary;
  onClose: () => void;
  onSaved: (updated: ArticleSummary) => void;
  onDeleted: (id: string) => void;
}

interface SnapshotPreview {
  body: string;
  bodyFormat: BodyFormat;
  createdAt: string | null;
  label: string | null;
}

function EditArticleModalReady({
  article,
  onClose,
  onSaved,
  onDeleted,
}: ReadyProps): React.ReactElement {
  const toast = useToast();

  // ---- Body editor state --------------------------------------------------
  const [body, setBody] = useState<string>(article.body);
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>(article.bodyFormat);
  const [dirty, setDirty] = useState(false);

  // ---- Article meta state (collapsible "details") -------------------------
  const [headline, setHeadline] = useState(article.headline);
  const [deck, setDeck] = useState(article.deck ?? "");
  const [byline, setByline] = useState(article.byline ?? "");
  const [bylinePosition, setBylinePosition] = useState<BylinePosition>(article.bylinePosition);
  const [contentType, setContentType] = useState<ContentType>(article.contentType);
  const [heroPlacement, setHeroPlacement] = useState<HeroPlacement>(article.heroPlacement);
  const [heroCaption, setHeroCaption] = useState(article.heroCaption ?? "");
  const [heroCredit, setHeroCredit] = useState(article.heroCredit ?? "");
  const [section, setSection] = useState(article.section ?? "");
  const [detailsOpen, setDetailsOpen] = useState(false);

  // ---- History panel state -----------------------------------------------
  // null = current draft; string = a specific snapshot id.
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotPreview | null>(null);
  // Bumped after a successful save / restore so the panel re-mounts and
  // re-fetches its snapshot list. Cheaper than threading an imperative
  // refresh handle through the panel.
  const [historyVersion, setHistoryVersion] = useState(0);

  // ---- DiffViewer overlay -------------------------------------------------
  const [diffOpen, setDiffOpen] = useState(false);

  // ---- Confirm dialogs ----------------------------------------------------
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);

  // ---- Busy flags ---------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // ---- Save status caption ("Saved 2m ago" / "Unsaved changes") -----------
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savedCaption, setSavedCaption] = useState<string | null>(null);

  useEffect(() => {
    if (!savedAt) {
      setSavedCaption(null);
      return;
    }
    function tick(): void {
      if (!savedAt) return;
      const sec = Math.max(0, Math.floor((Date.now() - savedAt.getTime()) / 1000));
      if (sec < 60) setSavedCaption(`Saved ${sec}s ago`);
      else setSavedCaption(`Saved ${Math.floor(sec / 60)}m ago`);
    }
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [savedAt]);

  // ---- ResizeObserver: collapse right pane below 1000px ------------------
  // Callback ref + a tracking ref for the live observer. Using useEffect
  // with useRef misses the attach moment for Radix's Dialog.Content
  // because the portal mounts after the parent commits, so the ref is
  // still null when the effect runs.
  const [showRightPane, setShowRightPane] = useState(true);
  const observerRef = useRef<ResizeObserver | null>(null);
  const setContentRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setShowRightPane(w >= TWO_PANE_BREAKPOINT_PX);
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  // ---- Snapshot preview fetch when selection changes ----------------------
  useEffect(() => {
    if (selectedSnapshotId === null) {
      setSnapshotPreview(null);
      return;
    }
    let cancelled = false;
    invoke("snapshot:read", { snapshotId: selectedSnapshotId })
      .then((b) => {
        if (cancelled) return;
        // The snapshot store records BlockNote JSON for v0.6 articles;
        // older rows may carry plain text. Fall through as "blocks" by
        // default and let ArticleBodyEditor's deserializer handle the
        // mismatch (it returns [] on parse failure).
        setSnapshotPreview({
          body: b.body,
          bodyFormat: "blocks",
          createdAt: b.createdAt,
          label: b.label,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.push("error", describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSnapshotId, toast]);

  // ---- Save flow ----------------------------------------------------------
  const handleBodyChange = useCallback((nextBody: string, nextFormat: BodyFormat) => {
    setBody(nextBody);
    setBodyFormat(nextFormat);
    setDirty(true);
  }, []);

  function markMetaDirty(setter: (v: string) => void): (v: string) => void {
    return (v: string) => {
      setter(v);
      setDirty(true);
    };
  }

  async function handleSave(): Promise<void> {
    if (!headline.trim()) {
      toast.push("error", "A headline is required.");
      return;
    }
    setSaving(true);
    try {
      const updated = await invoke("article:update", {
        id: article.id,
        headline: headline.trim(),
        deck: deck.trim() || null,
        byline: byline.trim() || null,
        bylinePosition,
        contentType,
        heroPlacement,
        heroCaption: heroCaption.trim() || null,
        heroCredit: heroCredit.trim() || null,
        section: section.trim() || null,
        body,
        bodyFormat,
      });
      setDirty(false);
      setSavedAt(new Date());
      // Re-fetch snapshot list — a save always writes a snapshot
      // (CEO plan §2A) so the panel must update.
      setHistoryVersion((v) => v + 1);
      onSaved(updated);
      toast.push("success", "Saved");
      if (updated.snapshotWarning) {
        toast.push("info", updated.snapshotWarning);
      }
    } catch (err) {
      toast.push("error", describeError(err));
    } finally {
      setSaving(false);
    }
  }

  // ---- Delete flow --------------------------------------------------------
  async function handleConfirmDelete(): Promise<void> {
    setDeleting(true);
    try {
      await invoke("article:delete", { id: article.id });
      setConfirmDelete(false);
      onDeleted(article.id);
      onClose();
    } catch (err) {
      toast.push("error", describeError(err));
      setDeleting(false);
    }
  }

  // ---- Restore flow -------------------------------------------------------
  /**
   * Core restore step — calls snapshot:restore and folds the result back
   * into the editor. Shared by the simple "clean restore" confirm and
   * both paths of the unsaved-edits 3-option dialog (CEO plan G3).
   * Throws on IPC failure so the caller can surface it.
   */
  async function performRestore(snapshotId: string): Promise<void> {
    const restored = await invoke("snapshot:restore", { snapshotId });
    // Replace the editor body with the restored values. ArticleBodyEditor
    // is keyed by `restoreToken` below so it re-mounts and picks up
    // the new initialContent.
    setBody(restored.body);
    setBodyFormat(restored.bodyFormat);
    setDirty(false);
    setSavedAt(new Date());
    setSelectedSnapshotId(null);
    setHistoryVersion((v) => v + 1);
  }

  async function handleConfirmRestore(): Promise<void> {
    if (!restoreConfirmId) return;
    setRestoring(true);
    try {
      await performRestore(restoreConfirmId);
      setRestoreConfirmId(null);
      // Sync meta in case the restored snapshot belongs to a version with
      // different defaults — though the snapshot store only carries body.
      // Safe to leave meta alone; operator can save again to commit.
      toast.push("success", "Restored");
    } catch (err) {
      toast.push("error", describeError(err));
    } finally {
      setRestoring(false);
    }
  }

  /**
   * G3 path — operator has unsaved edits and chose "Save current draft
   * first, then restore." Writes a snapshot of the current draft (per
   * CEO 1C, save always snapshots) before pulling the older version
   * back in. Failure of either step surfaces a toast and leaves the
   * dialog open so the operator can retry or pick another option.
   */
  async function handleSaveThenRestore(snapshotId: string): Promise<void> {
    if (!headline.trim()) {
      toast.push("error", "A headline is required.");
      throw new Error("missing headline");
    }
    try {
      const updated = await invoke("article:update", {
        id: article.id,
        headline: headline.trim(),
        deck: deck.trim() || null,
        byline: byline.trim() || null,
        bylinePosition,
        contentType,
        heroPlacement,
        heroCaption: heroCaption.trim() || null,
        heroCredit: heroCredit.trim() || null,
        section: section.trim() || null,
        body,
        bodyFormat,
      });
      onSaved(updated);
      if (updated.snapshotWarning) {
        toast.push("info", updated.snapshotWarning);
      }
      await performRestore(snapshotId);
      setRestoreConfirmId(null);
      toast.push("success", "Restored");
    } catch (err) {
      toast.push("error", describeError(err));
      throw err;
    }
  }

  /**
   * G3 path — operator chose "Discard current draft and restore."
   * Skips the save and goes straight to snapshot:restore.
   */
  async function handleDiscardThenRestore(snapshotId: string): Promise<void> {
    try {
      await performRestore(snapshotId);
      setRestoreConfirmId(null);
      toast.push("success", "Restored");
    } catch (err) {
      toast.push("error", describeError(err));
      throw err;
    }
  }

  // ---- Diff overlay open/close -------------------------------------------
  function openDiff(): void {
    if (!selectedSnapshotId) return;
    // ER2-7: pre-close any Tiptap floating UI before the diff overlay
    // mounts. ArticleBodyEditor doesn't expose a focus handle yet, so we
    // blur the active element as a best-effort dismissal — the floating
    // surfaces (link popovers, slash menu) close when the editor loses
    // focus. The diff overlay's own Z-index keeps the visuals correct.
    // TODO(T20): expose an explicit `editor.commands.blur()` from
    // ArticleBodyEditor via ref and call it here for full belt-and-braces.
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setDiffOpen(true);
  }

  function handleDiffRestore(snapshotId: string): void {
    setDiffOpen(false);
    setRestoreConfirmId(snapshotId);
  }

  // ---- Header byline + timestamp string ----------------------------------
  const headerCaption = useMemo(() => {
    const parts: string[] = [];
    if (article.byline) parts.push(article.byline);
    parts.push(new Date(article.createdAt).toLocaleDateString());
    return parts.join(" · ");
  }, [article.byline, article.createdAt]);

  // Right-preview content. `null` means: render the current draft.
  const previewBody = snapshotPreview ? snapshotPreview.body : body;
  const previewFormat = snapshotPreview ? snapshotPreview.bodyFormat : bodyFormat;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-bg-overlay fixed inset-0 z-40" />
        <Dialog.Content
          ref={setContentRef}
          className="bg-bg-surface fixed inset-x-1/2 top-1/2 z-40 flex h-[94vh] max-h-[94vh] w-[1080px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl shadow-lg focus:outline-none"
          data-testid="edit-article-modal"
          aria-describedby={undefined}
        >
          {/* Header */}
          <header className="border-border-default flex shrink-0 items-start justify-between gap-6 border-b px-8 py-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title asChild>
                <h2
                  className="font-display text-text-primary truncate text-[28px] leading-tight font-bold"
                  data-testid="edit-article-headline-display"
                >
                  {headline || "Untitled article"}
                </h2>
              </Dialog.Title>
              <p
                className="text-text-tertiary mt-1 font-sans text-[12px]"
                data-testid="edit-article-header-caption"
              >
                {headerCaption}
                {savedCaption ? <span className="ml-2 italic">· {savedCaption}</span> : null}
                {dirty ? (
                  <span className="text-warning ml-2 font-semibold" data-testid="edit-article-dirty-indicator">
                    · Unsaved changes
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
                className="text-error border-error hover:bg-error-bg text-title-sm rounded-md border-[1.5px] bg-transparent px-4 py-2 font-semibold disabled:opacity-40"
                data-testid="edit-article-delete"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="text-text-secondary hover:bg-black/[0.04] text-title-sm rounded-md px-4 py-2 disabled:opacity-40"
                data-testid="edit-article-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                className="bg-accent text-text-inverse hover:bg-accent-hover text-title-sm rounded-md px-5 py-2 font-semibold disabled:opacity-40"
                data-testid="edit-article-submit"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </header>

          {/* 3-pane body */}
          <div className="flex flex-1 overflow-hidden">
            {/* LEFT: history panel (200px) */}
            <ArticleHistoryPanel
              key={`history-${historyVersion}`}
              articleId={article.id}
              selectedSnapshotId={selectedSnapshotId}
              onSelect={setSelectedSnapshotId}
              onRestore={(id) => setRestoreConfirmId(id)}
            />

            {/* CENTER: body editor (flex-1) */}
            <div
              className="flex min-w-0 flex-1 flex-col overflow-hidden"
              data-testid="edit-article-center"
            >
              <div className="flex-1 overflow-hidden">
                <ArticleBodyEditor
                  value={body}
                  bodyFormat={bodyFormat}
                  onChange={handleBodyChange}
                  language={article.language === "bilingual" ? "bilingual" : article.language}
                />
              </div>
              <ArticleDetailsSection
                open={detailsOpen}
                onToggle={() => setDetailsOpen((o) => !o)}
                headline={headline}
                onHeadlineChange={markMetaDirty(setHeadline)}
                deck={deck}
                onDeckChange={markMetaDirty(setDeck)}
                byline={byline}
                onBylineChange={markMetaDirty(setByline)}
                bylinePosition={bylinePosition}
                onBylinePositionChange={(p) => {
                  setBylinePosition(p);
                  setDirty(true);
                }}
                contentType={contentType}
                onContentTypeChange={(c) => {
                  setContentType(c);
                  setDirty(true);
                }}
                section={section}
                onSectionChange={markMetaDirty(setSection)}
                heroPlacement={heroPlacement}
                onHeroPlacementChange={(p) => {
                  setHeroPlacement(p);
                  setDirty(true);
                }}
                heroCaption={heroCaption}
                onHeroCaptionChange={markMetaDirty(setHeroCaption)}
                heroCredit={heroCredit}
                onHeroCreditChange={markMetaDirty(setHeroCredit)}
              />
            </div>

            {/* RIGHT: print preview pane (280px) — collapses below 1000px */}
            {showRightPane ? (
              <PrintPreviewPane
                body={previewBody}
                bodyFormat={previewFormat}
                snapshotLabel={snapshotPreview?.label ?? null}
                snapshotCreatedAt={snapshotPreview?.createdAt ?? null}
                isCurrent={selectedSnapshotId === null}
                onCompare={openDiff}
                canCompare={selectedSnapshotId !== null}
              />
            ) : null}
          </div>

          {/* Footer status caption */}
          <footer
            className="border-border-default text-caption text-text-tertiary flex shrink-0 items-center justify-between border-t px-8 py-2"
            data-testid="edit-article-footer"
          >
            <span>
              {dirty ? "Unsaved changes" : savedCaption ?? "All changes saved"}
            </span>
            <span className="italic">⌘S to save · ESC to close</span>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>

      {/* Compare overlay — modal-on-modal Radix Dialog (ER2-2) */}
      {diffOpen && selectedSnapshotId ? (
        <DiffViewer
          articleId={article.id}
          beforeSnapshotId={selectedSnapshotId}
          afterSnapshotId={null}
          open={diffOpen}
          onClose={() => setDiffOpen(false)}
          onRestore={handleDiffRestore}
          beforeVersionLabel={snapshotPreview?.label ?? "selected"}
          afterVersionLabel="current"
        />
      ) : null}

      {/* Delete confirm dialog — copy depends on dirty state */}
      {confirmDelete ? (
        <ConfirmDialog
          testid="edit-article-delete-confirm"
          title="Delete this article?"
          body={
            dirty
              ? "This article is open in the editor. Deleting will close the editor and discard any unsaved edits."
              : "This will delete the article and all of its history. Permanent."
          }
          confirmLabel={deleting ? "Deleting…" : "Delete article"}
          confirmVariant="danger"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void handleConfirmDelete()}
          confirming={deleting}
        />
      ) : null}

      {/* Restore confirm dialogs.
        * - Clean editor: simple "Restore version from <timestamp>?" confirm.
        * - Dirty editor: 3-option dialog (CEO plan G3) — Save first, Discard,
        *   Cancel. Both paths route through their respective handlers and
        *   close on success. */}
      {restoreConfirmId && !dirty ? (
        <ConfirmDialog
          testid="edit-article-restore-confirm"
          title="Restore this version?"
          body={`Restore version from ${formatRestoreTimestamp(snapshotPreview?.createdAt)}?`}
          confirmLabel={restoring ? "Restoring…" : "Restore version"}
          confirmVariant="primary"
          onCancel={() => setRestoreConfirmId(null)}
          onConfirm={() => void handleConfirmRestore()}
          confirming={restoring}
        />
      ) : null}
      {restoreConfirmId && dirty ? (
        <RestoreUnsavedDialog
          open
          snapshotTimestamp={formatRestoreTimestamp(snapshotPreview?.createdAt)}
          onSaveFirst={() => handleSaveThenRestore(restoreConfirmId)}
          onDiscard={() => handleDiscardThenRestore(restoreConfirmId)}
          onCancel={() => setRestoreConfirmId(null)}
        />
      ) : null}
    </Dialog.Root>
  );
}

// ---- Right preview pane --------------------------------------------------

interface PrintPreviewPaneProps {
  body: string;
  bodyFormat: BodyFormat;
  snapshotLabel: string | null;
  snapshotCreatedAt: string | null;
  isCurrent: boolean;
  canCompare: boolean;
  onCompare: () => void;
}

function PrintPreviewPane({
  body,
  bodyFormat,
  snapshotLabel,
  snapshotCreatedAt,
  isCurrent,
  canCompare,
  onCompare,
}: PrintPreviewPaneProps): React.ReactElement {
  const text = useMemo(() => extractPlainText(body, bodyFormat), [body, bodyFormat]);
  return (
    <aside
      className="bg-bg-canvas border-border-default flex w-[280px] shrink-0 flex-col border-l"
      data-testid="edit-article-preview"
      aria-label="Print preview"
    >
      <div className="border-border-default flex items-baseline justify-between border-b px-4 pt-4 pb-2">
        <span className="text-label-caps text-text-secondary">PREVIEW</span>
        <span className="text-caption text-text-tertiary">
          {isCurrent ? "current draft" : snapshotLabel ?? formatPreviewTimestamp(snapshotCreatedAt)}
        </span>
      </div>
      <div
        className="font-display text-text-primary flex-1 overflow-y-auto px-4 py-4 text-[14px] leading-[22px]"
        data-testid="edit-article-preview-body"
      >
        {text.length === 0 ? (
          <p className="text-text-tertiary italic">Empty.</p>
        ) : (
          text.map((para, i) => (
            <p key={i} className="mb-3">
              {para}
            </p>
          ))
        )}
      </div>
      {!isCurrent ? (
        <div className="border-border-default border-t p-3">
          <button
            type="button"
            onClick={onCompare}
            disabled={!canCompare}
            className="text-accent border-accent hover:bg-accent-bg text-title-sm w-full rounded-md border-[1.5px] bg-transparent px-3 py-2 font-semibold transition-colors disabled:opacity-40"
            data-testid="edit-article-compare"
          >
            Compare to current
          </button>
        </div>
      ) : null}
    </aside>
  );
}

// ---- Article details collapsible (deck / byline / hero / etc.) ----------

interface ArticleDetailsSectionProps {
  open: boolean;
  onToggle: () => void;
  headline: string;
  onHeadlineChange: (v: string) => void;
  deck: string;
  onDeckChange: (v: string) => void;
  byline: string;
  onBylineChange: (v: string) => void;
  bylinePosition: BylinePosition;
  onBylinePositionChange: (v: BylinePosition) => void;
  contentType: ContentType;
  onContentTypeChange: (v: ContentType) => void;
  section: string;
  onSectionChange: (v: string) => void;
  heroPlacement: HeroPlacement;
  onHeroPlacementChange: (v: HeroPlacement) => void;
  heroCaption: string;
  onHeroCaptionChange: (v: string) => void;
  heroCredit: string;
  onHeroCreditChange: (v: string) => void;
}

function ArticleDetailsSection({
  open,
  onToggle,
  headline,
  onHeadlineChange,
  deck,
  onDeckChange,
  byline,
  onBylineChange,
  bylinePosition,
  onBylinePositionChange,
  contentType,
  onContentTypeChange,
  section,
  onSectionChange,
  heroPlacement,
  onHeroPlacementChange,
  heroCaption,
  onHeroCaptionChange,
  heroCredit,
  onHeroCreditChange,
}: ArticleDetailsSectionProps): React.ReactElement {
  return (
    <div className="border-border-default border-t" data-testid="edit-article-details">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-label-caps text-text-secondary hover:text-text-primary flex w-full items-center justify-between px-8 py-3"
        data-testid="edit-article-details-toggle"
      >
        <span>ARTICLE DETAILS</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="bg-bg-canvas px-8 py-4">
          <label className="mb-3 block">
            <span className="text-label-caps text-text-secondary mb-1 block">Headline</span>
            <input
              type="text"
              value={headline}
              onChange={(e) => onHeadlineChange(e.target.value)}
              className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
              data-testid="edit-article-headline"
            />
          </label>
          <label className="mb-3 block">
            <span className="text-label-caps text-text-secondary mb-1 block">
              Deck <span className="text-text-tertiary ml-1 italic">optional subtitle</span>
            </span>
            <textarea
              value={deck}
              onChange={(e) => onDeckChange(e.target.value)}
              rows={2}
              className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
              data-testid="edit-article-deck"
            />
          </label>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-label-caps text-text-secondary mb-1 block">Byline</span>
              <input
                type="text"
                value={byline}
                onChange={(e) => onBylineChange(e.target.value)}
                className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
                data-testid="edit-article-byline"
              />
            </label>
            <label className="block">
              <span className="text-label-caps text-text-secondary mb-1 block">Section</span>
              <input
                type="text"
                value={section}
                onChange={(e) => onSectionChange(e.target.value)}
                className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
                data-testid="edit-article-section"
              />
            </label>
          </div>
          <div className="mb-3">
            <span className="text-label-caps text-text-secondary mb-1 block">Byline position</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Byline position">
              {(["top", "end"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  role="radio"
                  aria-checked={bylinePosition === pos}
                  onClick={() => onBylinePositionChange(pos)}
                  className={[
                    "text-title-sm flex-1 rounded-full px-4 py-1.5 transition-colors",
                    bylinePosition === pos
                      ? "bg-accent text-text-inverse"
                      : "text-text-secondary hover:bg-black/[0.04]",
                  ].join(" ")}
                  data-testid={`edit-article-byline-position-${pos}`}
                >
                  {pos === "top" ? "Top (under deck)" : "End (after body)"}
                </button>
              ))}
            </div>
          </div>
          <label className="mb-3 block">
            <span className="text-label-caps text-text-secondary mb-1 block">Content type</span>
            <select
              value={contentType}
              onChange={(e) => onContentTypeChange(e.target.value as ContentType)}
              className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
              data-testid="edit-article-content-type"
            >
              {CONTENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="border-border-default rounded-md border p-3">
            <legend className="text-label-caps text-text-secondary px-2">Hero image</legend>
            <div className="mb-3">
              <span className="text-label-caps text-text-secondary mb-1 block">Placement</span>
              <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Hero placement">
                {HERO_PLACEMENT_OPTIONS.map(({ value, label, hint }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={heroPlacement === value}
                    onClick={() => onHeroPlacementChange(value)}
                    title={hint}
                    className={[
                      "text-title-sm rounded-md border-[1.5px] px-2 py-2 transition-colors",
                      heroPlacement === value
                        ? "border-accent bg-accent-bg text-text-primary"
                        : "border-border-default text-text-secondary hover:border-border-strong",
                    ].join(" ")}
                    data-testid={`edit-article-hero-placement-${value}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-label-caps text-text-secondary mb-1 block">Caption</span>
                <input
                  type="text"
                  value={heroCaption}
                  onChange={(e) => onHeroCaptionChange(e.target.value)}
                  className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
                  data-testid="edit-article-hero-caption"
                />
              </label>
              <label className="block">
                <span className="text-label-caps text-text-secondary mb-1 block">
                  Photographer credit
                </span>
                <input
                  type="text"
                  value={heroCredit}
                  onChange={(e) => onHeroCreditChange(e.target.value)}
                  className="border-border-default bg-bg-surface text-body focus:border-accent w-full rounded-md border-[1.5px] px-3 py-2 focus:outline-none"
                  data-testid="edit-article-hero-credit"
                />
              </label>
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

// ---- Confirm dialog (Delete + Restore) ----------------------------------

interface ConfirmDialogProps {
  testid: string;
  title: string;
  body: string;
  confirmLabel: string;
  confirmVariant: "primary" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}

function ConfirmDialog({
  testid,
  title,
  body,
  confirmLabel,
  confirmVariant,
  onCancel,
  onConfirm,
  confirming,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={testid}
      className="bg-bg-overlay fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-bg-surface w-[420px] rounded-xl p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-display-md text-text-primary mb-2">{title}</h3>
        <p className="text-body text-text-secondary mb-6">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="text-text-primary hover:bg-black/[0.04] text-title-sm rounded-md px-4 py-2 font-semibold disabled:opacity-40"
            data-testid={`${testid}-cancel`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className={[
              "text-title-sm rounded-md px-4 py-2 font-semibold disabled:opacity-40",
              confirmVariant === "danger"
                ? "text-error border-error hover:bg-error-bg border-[1.5px] bg-transparent"
                : "bg-accent text-text-inverse hover:bg-accent-hover",
            ].join(" ")}
            data-testid={`${testid}-confirm`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Helpers -------------------------------------------------------------

/**
 * Render the body string as a list of paragraphs for the simple
 * print-preview rail. Handles all three storage formats.
 *
 *   - "blocks":  pull text from each block's content runs.
 *   - "markdown": split on blank lines, drop heading markers etc. for
 *                 a faithful-enough preview (it's a thumbnail, not the
 *                 final layout).
 *   - "plain":   split on blank lines.
 */
function extractPlainText(body: string, bodyFormat: BodyFormat): string[] {
  if (!body) return [];
  if (bodyFormat === "blocks") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((b) => extractBlockText(b))
        .filter((t) => t.length > 0);
    } catch {
      return [];
    }
  }
  // Markdown + plain — same paragraph split is good enough for a
  // serif read-only preview. Strip leading markdown markers so the
  // preview reads as prose, not source text.
  return body
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#+\s+/, "").replace(/^[-*]\s+/, "").trim())
    .filter((p) => p.length > 0);
}

function extractBlockText(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const content = (block as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      if (typeof c === "string") return c;
      if (typeof c === "object" && c !== null && "text" in c) {
        const t = (c as { text: unknown }).text;
        return typeof t === "string" ? t : "";
      }
      return "";
    })
    .join("");
}

function formatPreviewTimestamp(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatRestoreTimestamp(iso: string | null | undefined): string {
  if (!iso) return "this version";
  try {
    const d = new Date(iso);
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
