import mammoth from "mammoth";
import { detectLanguage } from "@shared/schemas/language.js";
import { countWords, type BylinePosition } from "@shared/schemas/article.js";
import { makeError, type StructuredError } from "@shared/errors/structured.js";
import type { Language } from "@shared/schemas/language.js";

// Docx ingest per docs/eng-plan.md §1 + CEO plan Section 8.3 (bulk import).
// Uses mammoth.js to convert docx → text + HTML + embedded image bytes.
//
// MVP strategy: extract the first h1/h2 as headline, everything else as body.
// Embedded images come out as raw bytes; caller writes them into the blob store.

export interface ParsedDocx {
  headline: string;
  body: string;
  body_html: string;
  deck: string | null;
  byline: string | null;
  byline_position: BylinePosition;
  word_count: number;
  language: Language;
  images: ParsedImage[];
  warnings: string[];
}

export interface ParsedImage {
  mimeType: string;
  bytes: Buffer;
}

export async function parseDocx(buffer: Buffer): Promise<ParsedDocx> {
  // 1. Extract raw text for word counting + language detection
  const textResult = await safeMammoth(() => mammoth.extractRawText({ buffer }));
  const rawText = textResult.value.trim();

  if (rawText.length === 0) {
    throw makeError("empty_body", "warning", { reason: "no_text_extracted" });
  }

  // 2. Convert to HTML for styled content preservation + image extraction
  const images: ParsedImage[] = [];
  const imgConverter = mammoth.images.imgElement(async (image) => {
    const buf = await image.read();
    images.push({
      mimeType: image.contentType,
      bytes: buf,
    });
    // Placeholder src; caller replaces with blob-hash reference.
    return { src: `forme-img-${images.length - 1}` };
  });

  const htmlResult = await safeMammoth(() =>
    mammoth.convertToHtml({ buffer }, { convertImage: imgConverter })
  );

  const html = htmlResult.value;

  // 3. Extract headline: prefer first h1, then first h2, then first line
  const {
    headline,
    bodyText: rawBody,
    bodyHtml: afterHeadlineHtml,
  } = splitHeadline(rawText, html);

  // 4. Extract deck from the first italic paragraph, if any. Magazines
  // conventionally put a one-line or two-line italic subtitle right below
  // the headline, and pandoc's HTML preserves the <em> wrapper — so we
  // parse BEFORE stripping tags. Strip the matched paragraph out of both
  // HTML and the plain-text body.
  const { deck, bodyText: afterDeckText, bodyHtml } = extractDeck(
    rawBody,
    afterHeadlineHtml
  );

  // 5. Extract byline + position from the deck-stripped body. Handles both
  // print conventions: "By X" near the top, or em-dash credit at the end.
  const { byline, bylinePosition, bodyText } = extractByline(afterDeckText);

  // 5. Count words in body + detect language from full text
  const word_count = countWords(bodyText);
  const language = detectLanguage(rawText);

  // 6. Warnings from mammoth (unmapped styles, broken refs, etc.)
  const warnings = dedupe([
    ...htmlResult.messages.map((m) => m.message),
    ...textResult.messages.map((m) => m.message),
  ]);

  return {
    headline,
    body: bodyText,
    body_html: bodyHtml,
    deck,
    byline,
    byline_position: bylinePosition,
    word_count,
    language,
    images,
    warnings,
  };
}

/**
 * Pull the first italic paragraph out and call it the deck. Two patterns
 * handled:
 *   - <p><em>Deck</em></p>  — pandoc's conversion of Word italic paragraphs.
 *   - <p><i>Deck</i></p>    — equivalent from older editors.
 * If the first paragraph is mixed-italic (italic wrapping only some of its
 * text), we don't treat it as a deck — it's probably just normal body copy.
 */
function extractDeck(
  bodyText: string,
  bodyHtml: string
): { deck: string | null; bodyText: string; bodyHtml: string } {
  // Match an initial fully-italic <p> (allow attributes + whitespace).
  // pandoc emits <p lang="hi" dir="ltr"><em>...</em></p> for Hindi italics
  // — without the [^>]* the regex would miss them and the deck would
  // leak into the body.
  const m = bodyHtml.match(
    /^\s*<p[^>]*>\s*<(em|i)[^>]*>([\s\S]*?)<\/\1>\s*<\/p>\s*/i
  );
  if (!m || !m[2]) {
    return { deck: null, bodyText, bodyHtml };
  }
  const deck = stripAllTags(m[2]).trim();
  if (deck.length === 0 || deck.length > 600) {
    return { deck: null, bodyText, bodyHtml };
  }
  const newHtml = bodyHtml.slice(m[0].length);
  // Remove the first paragraph from the plain-text body too. Since our
  // stripTagsPreservingParagraphs splits blocks into \n\n chunks, the deck
  // should be the first such chunk.
  const paragraphs = bodyText.split(/\n{2,}/);
  if (paragraphs[0]?.trim() === deck) {
    paragraphs.shift();
  }
  return {
    deck,
    bodyText: paragraphs.join("\n\n").trim(),
    bodyHtml: newHtml,
  };
}

function stripAllTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

/**
 * Extract first heading as headline; strip that heading from the HTML body.
 */
function splitHeadline(
  rawText: string,
  html: string
): { headline: string; bodyText: string; bodyHtml: string } {
  const headingMatch = html.match(/<(h[12])[^>]*>([\s\S]*?)<\/\1>/);
  if (headingMatch?.[2]) {
    const headline = stripTags(headingMatch[2]).trim();
    let bodyHtml = html.replace(headingMatch[0], "").trim();
    // Strip a duplicate leading h1/h2 with the same text — Wikipedia's
    // plaintext often starts with the article title repeated, which pandoc
    // promotes to a Heading1 right after our own H1, leaving the title
    // visible as a body paragraph after extraction.
    const dup = bodyHtml.match(/^\s*<(h[12])[^>]*>([\s\S]*?)<\/\1>\s*/i);
    if (dup?.[2]) {
      const dupText = stripTags(dup[2]).trim();
      if (dupText.toLowerCase() === headline.toLowerCase()) {
        bodyHtml = bodyHtml.slice(dup[0].length).trim();
      }
    }
    const bodyText = stripTagsPreservingParagraphs(bodyHtml);
    return { headline: headline || firstLine(rawText), bodyText, bodyHtml };
  }

  // Fallback: first non-empty line as headline, remainder as body
  const firstNonEmpty = firstLine(rawText);
  const remainder = rawText.slice(firstNonEmpty.length).trim();
  return {
    headline: firstNonEmpty,
    bodyText: remainder,
    bodyHtml: html,
  };
}

/**
 * Strip HTML tags but keep paragraph structure — downstream byline and
 * deck detection depend on paragraph boundaries surviving. We turn closing
 * block tags into double newlines, then strip inline tags, decode HTML
 * entities (&amp; → &, &aacute; → á, etc.), then collapse horizontal
 * whitespace only (not vertical).
 */
function stripTagsPreservingParagraphs(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<\/(p|h[1-6]|li|blockquote|br)\s*>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  // Latin extended — covers the most common Wikipedia footnote markers
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  Ccedil: "Ç",
};

/**
 * Decode HTML entities. Handles named (&amp;), decimal (&#38;), and hex
 * (&#x26;) forms. Unknown named entities are left as-is so we don't lose
 * data — better to print "&xyz;" than to silently drop content.
 */
function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/g, (full, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return NAMED_ENTITIES[body] ?? full;
  });
}

/**
 * Find a byline in the body. Two conventions supported:
 *   - Top byline: a line starting with "By " (or "by " / "BY ") within the
 *     first few paragraphs. Strip it from the body and mark position "top".
 *   - End byline: last non-empty paragraph is a short line starting with
 *     "— " / "-- " / "—" (em-dash) followed by a name, or a line like
 *     "By The Editor" at the end. Mark position "end" and strip it.
 * If both are present, top wins (common wire-service pattern).
 */
function extractByline(body: string): {
  byline: string | null;
  bylinePosition: BylinePosition;
  bodyText: string;
} {
  const paragraphs = body
    .split(/\n{2,}|(?<=\.)\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Look for top byline in first 3 paragraphs. Recognized prefixes:
  //   - English: "By" (case-insensitive)
  //   - Hindi: "लेखक" (writer), "द्वारा" (by)
  //   - Latin script Hindi: "Lekhak"
  // The captured name is preserved verbatim — we only re-prefix English
  // bylines with "By " for typographic consistency.
  for (let i = 0; i < Math.min(3, paragraphs.length); i += 1) {
    const p = paragraphs[i] ?? "";
    const en = p.match(/^\s*By\s+(.+?)\s*$/i);
    if (en && en[1] && en[1].length < 140) {
      paragraphs.splice(i, 1);
      return {
        byline: `By ${en[1].trim()}`,
        bylinePosition: "top",
        bodyText: paragraphs.join("\n\n"),
      };
    }
    // Hindi: "लेखक — Name" / "लेखक: Name" / "द्वारा Name"
    const hi = p.match(/^\s*(?:लेखक|द्वारा|Lekhak)\s*[—–:\-]?\s*(.+?)\s*$/);
    if (hi && hi[1] && hi[1].length < 140 && p.length < 160) {
      paragraphs.splice(i, 1);
      return {
        byline: p.trim(),
        bylinePosition: "top",
        bodyText: paragraphs.join("\n\n"),
      };
    }
  }

  // Look for end byline in last paragraph
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const endMatch =
    last.match(/^\s*[—–-]{1,2}\s*(.+?)\s*$/) ??
    last.match(/^\s*(?:By|Signed)\s+(.+?)\s*$/i);
  if (endMatch && endMatch[1] && endMatch[1].length < 140 && last.length < 160) {
    paragraphs.pop();
    return {
      byline: endMatch[1].trim(),
      bylinePosition: "end",
      bodyText: paragraphs.join("\n\n"),
    };
  }

  return { byline: null, bylinePosition: "top", bodyText: body };
}

function firstLine(text: string): string {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length > 0) return line.trim();
  }
  return "Untitled";
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
}

function dedupe(values: string[]): string[] {
  return values.filter((v, i, arr) => arr.indexOf(v) === i);
}

async function safeMammoth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (thrown: unknown) {
    const err: StructuredError = makeError("corrupt_archive", "error", {
      reason: thrown instanceof Error ? thrown.message : "unknown",
    });
    throw err;
  }
}
