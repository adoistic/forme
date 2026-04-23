import React, { useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { invoke } from "../../ipc/client.js";
import { useToast } from "../../components/Toast.js";
import { describeError } from "../../lib/error-helpers.js";
import type { ArticleSummary } from "@shared/ipc-contracts/channels.js";
import type { ContentType } from "@shared/schemas/article.js";

interface Props {
  issueId: string;
  onClose: () => void;
  onSaved: (created: ArticleSummary) => void;
}

type EditorMode = "richtext" | "markdown";

const CONTENT_TYPES: ContentType[] = [
  "Article",
  "Photo Essay",
  "Interview",
  "Opinion",
  "Brief",
  "Letter",
  "Poem",
];

/**
 * DOMPurify allow-list for rendered markdown — covers everything the
 * preview pane needs and nothing more. T6 hardening for the
 * `dangerouslySetInnerHTML` surface in MarkdownEditor.
 */
const MD_ALLOWED_TAGS = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "code",
  "pre",
  "blockquote",
  "em",
  "strong",
  "i",
  "b",
  "u",
  "s",
  "hr",
];

const MD_ALLOWED_ATTR = ["href", "title"];

/**
 * Render markdown to HTML, then strip everything outside the allow-list.
 * Defense for the preview pane and the rich-editor hydrate path.
 */
function renderMarkdownSafe(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: MD_ALLOWED_ATTR,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "img"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
  });
}

/**
 * Compose a new article from scratch — without leaving the app, without
 * needing Microsoft Word.
 *
 * Two editing modes share the same body buffer (kept as plain-text
 * paragraph form so it round-trips cleanly through both):
 *   - Rich text: Tiptap on top of ProseMirror. Bold / italic / headings
 *     / lists / blockquote out of the box; the toolbar exposes the most
 *     common formatting.
 *   - Markdown: a wide textarea + a side-by-side preview. The preview
 *     uses `marked` to render the HTML.
 *
 * Switching tabs preserves your work — rich text serializes to markdown,
 * markdown parses to HTML for the rich editor.
 */
export function NewArticleModal({ issueId, onClose, onSaved }: Props): React.ReactElement {
  const toast = useToast();
  const [headline, setHeadline] = useState("");
  const [byline, setByline] = useState("");
  const [deck, setDeck] = useState("");
  const [contentType, setContentType] = useState<ContentType>("Article");
  const [mode, setMode] = useState<EditorMode>("richtext");
  // Markdown source-of-truth — rich editor mirrors this on tab switch.
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    onUpdate: ({ editor: ed }) => {
      // When the user edits in rich text, sync to markdown by reading the
      // editor's HTML + converting back. tiptap doesn't ship a markdown
      // serializer in StarterKit; for MVP we use HTML as the source on
      // rich-text mode and convert to plain text + paragraph breaks at
      // submit time.
      setMarkdown(htmlToMarkdownish(ed.getHTML()));
    },
  });

  // When we toggle TO rich text, re-hydrate the editor from current markdown
  function switchTo(target: EditorMode): void {
    if (target === mode) return;
    if (target === "richtext" && editor) {
      editor.commands.setContent(renderMarkdownSafe(markdown));
    }
    setMode(target);
  }

  // Live HTML preview for markdown mode.
  const previewHtml = useMemo(() => {
    try {
      return renderMarkdownSafe(markdown);
    } catch {
      return "";
    }
  }, [markdown]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!headline.trim()) return;
    // Resolve final body: in markdown mode, render to HTML then strip.
    // In richtext mode, the editor's HTML wins.
    const finalHtml =
      mode === "richtext" && editor ? editor.getHTML() : renderMarkdownSafe(markdown);
    const bodyText = htmlToParagraphs(finalHtml);
    if (!bodyText.trim()) {
      toast.push("error", "Body is empty.");
      return;
    }
    setBusy(true);
    try {
      const created = await invoke("article:create", {
        issueId,
        headline: headline.trim(),
        body: bodyText,
        deck: deck.trim() || null,
        byline: byline.trim() || null,
        contentType,
      });
      onSaved(created);
    } catch (err) {
      toast.push("error", describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="bg-bg-overlay fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-surface flex max-h-[94vh] w-[920px] flex-col overflow-hidden rounded-xl shadow-lg"
        data-testid="new-article-modal"
      >
        {/* Header strip */}
        <div className="border-border-default border-b px-8 pt-6 pb-4">
          <div className="text-label-caps text-accent mb-1">NEW ARTICLE</div>
          <input
            autoFocus
            required
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Headline goes here…"
            className="font-display text-display-md text-text-primary placeholder:text-text-tertiary w-full bg-transparent focus:outline-none"
            data-testid="new-article-headline"
          />
          <input
            type="text"
            value={deck}
            onChange={(e) => setDeck(e.target.value)}
            placeholder="A short subtitle (deck) — optional"
            className="text-body text-text-secondary placeholder:text-text-tertiary mt-1 w-full bg-transparent italic focus:outline-none"
            data-testid="new-article-deck"
          />
        </div>

        {/* Meta strip */}
        <div className="border-border-default flex items-center gap-3 border-b px-8 py-3">
          <div className="flex items-center gap-2">
            <span className="text-label-caps text-text-secondary">Author</span>
            <input
              type="text"
              value={byline}
              onChange={(e) => setByline(e.target.value)}
              placeholder="By Jane Doe"
              className="border-border-default bg-bg-surface text-caption text-text-primary focus:border-accent w-[180px] rounded-md border px-2 py-1 focus:outline-none"
              data-testid="new-article-byline"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-label-caps text-text-secondary">Type</span>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as ContentType)}
              className="border-border-default bg-bg-surface text-caption text-text-primary focus:border-accent rounded-md border px-2 py-1 focus:outline-none"
              data-testid="new-article-content-type"
            >
              {CONTENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1" />
          {/* Mode tabs */}
          <div
            className="border-border-default flex rounded-full border p-0.5"
            role="tablist"
            aria-label="Editor mode"
          >
            {(["richtext", "markdown"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchTo(m)}
                className={[
                  "text-caption rounded-full px-4 py-1 font-semibold transition-colors",
                  mode === m
                    ? "bg-accent text-text-inverse"
                    : "text-text-secondary hover:bg-black/[0.04]",
                ].join(" ")}
                data-testid={`new-article-mode-${m}`}
              >
                {m === "richtext" ? "Rich text" : "Markdown"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {mode === "richtext" ? (
            <RichEditor editor={editor} />
          ) : (
            <MarkdownEditor markdown={markdown} onChange={setMarkdown} previewHtml={previewHtml} />
          )}
        </div>

        {/* Footer */}
        <div className="border-border-default flex items-center justify-end gap-3 border-t px-8 py-4">
          <button
            type="button"
            onClick={onClose}
            className="text-title-sm text-text-secondary rounded-md px-4 py-2 hover:bg-black/[0.04]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !headline.trim()}
            className="bg-accent text-title-sm text-text-inverse hover:bg-accent-hover rounded-md px-5 py-2 font-semibold disabled:opacity-40"
            data-testid="new-article-submit"
          >
            {busy ? "Saving..." : "Save article"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RichEditor({ editor }: { editor: ReturnType<typeof useEditor> }): React.ReactElement {
  if (!editor) return <div className="text-text-tertiary p-8">Loading editor…</div>;
  const buttons: { label: string; cmd: () => void; active: () => boolean }[] = [
    {
      label: "B",
      cmd: () => editor.chain().focus().toggleBold().run(),
      active: () => editor.isActive("bold"),
    },
    {
      label: "I",
      cmd: () => editor.chain().focus().toggleItalic().run(),
      active: () => editor.isActive("italic"),
    },
    {
      label: "H2",
      cmd: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: () => editor.isActive("heading", { level: 2 }),
    },
    {
      label: "H3",
      cmd: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: () => editor.isActive("heading", { level: 3 }),
    },
    {
      label: "•",
      cmd: () => editor.chain().focus().toggleBulletList().run(),
      active: () => editor.isActive("bulletList"),
    },
    {
      label: "1.",
      cmd: () => editor.chain().focus().toggleOrderedList().run(),
      active: () => editor.isActive("orderedList"),
    },
    {
      label: '"',
      cmd: () => editor.chain().focus().toggleBlockquote().run(),
      active: () => editor.isActive("blockquote"),
    },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="border-border-default flex items-center gap-1 border-b px-8 py-2">
        {buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.cmd}
            className={[
              "text-caption h-8 min-w-[32px] rounded-md px-2 font-semibold transition-colors",
              b.active() ? "bg-accent-bg text-accent" : "text-text-secondary hover:bg-black/[0.04]",
            ].join(" ")}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-8 py-6">
        <EditorContent
          editor={editor}
          className="prose prose-stone text-body text-text-primary max-w-none focus:outline-none [&_.ProseMirror]:min-h-[280px] [&_.ProseMirror]:outline-none"
          data-testid="new-article-richtext-editor"
        />
      </div>
    </div>
  );
}

function MarkdownEditor({
  markdown,
  onChange,
  previewHtml,
}: {
  markdown: string;
  onChange: (s: string) => void;
  previewHtml: string;
}): React.ReactElement {
  return (
    <div className="divide-border-default grid h-full grid-cols-2 divide-x">
      <textarea
        value={markdown}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write or paste markdown…&#10;&#10;## A heading&#10;&#10;A paragraph.&#10;&#10;> A blockquote.&#10;&#10;- bullets too"
        className="bg-bg-canvas text-caption text-text-primary placeholder:text-text-tertiary h-full resize-none px-8 py-6 font-mono leading-6 focus:outline-none"
        data-testid="new-article-markdown-editor"
        spellCheck={false}
      />
      <div
        className="bg-bg-surface prose prose-stone text-body text-text-primary h-full max-w-none overflow-auto px-8 py-6"
        dangerouslySetInnerHTML={{ __html: previewHtml }}
        aria-label="Markdown preview"
      />
    </div>
  );
}

/**
 * Convert HTML produced by Tiptap to a markdown-ish form. This is NOT a
 * faithful round-trip — it covers headings, paragraphs, bold, italic,
 * lists, and blockquotes. Good enough to switch tabs and keep most
 * formatting.
 */
function htmlToMarkdownish(html: string): string {
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n\n")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(
      /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_m, inner: string) => "\n" + inner.replace(/\n/g, "\n> ").trim() + "\n\n"
    )
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/(?:ul|ol)>/gi, "\n")
    .replace(/<(?:ul|ol)[^>]*>/gi, "")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert HTML to plain-text paragraphs (\n\n-separated) suitable for the
 * pretext layout pipeline. Strips inline tags, decodes a small set of
 * entities, preserves block boundaries.
 */
function htmlToParagraphs(html: string): string {
  const text = html
    .replace(/<\/(?:p|h[1-6]|li|blockquote)\s*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
