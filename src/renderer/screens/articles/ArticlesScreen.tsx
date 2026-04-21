import React, { useState } from "react";
import { useIssueStore, useShallow } from "../../stores/issue.js";
import { useToast } from "../../components/Toast.js";
import { invoke } from "../../ipc/client.js";
import { describeError } from "../../lib/error-helpers.js";

export function ArticlesScreen(): React.ReactElement {
  const { currentIssue, articles, refreshArticles, refreshIssues } = useIssueStore(
    useShallow((s) => ({
      currentIssue: s.currentIssue,
      articles: s.articles,
      refreshArticles: s.refreshArticles,
      refreshIssues: s.refreshIssues,
    }))
  );
  const toast = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(0);

  if (!currentIssue) {
    return <NoIssue />;
  }

  async function importFiles(files: FileList | File[]): Promise<void> {
    if (!currentIssue) return;
    const list = Array.from(files).filter((f) => f.name.endsWith(".docx"));
    if (list.length === 0) {
      toast.push("error", "Only .docx files are supported.");
      return;
    }
    setImporting(list.length);
    let succeeded = 0;
    let failed = 0;
    for (const file of list) {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const base64 = bytesToBase64(buf);
        await invoke("article:import-docx", {
          issueId: currentIssue.id,
          filename: file.name,
          base64,
        });
        succeeded += 1;
      } catch (e) {
        failed += 1;
        toast.push("error", `${file.name}: ${describeError(e)}`);
      }
    }
    setImporting(0);
    await Promise.all([refreshArticles(), refreshIssues()]);
    if (succeeded > 0) {
      toast.push(
        "success",
        `Imported ${succeeded} article${succeeded === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}.`
      );
    }
  }

  function onDragOver(e: React.DragEvent): void {
    e.preventDefault();
    setIsDragging(true);
  }
  function onDragLeave(): void {
    setIsDragging(false);
  }
  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault();
    setIsDragging(false);
    await importFiles(e.dataTransfer.files);
  }
  async function onFilePicker(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = e.target.files;
    if (files) await importFiles(files);
    e.target.value = "";
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-default px-8">
        <div>
          <h1 className="font-display text-display-md text-text-primary">Articles</h1>
          <div className="text-caption text-text-tertiary">
            {articles.length} in this issue · drag & drop .docx files anywhere
          </div>
        </div>
        <label
          className="cursor-pointer rounded-md border-[1.5px] border-accent px-4 py-2 text-title-sm text-accent hover:bg-accent-bg"
          data-testid="import-docx-button"
        >
          Import .docx
          <input
            type="file"
            accept=".docx"
            multiple
            className="hidden"
            onChange={onFilePicker}
            data-testid="import-docx-input"
          />
        </label>
      </header>

      <div
        className={[
          "relative flex-1 overflow-auto p-8",
          isDragging ? "bg-accent-bg" : "",
        ].join(" ")}
      >
        {articles.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-[520px] rounded-lg border-2 border-dashed border-accent p-12 text-center">
              <div className="mb-2 text-label-caps text-accent">DROP ZONE</div>
              <h2 className="mb-2 font-display text-display-md text-text-primary">
                Drop your first article.
              </h2>
              <p className="mb-6 text-body text-text-secondary">
                Drag a .docx file here, or click <strong>Import .docx</strong> above. Forme parses
                the headline, body, language, and any embedded images automatically.
              </p>
              <div className="text-caption text-text-tertiary">
                Supports: English, Hindi, bilingual content.
              </div>
            </div>
          </div>
        ) : (
          <ArticleList articles={articles} />
        )}

        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border-2 border-dashed border-accent bg-bg-surface px-8 py-6 text-title-lg text-accent shadow-lg">
              Release to import
            </div>
          </div>
        ) : null}

        {importing > 0 ? (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-bg-surface px-4 py-2 text-caption text-text-secondary shadow-md">
            Importing {importing} file{importing === 1 ? "" : "s"}...
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ArticleList({
  articles,
}: {
  articles: import("@shared/ipc-contracts/channels.js").ArticleSummary[];
}): React.ReactElement {
  return (
    <div className="mx-auto max-w-[920px]">
      <ul className="divide-y divide-border-default">
        {articles.map((a) => (
          <li key={a.id} className="flex items-start gap-4 py-4" data-testid={`article-row-${a.id}`}>
            <div className="flex-1 min-w-0">
              <div className="font-display text-title-lg text-text-primary truncate">
                {a.headline}
              </div>
              {a.byline ? (
                <div className="text-caption text-text-tertiary">{a.byline}</div>
              ) : null}
              <div className="mt-1 text-caption text-text-tertiary">
                {a.wordCount.toLocaleString()} words · {a.contentType}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span
                className={[
                  "rounded-full px-2 py-0.5 text-label-caps",
                  a.language === "hi"
                    ? "bg-accent-muted text-text-primary"
                    : a.language === "bilingual"
                      ? "bg-warning-bg text-warning"
                      : "bg-border-default text-text-secondary",
                ].join(" ")}
              >
                {a.language === "en" ? "EN" : a.language === "hi" ? "HI" : "EN+HI"}
              </span>
              <span className="text-caption text-text-tertiary">
                {new Date(a.createdAt).toLocaleDateString()}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoIssue(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-[480px] text-center">
        <div className="mb-4 text-label-caps text-accent">NO ISSUE</div>
        <h2 className="mb-3 font-display text-display-md text-text-primary">
          Create an issue first.
        </h2>
        <p className="text-body text-text-secondary">
          Jump to the Issue Board tab and click <strong>Create new issue</strong>, then come back here to drop articles.
        </p>
      </div>
    </div>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  // Handle large buffers by chunking to avoid String.fromCharCode call-stack issues
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
