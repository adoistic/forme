import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../../components/Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import { formatBytes } from "../../components/storage-threshold-banner/StorageThresholdBanner.js";
import type { StorageOverview, ArticleStorageRow } from "@shared/ipc-contracts/channels.js";

// Settings → Storage panel (T12 / v0.6).
// Operator-facing surface for the per-article disk-usage breakdown the
// banner from T11 alerts on. Top: an overview card with totals + the
// blob-by-kind breakdown. Below: a sortable list of articles with
// snapshot bytes/count, blob bytes, and a link back to the article so
// the operator can review (and prune) version history.

export type SortKey = "total" | "snapshots" | "blobs" | "name";
export type SortDir = "asc" | "desc";

interface Props {
  /** Optional callback fired when the operator clicks "View versions →". */
  onViewArticle?: (row: ArticleStorageRow) => void;
}

export function StorageSettings({ onViewArticle }: Props): React.ReactElement {
  const toast = useToast();
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [rows, setRows] = useState<ArticleStorageRow[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [ov, perArticle] = await Promise.all([
        invoke("storage:overview", {}),
        invoke("storage:per-article", {}),
      ]);
      setOverview(ov);
      setRows(perArticle);
    } catch (err) {
      toast.push("error", describeError(err));
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
    // Disk-usage events fire on every snapshot/blob mutation; refresh the
    // panel so the totals + per-article rows track edits live.
    const unsubscribe = window.forme.onDiskUsageChanged(() => {
      void refresh();
    });
    return () => {
      unsubscribe();
    };
  }, [refresh]);

  const sorted = useMemo(() => sortRows(rows ?? [], sortKey, sortDir), [rows, sortKey, sortDir]);

  const onHeaderClick = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        // Names default to ascending; numeric columns default to descending.
        setSortDir(key === "name" ? "asc" : "desc");
      }
    },
    [sortKey]
  );

  return (
    <div className="space-y-6" data-testid="storage-settings">
      <OverviewCard overview={overview} />

      <div className="border-border-default bg-bg-surface rounded-lg border p-6">
        <h2 className="font-display text-display-md text-text-primary mb-1">Articles</h2>
        <p className="text-caption text-text-secondary mb-4">
          Snapshots + image blobs for each article. Open a row to review or prune its version
          history.
        </p>

        {rows === null ? (
          <div
            className="text-caption text-text-tertiary py-6 text-center"
            data-testid="storage-list-loading"
          >
            Loading articles...
          </div>
        ) : sorted.length === 0 ? (
          <div
            className="text-caption text-text-secondary py-6 text-center"
            data-testid="storage-empty-state"
          >
            No storage data yet. Save an article to start tracking.
          </div>
        ) : (
          <ArticleStorageTable
            rows={sorted}
            sortKey={sortKey}
            sortDir={sortDir}
            onHeaderClick={onHeaderClick}
            {...(onViewArticle ? { onViewArticle } : {})}
          />
        )}
      </div>
    </div>
  );
}

function OverviewCard({ overview }: { overview: StorageOverview | null }): React.ReactElement {
  if (!overview) {
    return (
      <div
        className="border-border-default bg-bg-surface rounded-lg border p-6"
        data-testid="storage-overview-loading"
      >
        <h2 className="font-display text-display-md text-text-primary mb-1">Disk usage</h2>
        <p className="text-caption text-text-secondary">Loading...</p>
      </div>
    );
  }

  return (
    <div
      className="border-border-default bg-bg-surface rounded-lg border p-6"
      data-testid="storage-overview"
    >
      <h2 className="font-display text-display-md text-text-primary mb-1">Disk usage</h2>
      <p className="text-caption text-text-secondary mb-4">
        Across snapshots + image blobs in your library.
      </p>

      <div
        className="text-display-md text-text-primary font-display mb-4"
        data-testid="storage-overview-total"
      >
        {formatBytes(overview.total)}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <BreakdownItem
          label="Snapshots"
          value={overview.snapshots}
          testId="storage-breakdown-snapshots"
        />
        <BreakdownItem label="All blobs" value={overview.blobs} testId="storage-breakdown-blobs" />
        <BreakdownItem
          label="Hero images"
          value={overview.blobsByKind.hero}
          testId="storage-breakdown-hero"
        />
        <BreakdownItem
          label="Ad creatives"
          value={overview.blobsByKind.ad}
          testId="storage-breakdown-ad"
        />
        <BreakdownItem
          label="Classifieds"
          value={overview.blobsByKind.classifieds}
          testId="storage-breakdown-classifieds"
        />
        <BreakdownItem
          label="Other blobs"
          value={overview.blobsByKind.other}
          testId="storage-breakdown-other"
        />
      </dl>
    </div>
  );
}

function BreakdownItem({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}): React.ReactElement {
  return (
    <div>
      <dt className="text-label-caps text-text-tertiary mb-0.5">{label}</dt>
      <dd className="text-body text-text-primary" data-testid={testId}>
        {formatBytes(value)}
      </dd>
    </div>
  );
}

function ArticleStorageTable({
  rows,
  sortKey,
  sortDir,
  onHeaderClick,
  onViewArticle,
}: {
  rows: ArticleStorageRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onHeaderClick: (key: SortKey) => void;
  onViewArticle?: (row: ArticleStorageRow) => void;
}): React.ReactElement {
  return (
    <table className="w-full text-left" data-testid="storage-article-table">
      <thead>
        <tr className="border-border-default text-label-caps text-text-tertiary border-b">
          <SortableHeader
            label="Headline"
            keyName="name"
            current={sortKey}
            dir={sortDir}
            onClick={onHeaderClick}
            align="left"
          />
          <SortableHeader
            label="Snapshots"
            keyName="snapshots"
            current={sortKey}
            dir={sortDir}
            onClick={onHeaderClick}
            align="right"
          />
          <SortableHeader
            label="Blobs"
            keyName="blobs"
            current={sortKey}
            dir={sortDir}
            onClick={onHeaderClick}
            align="right"
          />
          <SortableHeader
            label="Total"
            keyName="total"
            current={sortKey}
            dir={sortDir}
            onClick={onHeaderClick}
            align="right"
          />
          <th className="py-2 pl-3" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.articleId}
            className="border-border-default border-b last:border-0"
            data-testid={`storage-row-${row.articleId}`}
          >
            <td className="text-body text-text-primary py-3 pr-3">
              <span className="line-clamp-1" title={row.headline}>
                {row.headline}
              </span>
            </td>
            <td className="text-body text-text-secondary py-3 pr-3 text-right tabular-nums">
              {row.snapshotCount === 0 ? (
                <span className="text-text-tertiary">—</span>
              ) : (
                <>
                  {row.snapshotCount} version{row.snapshotCount === 1 ? "" : "s"},{" "}
                  {formatBytes(row.snapshotBytes)}
                </>
              )}
            </td>
            <td className="text-body text-text-secondary py-3 pr-3 text-right tabular-nums">
              {row.blobBytes === 0 ? (
                <span className="text-text-tertiary">—</span>
              ) : (
                formatBytes(row.blobBytes)
              )}
            </td>
            <td className="text-body text-text-primary py-3 pr-3 text-right font-medium tabular-nums">
              {formatBytes(row.totalBytes)}
            </td>
            <td className="py-3 pl-3 text-right">
              <button
                type="button"
                onClick={() => onViewArticle?.(row)}
                disabled={!onViewArticle}
                data-testid={`storage-view-${row.articleId}`}
                className="text-body text-accent hover:text-accent-hover focus-visible:ring-accent/35 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
              >
                View versions →
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SortableHeader({
  label,
  keyName,
  current,
  dir,
  onClick,
  align,
}: {
  label: string;
  keyName: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align: "left" | "right";
}): React.ReactElement {
  const isActive = current === keyName;
  return (
    <th
      className={["py-2 pr-3 font-medium", align === "right" ? "text-right" : "text-left"].join(
        " "
      )}
    >
      <button
        type="button"
        onClick={() => onClick(keyName)}
        data-testid={`storage-sort-${keyName}`}
        aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
        className={[
          "text-label-caps inline-flex items-center gap-1",
          isActive ? "text-text-primary" : "text-text-tertiary hover:text-text-primary",
          "focus-visible:ring-accent/35 rounded-sm focus-visible:ring-2 focus-visible:outline-none",
        ].join(" ")}
      >
        {label}
        {isActive ? (
          dir === "asc" ? (
            <CaretUp size={10} weight="bold" aria-hidden="true" />
          ) : (
            <CaretDown size={10} weight="bold" aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );
}

export function sortRows(
  rows: ArticleStorageRow[],
  key: SortKey,
  dir: SortDir
): ArticleStorageRow[] {
  const factor = dir === "asc" ? 1 : -1;
  const copy = rows.slice();
  copy.sort((a, b) => {
    let cmp: number;
    if (key === "name") {
      cmp = a.headline.localeCompare(b.headline);
    } else if (key === "snapshots") {
      cmp = a.snapshotBytes - b.snapshotBytes;
    } else if (key === "blobs") {
      cmp = a.blobBytes - b.blobBytes;
    } else {
      cmp = a.totalBytes - b.totalBytes;
    }
    return cmp * factor;
  });
  return copy;
}
