import { describe, expect, test } from "vitest";
import { extractPlainText } from "../../../src/shared/article-body/extract.js";

describe("extractPlainText — plain", () => {
  test("returns plain bodies unchanged", () => {
    const body = "First paragraph.\n\nSecond paragraph.";
    expect(extractPlainText(body, "plain")).toBe(body);
  });

  test("empty body → empty string", () => {
    expect(extractPlainText("", "plain")).toBe("");
    expect(extractPlainText("", "markdown")).toBe("");
    expect(extractPlainText("", "blocks")).toBe("");
  });
});

describe("extractPlainText — markdown", () => {
  test("strips heading + list markers but keeps paragraph breaks", () => {
    const md = [
      "# A heading",
      "",
      "A paragraph with **bold** and *italic*.",
      "",
      "- first item",
      "- second item",
      "",
      "> a quoted line",
    ].join("\n");
    const out = extractPlainText(md, "markdown");
    expect(out).toContain("A heading");
    expect(out).toContain("A paragraph with bold and italic.");
    expect(out).toContain("first item second item");
    expect(out).toContain("a quoted line");
    // Paragraph breaks survive.
    expect(out.split(/\n{2,}/).length).toBeGreaterThanOrEqual(4);
  });

  test("strips inline links but keeps the visible text", () => {
    const md = "See [Forme docs](https://example.com/forme) for details.";
    expect(extractPlainText(md, "markdown")).toBe("See Forme docs for details.");
  });

  test("drops markdown image syntax entirely", () => {
    const md = "Before. ![alt text](https://img/x.png) After.";
    expect(extractPlainText(md, "markdown")).toBe("Before.  After.".replace(/\s{2,}/g, " "));
  });

  test("strips ordered list markers", () => {
    const md = "1. First step\n2. Second step";
    const out = extractPlainText(md, "markdown");
    expect(out).toBe("First step Second step");
  });
});

describe("extractPlainText — blocks (BlockNote)", () => {
  test("single paragraph block extracts its text", () => {
    const blocks = JSON.stringify([
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "Hello world", styles: {} }],
        children: [],
      },
    ]);
    expect(extractPlainText(blocks, "blocks")).toBe("Hello world");
  });

  test("multi-paragraph blocks join with \\n\\n", () => {
    const blocks = JSON.stringify([
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "First paragraph.", styles: {} }],
        children: [],
      },
      {
        id: "p2",
        type: "paragraph",
        content: [{ type: "text", text: "Second paragraph.", styles: {} }],
        children: [],
      },
    ]);
    expect(extractPlainText(blocks, "blocks")).toBe("First paragraph.\n\nSecond paragraph.");
  });

  test("heading blocks emit their text without markup", () => {
    const blocks = JSON.stringify([
      {
        id: "h1",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "A section heading", styles: {} }],
        children: [],
      },
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "Body text.", styles: {} }],
        children: [],
      },
    ]);
    const out = extractPlainText(blocks, "blocks");
    expect(out).toBe("A section heading\n\nBody text.");
  });

  test("nested children expand recursively", () => {
    const blocks = JSON.stringify([
      {
        id: "list",
        type: "bulletListItem",
        content: [{ type: "text", text: "Outer item", styles: {} }],
        children: [
          {
            id: "nested",
            type: "bulletListItem",
            content: [{ type: "text", text: "Inner item", styles: {} }],
            children: [],
          },
        ],
      },
    ]);
    const out = extractPlainText(blocks, "blocks");
    expect(out).toBe("Outer item\n\nInner item");
  });

  test("image blocks are skipped", () => {
    const blocks = JSON.stringify([
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "Before image.", styles: {} }],
        children: [],
      },
      {
        id: "img1",
        type: "image",
        props: { url: "https://example.com/x.png" },
        content: [],
        children: [],
      },
      {
        id: "p2",
        type: "paragraph",
        content: [{ type: "text", text: "After image.", styles: {} }],
        children: [],
      },
    ]);
    expect(extractPlainText(blocks, "blocks")).toBe("Before image.\n\nAfter image.");
  });

  test("malformed JSON returns the raw body (defensive)", () => {
    const broken = "{not valid json";
    expect(extractPlainText(broken, "blocks")).toBe(broken);
  });

  test("non-array JSON returns the raw body (defensive)", () => {
    const obj = JSON.stringify({ not: "an array" });
    expect(extractPlainText(obj, "blocks")).toBe(obj);
  });

  test("multiple text runs in one block concatenate", () => {
    const blocks = JSON.stringify([
      {
        id: "p1",
        type: "paragraph",
        content: [
          { type: "text", text: "Bold ", styles: { bold: true } },
          { type: "text", text: "and italic", styles: { italic: true } },
          { type: "text", text: " mix.", styles: {} },
        ],
        children: [],
      },
    ]);
    expect(extractPlainText(blocks, "blocks")).toBe("Bold and italic mix.");
  });

  test("empty blocks list → empty string", () => {
    expect(extractPlainText("[]", "blocks")).toBe("");
  });
});
