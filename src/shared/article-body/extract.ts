/**
 * Body extraction for downstream consumers that expect plain text.
 *
 * v0.6 introduced `body_format` on the articles table — articles can now
 * be stored as `'plain'` (legacy v0.5 newline-paragraph text), `'markdown'`
 * (raw markdown source), or `'blocks'` (BlockNote document JSON, serialized
 * with `JSON.stringify`). The PPTX export and other text-only consumers
 * predate this change and assume plain `\n\n`-separated paragraphs, so
 * BlockNote articles need to be flattened back to prose before they reach
 * the layout pipeline.
 *
 * Output shape: `\n\n`-separated paragraphs of unmarked text. Drop-in
 * replacement for the raw `body` field that the pretext layout consumed
 * before v0.6.
 */

interface BlockContentRun {
  text?: unknown;
}

interface Block {
  type?: unknown;
  content?: unknown;
  children?: unknown;
}

/**
 * Walk a BlockNote `content` array and concatenate any `text` runs. The
 * BlockNote shape per run is `{ type: 'text', text: '…', styles: {} }`;
 * we only need the `text` field. Strings encountered directly (some block
 * variants serialize as a plain string) are passed through.
 */
function runsToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((run) => {
      if (typeof run === "string") return run;
      if (run && typeof run === "object" && "text" in (run as object)) {
        const t = (run as BlockContentRun).text;
        return typeof t === "string" ? t : "";
      }
      return "";
    })
    .join("");
}

/**
 * Recursive flatten of a single BlockNote block to a paragraph string.
 * Children (nested blocks) are joined with their own paragraph break, so
 * a list with three items becomes three paragraphs in the output. Image
 * and other media-only blocks have no text — they collapse to an empty
 * string and are dropped at the join step.
 */
function blockToParagraphs(block: unknown): string[] {
  if (!block || typeof block !== "object") return [];
  const b = block as Block;
  const type = typeof b.type === "string" ? b.type : "";
  // Skip media-only blocks. They have no readable text content; emitting
  // an empty paragraph would just leave a gap in the layout.
  if (type === "image" || type === "video" || type === "audio" || type === "file") {
    return [];
  }
  const own = runsToText(b.content).trim();
  const childParagraphs = Array.isArray(b.children)
    ? (b.children as unknown[]).flatMap((child) => blockToParagraphs(child))
    : [];
  return [...(own.length > 0 ? [own] : []), ...childParagraphs];
}

/**
 * Strip markdown markers conservatively. Covers the formats the BlockNote
 * markdown serializer emits: ATX headings, unordered + ordered lists,
 * blockquotes, bold/italic markers, inline code. Inline punctuation is
 * preserved. Blank-line paragraph boundaries survive verbatim.
 *
 * Picked over `marked.lexer` for v0.6: cheaper, no extra dep wiring on
 * the main process, and the export layout doesn't honor markdown
 * structure anyway — it just wants paragraphs of words.
 */
function stripMarkdown(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split("\n")
        .map((line) =>
          line
            // ATX headings: "## Heading" → "Heading"
            .replace(/^\s{0,3}#{1,6}\s+/, "")
            // Blockquote markers: "> quoted" → "quoted"
            .replace(/^\s{0,3}>\s?/, "")
            // Unordered list markers: "- item" / "* item" / "+ item"
            .replace(/^\s{0,3}[-*+]\s+/, "")
            // Ordered list markers: "1. item"
            .replace(/^\s{0,3}\d+\.\s+/, "")
            // Setext underline lines (===, ---) under a heading
            .replace(/^\s*[=-]{3,}\s*$/, "")
        )
        .join(" ")
        .trim()
        // Inline emphasis: **bold** / __bold__ / *italic* / _italic_
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(\*|_)(.+?)\1/g, "$2")
        // Inline code: `code` → code
        .replace(/`([^`]+)`/g, "$1")
        // Images: ![alt](url) → (drop entirely; export has no place for it).
        // Must run BEFORE the link strip so the inner [alt](url) doesn't
        // match first and leave a stray "!" behind.
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        // Links: [text](url) → text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim()
    )
    .filter((p) => p.length > 0)
    .join("\n\n");
}

/**
 * Flatten an article body into plain paragraphs the pretext layout pipeline
 * (and any other text-only consumer) understands. Drop-in for the raw
 * `body` field on `ArticleSummary` / DB rows.
 *
 *   - "plain":    returns body unchanged.
 *   - "markdown": strips markdown markers; preserves paragraph boundaries.
 *   - "blocks":   parses BlockNote JSON and emits one paragraph per block
 *                 (recursively flattening nested children). Media blocks
 *                 are skipped.
 *
 * Defensive on malformed input: a `JSON.parse` failure on `'blocks'`
 * returns the raw body string. The layout pipeline degrades to "weird text
 * in slides" rather than crashing — better than dropping the whole article.
 */
export function extractPlainText(
  body: string,
  bodyFormat: "plain" | "markdown" | "blocks"
): string {
  if (!body) return "";
  if (bodyFormat === "plain") return body;
  if (bodyFormat === "markdown") return stripMarkdown(body);
  if (bodyFormat === "blocks") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return body;
    }
    if (!Array.isArray(parsed)) return body;
    const paragraphs = parsed.flatMap((block) => blockToParagraphs(block));
    return paragraphs.join("\n\n");
  }
  return body;
}
