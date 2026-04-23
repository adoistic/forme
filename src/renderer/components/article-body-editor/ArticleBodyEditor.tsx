import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import type { PartialBlock } from "@blocknote/core";
import "@blocknote/mantine/style.css";

/**
 * Storage format for an article body.
 *   - "plain"    — v0.5 articles: paragraph-broken text. Round-trips as a
 *                  single paragraph block; first edit upgrades to "blocks".
 *   - "markdown" — markdown source. Used when the operator prefers writing
 *                  source-text directly. BlockNote can parse this back to
 *                  blocks losslessly for most editorial markdown.
 *   - "blocks"   — BlockNote document JSON, serialized via JSON.stringify.
 */
export type BodyFormat = "plain" | "markdown" | "blocks";

export interface ArticleBodyEditorProps {
  /** Current body. Format determined by bodyFormat. */
  value: string;
  /** Storage format. "blocks" = BlockNote JSON serialized as string. */
  bodyFormat: BodyFormat;
  /** Fired on every change. The string is in the current bodyFormat. */
  onChange: (value: string, format: BodyFormat) => void;
  /** Optional: focus on mount. */
  autoFocus?: boolean;
  /** Optional: read-only mode (used for snapshot preview). */
  readOnly?: boolean;
  /** Optional: language hint for markdown highlighting (en | hi | bilingual). */
  language?: "en" | "hi" | "bilingual";
}

type EditorMode = "rich" | "markdown";

/**
 * Two-mode shared editor for article body. Mounted by both
 * `NewArticleModal` and `EditArticleModal` (T7-T10).
 *
 *   - Rich (BlockNote): block-based editor. Stores `blocks` format
 *     (BlockNote document JSON) on every change.
 *   - Markdown: source-text editor (textarea). Stores `markdown` format.
 *
 * Toggling preserves content via BlockNote's built-in markdown
 * serializer / parser. Switching is destructive only for content that
 * doesn't round-trip cleanly through markdown (complex tables, embedded
 * media). A one-line warning surfaces when conversion is lossy.
 *
 * Plain-text input is treated as a single paragraph; on first edit it
 * upgrades to the "blocks" format. T5 will batch-migrate existing v0.5
 * articles outside this component.
 */
export function ArticleBodyEditor({
  value,
  bodyFormat,
  onChange,
  autoFocus = false,
  readOnly = false,
  language: _language = "en",
}: ArticleBodyEditorProps): React.ReactElement {
  // Mode follows bodyFormat on first render; thereafter the user toggles.
  // "plain" maps to "rich" — the operator never sees raw plain mode.
  const initialMode: EditorMode = bodyFormat === "markdown" ? "markdown" : "rich";
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [warning, setWarning] = useState<string | null>(null);

  // Initial blocks for the BlockNote instance. Computed once at mount:
  // BlockNote owns its own state thereafter. Empty array => editor
  // renders its default empty paragraph; we only pass initialContent
  // when populated.
  // Intentionally omitting `value`/`bodyFormat` from deps: re-deriving
  // initialContent on prop changes would clobber the user's in-progress
  // edits. T7-T10 callers pass static initial values.
  const initialValueRef = useRef({ value, bodyFormat });
  const initialContent = useMemo(
    () => deserializeToBlocks(initialValueRef.current.value, initialValueRef.current.bodyFormat),
    []
  );

  // useCreateBlockNote requires an options object. exactOptionalPropertyTypes
  // forbids passing `initialContent: undefined` for the empty case, so split
  // the argument into a stable shape.
  const editorOptions = useMemo(
    () => (initialContent.length > 0 ? { initialContent } : {}),
    [initialContent]
  );
  const editor = useCreateBlockNote(editorOptions);

  // Markdown buffer (mode === "markdown"). Initialized from value if input
  // is markdown; otherwise serialized from blocks on the first toggle.
  const [markdownBuf, setMarkdownBuf] = useState<string>(() =>
    bodyFormat === "markdown" ? value : ""
  );

  // Wire BlockNote onChange while in rich mode.
  useEffect(() => {
    if (mode !== "rich" || readOnly) return;
    const unsub = editor.onChange(() => {
      const json = JSON.stringify(editor.document);
      onChange(json, "blocks");
    });
    return unsub;
  }, [editor, mode, readOnly, onChange]);

  // Optional autoFocus on mount.
  useEffect(() => {
    if (!autoFocus || readOnly) return;
    if (mode === "rich") {
      // BlockNote exposes focus() on the editor instance.
      try {
        editor.focus();
      } catch {
        // jsdom / SSR safety — focus may not be available in test env.
      }
    }
  }, [autoFocus, editor, mode, readOnly]);

  function switchMode(target: EditorMode): void {
    if (target === mode) return;
    setWarning(null);

    if (target === "markdown") {
      // Serialize current blocks to markdown.
      const md = editor.blocksToMarkdownLossy(editor.document);
      setMarkdownBuf(md);
      // Lossy check: round-trip and compare block count.
      const roundTrip = editor.tryParseMarkdownToBlocks(md);
      if (roundTrip.length !== editor.document.length) {
        setWarning(
          "Some formatting may not survive the switch — markdown can't carry every block type."
        );
      }
      onChange(md, "markdown");
    } else {
      // markdown -> rich: parse buffer into blocks and replace.
      const blocks = editor.tryParseMarkdownToBlocks(markdownBuf);
      if (blocks.length > 0) {
        editor.replaceBlocks(editor.document, blocks);
      }
      // Emit current blocks so caller sees the new format/value.
      const json = JSON.stringify(editor.document);
      onChange(json, "blocks");
    }
    setMode(target);
  }

  function handleMarkdownChange(next: string): void {
    setMarkdownBuf(next);
    onChange(next, "markdown");
  }

  return (
    <div className="flex h-full flex-col" data-testid="article-body-editor">
      {/* Mode tabs — live above the editor surface */}
      <div className="border-border-default flex items-center justify-between border-b px-4 py-2">
        <div
          className="border-border-default flex rounded-full border p-0.5"
          role="tablist"
          aria-label="Editor mode"
        >
          {(["rich", "markdown"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              disabled={readOnly}
              className={[
                "text-caption rounded-full px-4 py-1 font-semibold transition-colors",
                mode === m
                  ? "bg-accent text-text-inverse"
                  : "text-text-secondary hover:bg-black/[0.04]",
                readOnly ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
              data-testid={`article-body-editor-mode-${m}`}
            >
              {m === "rich" ? "Rich" : "Markdown"}
            </button>
          ))}
        </div>
        {warning && (
          <p
            className="text-caption text-warning"
            role="status"
            data-testid="article-body-editor-warning"
          >
            {warning}
          </p>
        )}
      </div>

      {/* Editor surface */}
      <div className="bg-bg-canvas flex-1 overflow-auto">
        {mode === "rich" ? (
          // TODO(T6): wrap BlockNote's paste handling with DOMPurify
          // before the editor ingests clipboard HTML. Pretext export
          // already escapes on the way out, but the editor surface
          // should be paranoid on the way in.
          <div
            className="font-display text-body text-text-primary mx-auto max-w-[720px] px-8 py-6"
            data-testid="article-body-editor-rich"
          >
            {/*
             * BlockNoteView's editor prop expects a wider schema record
             * than useCreateBlockNote returns under exactOptionalPropertyTypes.
             * The runtime types are identical; cast to unblock tsc.
             */}
            <BlockNoteView
              editor={editor as unknown as React.ComponentProps<typeof BlockNoteView>["editor"]}
              editable={!readOnly}
              theme="light"
            />
          </div>
        ) : (
          <textarea
            value={markdownBuf}
            onChange={(e) => handleMarkdownChange(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            placeholder="Write or paste markdown…"
            className="text-text-primary placeholder:text-text-tertiary block h-full w-full resize-none bg-transparent px-8 py-6 font-mono text-[13px] leading-6 focus:outline-none"
            data-testid="article-body-editor-markdown"
            autoFocus={autoFocus}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Convert an incoming `value` + `bodyFormat` into BlockNote's initial
 * content. Pure: no side effects, safe to call inside useMemo.
 *   - "blocks":   parsed JSON (returns [] on parse failure to avoid
 *                 crashing the editor on a corrupt buffer).
 *   - "markdown": returns []; the markdown buffer drives initial render
 *                 in markdown mode and parsing happens at toggle time
 *                 against the live editor instance.
 *   - "plain":    a single paragraph block per non-empty paragraph.
 */
function deserializeToBlocks(value: string, bodyFormat: BodyFormat): PartialBlock[] {
  if (bodyFormat === "blocks") {
    if (!value) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as PartialBlock[]) : [];
    } catch {
      return [];
    }
  }
  if (bodyFormat === "plain") {
    if (!value.trim()) return [];
    return value
      .split(/\n{2,}/)
      .map((para) => para.trim())
      .filter((para) => para.length > 0)
      .map(
        (text): PartialBlock => ({
          type: "paragraph",
          content: [{ type: "text", text, styles: {} }],
        })
      );
  }
  return [];
}
