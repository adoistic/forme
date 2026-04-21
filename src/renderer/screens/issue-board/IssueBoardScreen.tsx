import React, { useState } from "react";
import { useIssueStore, useShallow } from "../../stores/issue.js";
import { useToast } from "../../components/Toast.js";
import { invoke } from "../../ipc/client.js";
import { describeError } from "../../lib/error-helpers.js";
import { CreateIssueModal } from "./CreateIssueModal.js";

export function IssueBoardScreen(): React.ReactElement {
  const { currentIssue, articles, classifieds, ads, refreshAll } = useIssueStore(
    useShallow((s) => ({
      currentIssue: s.currentIssue,
      articles: s.articles,
      classifieds: s.classifieds,
      ads: s.ads,
      refreshAll: s.refreshAll,
    }))
  );
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport(): Promise<void> {
    if (!currentIssue) return;
    setExporting(true);
    try {
      const result = await invoke("export:pptx", { issueId: currentIssue.id });
      toast.push(
        "success",
        `Exported ${result.pageCount} pages → ${result.outputPath}\nOpen it in PowerPoint to review.`
      );
    } catch (e) {
      toast.push("error", describeError(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {/* Canvas header */}
      <header className="app-region-drag flex h-16 shrink-0 items-center justify-between border-b border-border-default bg-bg-canvas/80 px-8">
        <div className="app-region-no-drag">
          {currentIssue ? (
            <div className="text-label-caps text-text-tertiary">
              {currentIssue.title.toUpperCase()}
              {currentIssue.issueNumber !== null
                ? ` · ISSUE ${currentIssue.issueNumber}`
                : ""}
              {" · "}
              {new Date(currentIssue.issueDate).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          ) : (
            <div className="text-label-caps text-text-tertiary">NO ISSUE YET</div>
          )}
        </div>
        <div className="app-region-no-drag flex items-center gap-4">
          <span className="text-caption text-text-tertiary" data-testid="autosave-indicator">
            {currentIssue ? `${currentIssue.articleCount} articles · ${currentIssue.classifiedCount} classifieds · ${currentIssue.adCount} ads` : "Not saved yet"}
          </span>
          {currentIssue ? (
            <button
              type="button"
              data-testid="export-issue-button"
              onClick={handleExport}
              disabled={exporting || articles.length === 0}
              className="rounded-md border border-accent bg-accent px-4 py-1.5 text-title-sm font-semibold text-text-inverse transition-colors duration-fast hover:bg-accent-hover disabled:opacity-40"
            >
              {exporting ? "Exporting..." : "Export to PowerPoint"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        {currentIssue ? (
          <IssueOverview articleCount={articles.length} classifiedCount={classifieds.length} adCount={ads.length} />
        ) : (
          <NoIssueYet onCreate={() => setCreating(true)} />
        )}
      </div>

      {creating ? (
        <CreateIssueModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await refreshAll();
            toast.push("success", "New issue created. Switch to Articles tab to drop in your first .docx.");
          }}
        />
      ) : null}
    </>
  );
}

function NoIssueYet({ onCreate }: { onCreate: () => void }): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-[480px] text-center">
        <div className="mb-4 text-label-caps text-accent">START</div>
        <h2 className="mb-3 font-display text-display-md text-text-primary">
          Let&apos;s set up your first issue.
        </h2>
        <p className="mb-6 text-body text-text-secondary">
          Forme works one issue at a time. Create one, drop in some articles, and export to PowerPoint.
        </p>
        <button
          type="button"
          data-testid="create-issue-button"
          onClick={onCreate}
          className="rounded-md bg-accent px-6 py-3 text-title-sm font-semibold text-text-inverse transition-colors duration-fast hover:bg-accent-hover"
        >
          Create new issue
        </button>
      </div>
    </div>
  );
}

function IssueOverview({
  articleCount,
  classifiedCount,
  adCount,
}: {
  articleCount: number;
  classifiedCount: number;
  adCount: number;
}): React.ReactElement {
  const isEmpty = articleCount === 0 && classifiedCount === 0 && adCount === 0;
  return (
    <div className="mx-auto max-w-[820px]">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Articles" count={articleCount} hint="Drop .docx files in the Articles tab" />
        <StatCard label="Classifieds" count={classifiedCount} hint="Add via form or import a CSV" />
        <StatCard label="Ads" count={adCount} hint="Upload creatives in the Ads tab" />
      </div>

      {isEmpty ? (
        <div className="mt-12 rounded-lg border border-border-default bg-bg-surface p-8 text-center">
          <div className="mb-2 text-label-caps text-accent">NEXT STEP</div>
          <h3 className="mb-2 font-display text-display-md text-text-primary">
            Add your first article.
          </h3>
          <p className="text-body text-text-secondary">
            Switch to the Articles tab and drop a .docx file. The export button up top will light up once you have at least one article.
          </p>
        </div>
      ) : (
        <div className="mt-12 rounded-lg border border-accent-muted bg-accent-bg p-6">
          <div className="text-body text-text-primary">
            Ready to export? Click <strong>Export to PowerPoint</strong> in the header. Your .pptx will be saved to <code className="font-mono">~/Documents/Forme/</code>. Open it in PowerPoint, review, then export to PDF for your printer.
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  count,
  hint,
}: {
  label: string;
  count: number;
  hint: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border-default bg-bg-surface p-5">
      <div className="text-label-caps text-text-tertiary">{label}</div>
      <div className="mt-2 font-display text-display-md text-text-primary">{count}</div>
      <div className="mt-1 text-caption text-text-tertiary">{hint}</div>
    </div>
  );
}
