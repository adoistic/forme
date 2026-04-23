/**
 * @vitest-environment jsdom
 *
 * T6 — DOMPurify hardening + BlockNote schema versioning.
 *
 * Verifies:
 *   1. The paste-allow-list strips scripts, event handlers, data: URIs.
 *   2. Markdown render strips embedded scripts.
 *   3. Block sanitization normalizes unknown types and drops malformed
 *      objects (defense-in-depth on snapshot reads).
 *   4. The shared BLOCKNOTE_SCHEMA_VERSION constant is exported and
 *      stable at 1 for v0.6.
 */
import { describe, expect, test } from "vitest";
import DOMPurify from "dompurify";
import {
  sanitizePastedHTML,
  sanitizeBlocks,
} from "../../../src/renderer/components/article-body-editor/ArticleBodyEditor.js";
import {
  BLOCKNOTE_SCHEMA_VERSION,
  isAllowedBlockType,
  ALLOWED_BLOCK_TYPES,
} from "../../../src/shared/blocknote-schema.js";

// Mirror of the markdown allow-list in NewArticleModal.tsx — kept here
// so the test exercises the exact rule set the preview pane uses.
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
function renderMarkdownLikeNewArticleModal(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: MD_ALLOWED_ATTR,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "img"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
  });
}

describe("paste sanitization (sanitizePastedHTML)", () => {
  test("strips <script> tags and their content", () => {
    const dirty = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const clean = sanitizePastedHTML(dirty);
    expect(clean).toContain("Hello");
    expect(clean).toContain("World");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert");
  });

  test("removes inline event handlers like onclick / onerror", () => {
    const dirty = '<p onclick="steal()">Click</p><img src="x" onerror="alert(1)">';
    const clean = sanitizePastedHTML(dirty);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).not.toContain("steal()");
    expect(clean).not.toContain("alert(1)");
  });

  test("blocks data: URLs in img src", () => {
    const dirty = '<img src="data:text/html,<script>alert(1)</script>">';
    const clean = sanitizePastedHTML(dirty);
    // data: URI either drops the src or the entire <img>; either way,
    // no script payload should survive.
    expect(clean).not.toContain("data:text/html");
    expect(clean).not.toContain("<script");
  });

  test("blocks javascript: URLs in anchors", () => {
    const dirty = '<a href="javascript:alert(1)">link</a>';
    const clean = sanitizePastedHTML(dirty);
    expect(clean).not.toMatch(/javascript:/i);
  });

  test("preserves allowed editorial tags (p, h2, ul, em, strong, a, code, blockquote)", () => {
    const dirty =
      "<h2>Title</h2>" +
      "<p>An <em>italic</em> and <strong>bold</strong> paragraph with " +
      '<a href="https://example.com">a link</a> and <code>inline code</code>.</p>' +
      "<blockquote>Quoted.</blockquote>" +
      "<ul><li>one</li><li>two</li></ul>";
    const clean = sanitizePastedHTML(dirty);
    expect(clean).toContain("<h2>");
    expect(clean).toContain("<em>");
    expect(clean).toContain("<strong>");
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain("<code>");
    expect(clean).toContain("<blockquote>");
    expect(clean).toContain("<ul>");
    expect(clean).toContain("<li>");
  });

  test("drops <style> and <iframe>", () => {
    const dirty = '<style>body{display:none}</style><iframe src="evil.html"></iframe><p>ok</p>';
    const clean = sanitizePastedHTML(dirty);
    expect(clean).not.toContain("<style");
    expect(clean).not.toContain("<iframe");
    expect(clean).toContain("ok");
  });
});

describe("markdown render sanitization", () => {
  test("strips <script> embedded in marked-rendered HTML", () => {
    // Simulate post-`marked` HTML that already lowered a markdown source
    // containing a raw <script>.
    const renderedDirty = '<h1>Heading</h1><p>Body</p><script>alert("xss")</script>';
    const clean = renderMarkdownLikeNewArticleModal(renderedDirty);
    expect(clean).toContain("Heading");
    expect(clean).toContain("Body");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert");
  });

  test("strips inline handlers from rendered HTML", () => {
    const renderedDirty = '<p onclick="x()">click</p>';
    const clean = renderMarkdownLikeNewArticleModal(renderedDirty);
    expect(clean).not.toMatch(/onclick/i);
  });

  test("removes <img> entirely (preview pane has no image surface)", () => {
    const renderedDirty = '<p>before</p><img src="x" onerror="alert(1)"><p>after</p>';
    const clean = renderMarkdownLikeNewArticleModal(renderedDirty);
    expect(clean).not.toContain("<img");
    expect(clean).not.toContain("onerror");
    expect(clean).toContain("before");
    expect(clean).toContain("after");
  });
});

describe("block sanitization (sanitizeBlocks)", () => {
  test("normalizes an unknown block type to a paragraph carrying its text", () => {
    const raw = [{ type: "marquee", content: [{ type: "text", text: "scrolling" }] }];
    const out = sanitizeBlocks(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("paragraph");
    // Text content surfaces in the normalized paragraph.
    expect(JSON.stringify(out[0])).toContain("scrolling");
  });

  test("filters out objects without a `type` field", () => {
    const raw = [
      { content: [{ type: "text", text: "no type" }] },
      { type: "paragraph", content: [{ type: "text", text: "ok", styles: {} }] },
      null,
      "naked string",
      42,
    ];
    const out = sanitizeBlocks(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("paragraph");
  });

  test("preserves blocks whose type is in the allow-list", () => {
    const raw = [
      { type: "paragraph", content: [] },
      { type: "heading", content: [] },
      { type: "bulletListItem", content: [] },
      { type: "codeBlock", content: [] },
    ];
    const out = sanitizeBlocks(raw);
    expect(out).toHaveLength(4);
    expect(out.map((b) => b.type)).toEqual(["paragraph", "heading", "bulletListItem", "codeBlock"]);
  });

  test("normalizes an unknown block with no extractable text to an empty paragraph", () => {
    const raw = [{ type: "embed", foo: 123 }];
    const out = sanitizeBlocks(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("paragraph");
  });
});

describe("BLOCKNOTE_SCHEMA_VERSION constant", () => {
  test("is the integer 1 for v0.6", () => {
    expect(BLOCKNOTE_SCHEMA_VERSION).toBe(1);
  });

  test("isAllowedBlockType matches ALLOWED_BLOCK_TYPES exactly", () => {
    for (const t of ALLOWED_BLOCK_TYPES) {
      expect(isAllowedBlockType(t)).toBe(true);
    }
    expect(isAllowedBlockType("marquee")).toBe(false);
    expect(isAllowedBlockType("")).toBe(false);
  });
});
