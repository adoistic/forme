import React, { useMemo, useRef, useState } from "react";
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

// Hero upload state machine. Operator picks a file (via picker / drop) OR
// types a URL — never both. We keep them in separate slots so the submit
// path can route to the correct IPC handler.
type HeroSource =
  | { kind: "none" }
  | { kind: "file"; file: File; previewUrl: string }
  | { kind: "url"; url: string };

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

  // Hero upload — staged locally until article:create succeeds, then
  // forwarded to the hero:upload-* IPC. Operators see a preview before
  // committing.
  const [hero, setHero] = useState<HeroSource>({ kind: "none" });
  const [urlExpanded, setUrlExpanded] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function clearHero(): void {
    if (hero.kind === "file") {
      URL.revokeObjectURL(hero.previewUrl);
    }
    setHero({ kind: "none" });
    setUrlDraft("");
    setUrlExpanded(false);
  }

  function handleFileChosen(file: File | null): void {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.push("error", "That file isn't an image.");
      return;
    }
    if (hero.kind === "file") {
      URL.revokeObjectURL(hero.previewUrl);
    }
    setHero({ kind: "file", file, previewUrl: URL.createObjectURL(file) });
    setUrlDraft("");
    setUrlExpanded(false);
  }

  function handleUrlConfirm(): void {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    if (hero.kind === "file") {
      URL.revokeObjectURL(hero.previewUrl);
    }
    setHero({ kind: "url", url: trimmed });
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileChosen(file);
  }

  // Helper: read a File as base64 without holding the whole string in memory
  // an extra time (the FileReader output IS the base64 we need).
  async function fileToBase64(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("FileReader returned non-string"));
          return;
        }
        // dataURL form is `data:<mime>;base64,<payload>` — strip prefix.
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
      reader.readAsDataURL(file);
    });
  }

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
      let created = await invoke("article:create", {
        issueId,
        headline: headline.trim(),
        body: bodyText,
        deck: deck.trim() || null,
        byline: byline.trim() || null,
        contentType,
      });

      // Stage 2: hero upload, if the operator picked one. We attempt this
      // AFTER the article is created so the article id exists. Failure here
      // doesn't roll back the article — operator gets a warning toast and
      // can re-attempt the hero from the edit modal.
      if (hero.kind === "file") {
        try {
          const base64 = await fileToBase64(hero.file);
          created = await invoke("hero:upload-file", {
            articleId: created.id,
            base64,
            filename: hero.file.name,
          });
        } catch (heroErr) {
          toast.push(
            "error",
            `Article saved, but the hero image didn't attach: ${describeError(heroErr)}`
          );
        }
      } else if (hero.kind === "url") {
        try {
          created = await invoke("hero:upload-url", {
            articleId: created.id,
            url: hero.url,
          });
        } catch (heroErr) {
          toast.push(
            "error",
            `Article saved, but the hero image didn't attach: ${describeError(heroErr)}`
          );
        }
      }

      // Tear down preview URL before parent unmounts the modal.
      if (hero.kind === "file") {
        URL.revokeObjectURL(hero.previewUrl);
      }
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
        <div className="border-border-default shrink-0 border-b px-8 pt-6 pb-4">
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
        <div className="border-border-default flex shrink-0 items-center gap-3 border-b px-8 py-3">
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

        {/* Hero upload — drop zone + file picker + URL paste (T14) */}
        <div className="border-border-default shrink-0 border-b px-8 py-4" data-testid="new-article-hero">
          <HeroUploadSection
            hero={hero}
            dragOver={dragOver}
            urlExpanded={urlExpanded}
            urlDraft={urlDraft}
            fileInputRef={fileInputRef}
            onSetUrlDraft={setUrlDraft}
            onSetDragOver={setDragOver}
            onSetUrlExpanded={setUrlExpanded}
            onUrlConfirm={handleUrlConfirm}
            onClear={clearHero}
            onFileChosen={handleFileChosen}
            onDrop={handleDrop}
          />
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {mode === "richtext" ? (
            <RichEditor editor={editor} />
          ) : (
            <MarkdownEditor markdown={markdown} onChange={setMarkdown} previewHtml={previewHtml} />
          )}
        </div>

        {/* Footer */}
        <div className="border-border-default flex shrink-0 items-center justify-end gap-3 border-t px-8 py-4">
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

/**
 * HeroUploadSection — three-affordance upload row per design-shotgun
 * "drop-zone-primary" variant:
 *   - Big dashed-rust drop zone (clicking it opens the file picker)
 *   - "Or paste a URL" link below (toggles a URL input)
 *   - Selected-state replaces the zone with a small preview + "Remove"
 *
 * Drag/drop wiring lives on the zone itself. The parent owns the state
 * (so the submit handler can read it after `article:create` returns).
 */
function HeroUploadSection({
  hero,
  dragOver,
  urlExpanded,
  urlDraft,
  fileInputRef,
  onSetUrlDraft,
  onSetDragOver,
  onSetUrlExpanded,
  onUrlConfirm,
  onClear,
  onFileChosen,
  onDrop,
}: {
  hero: HeroSource;
  dragOver: boolean;
  urlExpanded: boolean;
  urlDraft: string;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onSetUrlDraft: (s: string) => void;
  onSetDragOver: (b: boolean) => void;
  onSetUrlExpanded: (b: boolean) => void;
  onUrlConfirm: () => void;
  onClear: () => void;
  onFileChosen: (file: File | null) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}): React.ReactElement {
  // Selected state — show a small preview + remove button.
  if (hero.kind === "file") {
    return (
      <div className="flex items-center gap-4" data-testid="new-article-hero-selected">
        <img
          src={hero.previewUrl}
          alt="Hero preview"
          className="border-border-default h-16 w-16 rounded-md border object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="text-label-caps text-text-secondary">HERO IMAGE</div>
          <div className="text-caption text-text-primary truncate">{hero.file.name}</div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-caption text-text-secondary hover:text-text-primary rounded-md px-3 py-1.5 hover:bg-black/[0.04]"
          data-testid="new-article-hero-remove"
        >
          Remove
        </button>
      </div>
    );
  }
  if (hero.kind === "url") {
    return (
      <div className="flex items-center gap-4" data-testid="new-article-hero-selected">
        <div className="border-border-default bg-bg-canvas flex h-16 w-16 items-center justify-center rounded-md border">
          <span className="text-label-caps text-text-tertiary">URL</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-label-caps text-text-secondary">HERO IMAGE</div>
          <div className="text-caption text-text-primary truncate" title={hero.url}>
            {hero.url}
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-caption text-text-secondary hover:text-text-primary rounded-md px-3 py-1.5 hover:bg-black/[0.04]"
          data-testid="new-article-hero-remove"
        >
          Remove
        </button>
      </div>
    );
  }

  // Empty state — drop zone + URL paste.
  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) onSetDragOver(true);
        }}
        onDragLeave={() => onSetDragOver(false)}
        onDrop={onDrop}
        className={[
          "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-8 text-center transition-colors",
          dragOver
            ? "border-accent bg-accent-bg"
            : "border-border-dashed bg-bg-canvas hover:bg-black/[0.02]",
        ].join(" ")}
        data-testid="new-article-hero-dropzone"
      >
        <span className="text-title-sm text-text-primary">Drop a hero image here</span>
        <span className="text-caption text-text-secondary">
          or click to choose a file (PNG, JPG, WebP)
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
          data-testid="new-article-hero-file-input"
        />
      </div>
      {urlExpanded ? (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => onSetUrlDraft(e.target.value)}
            placeholder="https://example.com/hero.jpg"
            className="border-border-default bg-bg-surface text-caption text-text-primary focus:border-accent flex-1 rounded-md border px-3 py-1.5 focus:outline-none"
            data-testid="new-article-hero-url-input"
            autoFocus
          />
          <button
            type="button"
            onClick={onUrlConfirm}
            disabled={!urlDraft.trim()}
            className="bg-accent text-caption text-text-inverse hover:bg-accent-hover rounded-md px-3 py-1.5 font-semibold disabled:opacity-40"
            data-testid="new-article-hero-url-confirm"
          >
            Use URL
          </button>
          <button
            type="button"
            onClick={() => onSetUrlExpanded(false)}
            className="text-caption text-text-secondary rounded-md px-2 py-1.5 hover:bg-black/[0.04]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onSetUrlExpanded(true)}
          className="text-caption text-text-secondary hover:text-accent self-center underline-offset-2 hover:underline"
          data-testid="new-article-hero-url-toggle"
        >
          Or paste a URL
        </button>
      )}
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
