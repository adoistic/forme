import React, { useState } from "react";
import { marked } from "marked";
import { useIssueStore, useShallow } from "../../stores/issue.js";
import { useToast } from "../../components/Toast.js";
import { invoke } from "../../ipc/client.js";
import { describeError } from "../../lib/error-helpers.js";
import { EditArticleModal } from "./EditArticleModal.js";
import { NewArticleModal } from "./NewArticleModal.js";
import type { ArticleSummary } from "@shared/ipc-contracts/channels.js";

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
  const [editing, setEditing] = useState<ArticleSummary | null>(null);
  const [composing, setComposing] = useState(false);

  if (!currentIssue) {
    return <NoIssue />;
  }

  async function importFiles(files: FileList | File[]): Promise<void> {
    if (!currentIssue) return;
    // Accept .docx (mammoth pipeline), .md and .markdown (parsed via
    // marked → HTML → plain text), and .txt (paragraph-split as-is).
    const list = Array.from(files).filter((f) => /\.(docx|md|markdown|txt)$/i.test(f.name));
    if (list.length === 0) {
      toast.push("error", "Supported formats: .docx, .md, .txt.");
      return;
    }
    setImporting(list.length);
    let succeeded = 0;
    let failed = 0;
    for (const file of list) {
      try {
        if (file.name.toLowerCase().endsWith(".docx")) {
          const buf = new Uint8Array(await file.arrayBuffer());
          const base64 = bytesToBase64(buf);
          await invoke("article:import-docx", {
            issueId: currentIssue.id,
            filename: file.name,
            base64,
          });
        } else {
          const text = await file.text();
          const isMd = /\.(md|markdown)$/i.test(file.name);
          // Convert markdown → HTML → plain paragraphs. For .txt files
          // skip the marked pass — they're already plain text.
          const body = isMd
            ? htmlToParagraphs(marked.parse(text, { async: false }) as string)
            : text.replace(/\r\n/g, "\n").trim();
          // Headline = filename without extension; user can rename via
          // the edit modal afterwards.
          const headline = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
          await invoke("article:create", {
            issueId: currentIssue.id,
            headline,
            body,
          });
        }
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

  function htmlToParagraphs(html: string): string {
    return html
      .replace(/<\/(?:p|h[1-6]|li|blockquote)\s*>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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
      <header className="border-border-default flex h-16 shrink-0 items-center justify-between border-b px-8">
        <div>
          <h1 className="font-display text-display-md text-text-primary">Articles</h1>
          <div className="text-caption text-text-tertiary">
            {articles.length} in this issue · drag & drop .docx, .md, or .txt files anywhere
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label
            className="border-accent text-title-sm text-accent hover:bg-accent-bg cursor-pointer rounded-md border-[1.5px] px-4 py-2"
            data-testid="import-docx-button"
          >
            Import file
            <input
              type="file"
              accept=".docx,.md,.markdown,.txt"
              multiple
              className="hidden"
              onChange={onFilePicker}
              data-testid="import-docx-input"
            />
          </label>
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="bg-accent text-title-sm text-text-inverse hover:bg-accent-hover rounded-md px-4 py-2 font-semibold"
            data-testid="new-article-button"
          >
            + New article
          </button>
        </div>
      </header>

      <div
        className={["relative flex-1 overflow-auto p-8", isDragging ? "bg-accent-bg" : ""].join(
          " "
        )}
      >
        {articles.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="border-accent max-w-[520px] rounded-lg border-2 border-dashed p-12 text-center">
              <div className="text-label-caps text-accent mb-2">DROP ZONE</div>
              <h2 className="font-display text-display-md text-text-primary mb-2">
                Drop your first article.
              </h2>
              <p className="text-body text-text-secondary mb-6">
                Drag a .docx file here, or click <strong>Import .docx</strong> above. Forme parses
                the headline, body, language, and any embedded images automatically.
              </p>
              <div className="text-caption text-text-tertiary">
                Supports: English, Hindi, bilingual content.
              </div>
            </div>
          </div>
        ) : (
          <ArticleList articles={articles} onEdit={(a) => setEditing(a)} />
        )}

        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="border-accent bg-bg-surface text-title-lg text-accent rounded-lg border-2 border-dashed px-8 py-6 shadow-lg">
              Release to import
            </div>
          </div>
        ) : null}

        {importing > 0 ? (
          <div className="bg-bg-surface text-caption text-text-secondary absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md px-4 py-2 shadow-md">
            Importing {importing} file{importing === 1 ? "" : "s"}...
          </div>
        ) : null}
      </div>

      {editing ? (
        <EditArticleModal
          article={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refreshArticles();
            toast.push("success", "Article updated.");
          }}
        />
      ) : null}

      {composing && currentIssue ? (
        <NewArticleModal
          issueId={currentIssue.id}
          onClose={() => setComposing(false)}
          onSaved={async () => {
            setComposing(false);
            await Promise.all([refreshArticles(), refreshIssues()]);
            toast.push("success", "Article saved.");
          }}
        />
      ) : null}
    </div>
  );
}

function ArticleList({
  articles,
  onEdit,
}: {
  articles: ArticleSummary[];
  onEdit: (a: ArticleSummary) => void;
}): React.ReactElement {
  return (
    <div className="mx-auto max-w-[920px]">
      <ul className="divide-border-default divide-y">
        {articles.map((a) => (
          <li
            key={a.id}
            className="group flex items-start gap-4 py-4"
            data-testid={`article-row-${a.id}`}
          >
            <button
              type="button"
              onClick={() => onEdit(a)}
              className="min-w-0 flex-1 text-left"
              data-testid={`article-edit-${a.id}`}
            >
              <div className="font-display text-title-lg text-text-primary group-hover:text-accent truncate">
                {a.headline}
              </div>
              {a.byline ? (
                <div className="text-caption text-text-tertiary">
                  {a.byline}
                  {a.bylinePosition === "end" ? (
                    <span className="border-border-default text-label-caps text-text-tertiary ml-2 rounded-full border px-2">
                      END
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="text-caption text-text-tertiary italic">
                  No byline — click to add
                </div>
              )}
              <div className="text-caption text-text-tertiary mt-1">
                {a.wordCount.toLocaleString()} words · {a.contentType}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-3">
              <span
                className={[
                  "text-label-caps rounded-full px-2 py-0.5",
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
        <div className="text-label-caps text-accent mb-4">NO ISSUE</div>
        <h2 className="font-display text-display-md text-text-primary mb-3">
          Create an issue first.
        </h2>
        <p className="text-body text-text-secondary">
          Jump to the Issue Board tab and click <strong>Create new issue</strong>, then come back
          here to drop articles.
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
