import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "../../ipc/client.js";
import { useIssueStore, useShallow } from "../../stores/issue.js";
import { describeError } from "../../lib/error-helpers.js";
import {
  bucketForDate,
  BUCKET_ORDER,
  formatRowTime,
  type DateBucket,
} from "../../components/article-history-panel/bucket.js";
import type {
  IssueSnapshotSummary,
  IssueSnapshotPreview,
} from "@shared/ipc-contracts/channels.js";

/**
 * `<IssueHistoryTimeline>` — populates the History tab in Canvas
 * (T19 / v0.6). Two-pane layout from approved variant-B mockup
 * (designs/history-panel-20260421/approved.json):
 *
 *   - LEFT (400px): timeline of issue snapshots, grouped by date
 *     (TODAY / YESTERDAY / LAST WEEK / OLDER) with auto-generated
 *     `description` per CEO §17.2 ("Edited article: Modi visits
 *     Delhi", "Added 4 classifieds", etc.).
 *   - RIGHT (flex-1): preview of the selected snapshot — issue title
 *     at the top in display serif, then a summary of what was in the
 *     issue at that moment (article count, classified count, ad count,
 *     headlines).
 *
 * Restore is intentionally NOT wired here. Issue-level restore would
 * cascade across articles + classifieds + ads + placements; the v0.6
 * primary use case is article-level restore (T8/T9). When operators
 * need to recover an issue-state, they can read the preview and
 * reconstruct manually for now. Tracked in TODOS.md.
 */
export function IssueHistoryTimeline(): React.ReactElement {
  const currentIssue = useIssueStore(useShallow((s) => s.currentIssue));
  const [snapshots, setSnapshots] = useState<IssueSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<IssueSnapshotPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Stable "now" per fetch — same rationale as ArticleHistoryPanel.
  const now = useMemo(() => new Date(), [snapshots]);

  // Fetch the snapshot list whenever the active issue changes.
  useEffect(() => {
    if (!currentIssue) {
      setSnapshots([]);
      setSelectedId(null);
      setPreview(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke("issue-snapshot:list", { issueId: currentIssue.id })
      .then((rows) => {
        if (cancelled) return;
        setSnapshots(rows);
        setLoading(false);
        // Auto-select the newest snapshot so the preview pane has
        // something to show on first render. The list comes back
        // newest-first.
        if (rows[0]) setSelectedId(rows[0].id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentIssue]);

  // Fetch the preview when the selection changes.
  useEffect(() => {
    if (!selectedId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    invoke("issue-snapshot:read", { snapshotId: selectedId })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setPreviewLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewError(describeError(err));
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Group snapshots by date bucket — same pattern as ArticleHistoryPanel.
  const groups = useMemo<{ bucket: DateBucket; rows: IssueSnapshotSummary[] }[]>(() => {
    const byBucket = new Map<DateBucket, IssueSnapshotSummary[]>();
    for (const s of snapshots) {
      const b = bucketForDate(s.createdAt, now);
      const arr = byBucket.get(b) ?? [];
      arr.push(s);
      byBucket.set(b, arr);
    }
    return BUCKET_ORDER.flatMap((bucket) => {
      const rows = byBucket.get(bucket);
      return rows && rows.length > 0 ? [{ bucket, rows }] : [];
    });
  }, [snapshots, now]);

  if (!currentIssue) {
    return <NoIssueState />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border-default bg-bg-canvas/80 flex h-16 shrink-0 items-center justify-between border-b px-8">
        <div>
          <h1 className="font-display text-display-md text-text-primary">History</h1>
          <div className="text-caption text-text-tertiary">
            Every save writes a snapshot. Browse to see what changed.
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LEFT: timeline pane */}
        <aside
          className="bg-bg-surface border-border-default flex w-[400px] shrink-0 flex-col border-r"
          aria-label="Snapshot timeline"
          data-testid="issue-history-timeline"
        >
          <div className="border-border-default flex items-baseline justify-between border-b px-4 py-3">
            <span className="text-label-caps text-text-secondary">VERSIONS</span>
            <span className="text-caption text-text-tertiary">
              {snapshots.length} {snapshots.length === 1 ? "snapshot" : "snapshots"}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="issue-history-list">
            {loading && (
              <p className="text-caption text-text-tertiary px-4 py-4">Loading history…</p>
            )}
            {error && !loading && (
              <p className="text-caption text-error px-4 py-4" role="alert">
                {error}
              </p>
            )}
            {!loading && !error && snapshots.length === 0 && <EmptyTimeline />}
            {groups.map(({ bucket, rows }) => (
              <section key={bucket} aria-label={bucket}>
                <div className="px-4 pt-4 pb-1">
                  <span className="text-label-caps text-text-tertiary">{bucket}</span>
                </div>
                <ul>
                  {rows.map((row) => (
                    <TimelineRow
                      key={row.id}
                      snapshot={row}
                      now={now}
                      isSelected={row.id === selectedId}
                      onClick={() => setSelectedId(row.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </aside>

        {/* RIGHT: preview pane */}
        <section
          className="min-w-0 flex-1 overflow-y-auto p-8"
          aria-label="Snapshot preview"
          data-testid="issue-history-preview"
        >
          {!selectedId && !loading && snapshots.length > 0 && (
            <p className="text-text-tertiary font-display text-[16px] italic">
              Select a snapshot from the timeline to preview it.
            </p>
          )}
          {previewLoading && (
            <p className="text-caption text-text-tertiary">Loading preview…</p>
          )}
          {previewError && (
            <p className="text-caption text-error" role="alert">
              {previewError}
            </p>
          )}
          {preview && !previewLoading && !previewError && <PreviewPane preview={preview} />}
        </section>
      </div>
    </div>
  );
}

function TimelineRow({
  snapshot,
  now,
  isSelected,
  onClick,
}: {
  snapshot: IssueSnapshotSummary;
  now: Date;
  isSelected: boolean;
  onClick: () => void;
}): React.ReactElement {
  const time = formatRowTime(snapshot.createdAt, now);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid={`issue-history-row-${snapshot.id}`}
        aria-current={isSelected ? "true" : undefined}
        className={[
          "block w-full px-4 py-3 text-left transition-colors",
          // Selected: cream bg + rust left border per variant-B.
          isSelected
            ? "bg-accent-bg border-accent border-l-[3px] pl-[13px]"
            : "hover:bg-bg-canvas border-l-[3px] border-transparent pl-[13px]",
        ].join(" ")}
      >
        <div className="text-caption text-text-tertiary mb-0.5">{time}</div>
        <div className="text-body text-text-primary">{snapshot.description}</div>
      </button>
    </li>
  );
}

function PreviewPane({ preview }: { preview: IssueSnapshotPreview }): React.ReactElement {
  const created = new Date(preview.createdAt);
  const dateText = created.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeText = created.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const issueLabel =
    preview.issueNumber !== null
      ? `Issue ${preview.issueNumber}`
      : preview.title || "Untitled issue";

  return (
    <div className="mx-auto max-w-[760px]">
      <header className="mb-8">
        <h2
          className="font-display text-display-md text-text-primary mb-1"
          data-testid="issue-history-preview-title"
        >
          {issueLabel} at {timeText}, {dateText}
        </h2>
        <p className="text-caption text-text-tertiary">{preview.description}</p>
      </header>

      <dl className="border-border-default mb-8 grid grid-cols-3 gap-px border bg-border-default text-center">
        <Stat label="Articles" value={preview.articleCount} />
        <Stat label="Classifieds" value={preview.classifiedCount} />
        <Stat label="Ads" value={preview.adCount} />
      </dl>

      {preview.articleHeadlines.length > 0 ? (
        <section>
          <h3 className="text-label-caps text-text-secondary mb-3">Articles in this snapshot</h3>
          <ul className="divide-border-default divide-y" data-testid="issue-history-headlines">
            {preview.articleHeadlines.map((headline, i) => (
              <li
                key={`${headline}-${i}`}
                className="font-display text-title-md text-text-primary py-3"
              >
                {headline}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-text-tertiary font-display text-[14px] italic">
          No articles in this snapshot.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="bg-bg-surface px-4 py-6">
      <div className="font-display text-display-md text-text-primary">{value}</div>
      <div className="text-label-caps text-text-tertiary mt-1">{label}</div>
    </div>
  );
}

function EmptyTimeline(): React.ReactElement {
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-6 py-12 text-center"
      data-testid="issue-history-empty"
    >
      <div className="text-label-caps text-text-tertiary mb-3">NO HISTORY YET</div>
      <p className="font-display text-text-primary mb-2 text-[16px]">
        Snapshots show up here.
      </p>
      <p className="text-caption text-text-tertiary">
        Forme writes a snapshot every time the issue changes — drop an article, edit a classified,
        change a setting. Save once and the timeline begins.
      </p>
    </div>
  );
}

function NoIssueState(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-[480px] text-center">
        <div className="text-label-caps text-accent mb-4">NO ISSUE</div>
        <h2 className="font-display text-display-md text-text-primary mb-3">
          Pick an issue to see its history.
        </h2>
        <p className="text-body text-text-secondary">
          Switch to the Issue Board tab and select an issue, then come back here.
        </p>
      </div>
    </div>
  );
}
