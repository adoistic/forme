import mammoth from "mammoth";
import { detectLanguage } from "@shared/schemas/language.js";
import { countWords } from "@shared/schemas/article.js";
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
  const { headline, bodyText, bodyHtml } = splitHeadline(rawText, html);

  // 4. Count words in body + detect language from full text
  const word_count = countWords(bodyText);
  const language = detectLanguage(rawText);

  // 5. Warnings from mammoth (unmapped styles, broken refs, etc.)
  const warnings = dedupe([
    ...htmlResult.messages.map((m) => m.message),
    ...textResult.messages.map((m) => m.message),
  ]);

  return {
    headline,
    body: bodyText,
    body_html: bodyHtml,
    deck: null,
    byline: null,
    word_count,
    language,
    images,
    warnings,
  };
}

/**
 * Extract first heading as headline; strip that heading from the HTML body.
 */
function splitHeadline(
  rawText: string,
  html: string
): { headline: string; bodyText: string; bodyHtml: string } {
  const headingMatch = html.match(/<(h[12])>([\s\S]*?)<\/\1>/);
  if (headingMatch?.[2]) {
    const headline = stripTags(headingMatch[2]).trim();
    const bodyHtml = html.replace(headingMatch[0], "").trim();
    const bodyText = stripTags(bodyHtml)
      .replace(/\s+/g, " ")
      .trim();
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
