/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<ArticleBodyEditor>` (T4 / v0.6).
 *
 * BlockNote runs ProseMirror under the hood, which talks to layout APIs
 * jsdom doesn't fully implement. We rely on observable wrapper state
 * (mode tabs, textarea, callback signatures) rather than poking inside
 * the BlockNote instance where we can. The conversion tests are the
 * exception: they trigger BlockNote's pure markdown<->blocks helpers,
 * which run synchronously and don't need layout.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  ArticleBodyEditor,
  type BodyFormat,
} from "../../../src/renderer/components/article-body-editor/ArticleBodyEditor.js";

// jsdom doesn't implement Range.getBoundingClientRect / getClientRects
// fully; ProseMirror falls back gracefully but logs warnings. Stub them
// so the console stays quiet and any consumer that touches them gets a
// sane default.
beforeEach(() => {
  // BlockNote -> Mantine -> useMediaQuery wants window.matchMedia.
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = (() => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    })) as () => DOMRect;
  }
  if (typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = (() => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    })) as () => DOMRectList;
  }
});

afterEach(() => {
  cleanup();
});

describe("<ArticleBodyEditor>", () => {
  test("renders in rich mode with BlockNote when bodyFormat is plain", () => {
    const onChange = vi.fn();
    render(<ArticleBodyEditor value="Hello world." bodyFormat="plain" onChange={onChange} />);

    expect(screen.getByTestId("article-body-editor")).toBeTruthy();
    expect(screen.getByTestId("article-body-editor-rich")).toBeTruthy();
    // Rich mode tab is selected.
    expect(screen.getByTestId("article-body-editor-mode-rich").getAttribute("aria-selected")).toBe(
      "true"
    );
  });

  test("renders in markdown mode with editor visible when bodyFormat is markdown", () => {
    const onChange = vi.fn();
    const md = "# Heading\n\nBody paragraph.";
    render(<ArticleBodyEditor value={md} bodyFormat="markdown" onChange={onChange} />);

    const textarea = screen.getByTestId("article-body-editor-markdown") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe(md);
    expect(
      screen.getByTestId("article-body-editor-mode-markdown").getAttribute("aria-selected")
    ).toBe("true");
  });

  test("toggling rich→markdown serializes blocks to markdown", () => {
    const onChange = vi.fn();
    // Seed with a known block JSON so we can predict the markdown.
    const initialBlocks = JSON.stringify([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello world.", styles: {} }],
      },
    ]);

    render(<ArticleBodyEditor value={initialBlocks} bodyFormat="blocks" onChange={onChange} />);

    // Click the markdown tab.
    fireEvent.click(screen.getByTestId("article-body-editor-mode-markdown"));

    // The textarea should now contain markdown serialized from the
    // initial blocks. BlockNote's blocksToMarkdownLossy emits the text
    // content of each paragraph on its own line.
    const textarea = screen.getByTestId("article-body-editor-markdown") as HTMLTextAreaElement;
    expect(textarea.value).toContain("Hello world.");

    // onChange should have fired with the markdown payload.
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    expect(lastCall?.[1]).toBe("markdown");
    expect(lastCall?.[0]).toContain("Hello world.");
  });

  test("toggling markdown→rich parses markdown into blocks", () => {
    const onChange = vi.fn();
    render(
      <ArticleBodyEditor
        value="# Heading\n\nBody paragraph."
        bodyFormat="markdown"
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByTestId("article-body-editor-mode-rich"));

    // Rich pane is now visible.
    expect(screen.getByTestId("article-body-editor-rich")).toBeTruthy();

    // onChange should have fired with the new "blocks" format. The
    // serialized JSON must be a JSON-parseable array containing the
    // parsed content.
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    expect(lastCall?.[1]).toBe("blocks");
    const parsed = JSON.parse(String(lastCall?.[0]));
    expect(Array.isArray(parsed)).toBe(true);
    // The "# Heading" should map to at least one block (heading or
    // paragraph depending on parser); plus the body paragraph. Either
    // way, expect ≥ 1 block.
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });

  test("onChange fires with the current format when typing in markdown mode", () => {
    const onChange = vi.fn();
    render(<ArticleBodyEditor value="" bodyFormat="markdown" onChange={onChange} />);

    const textarea = screen.getByTestId("article-body-editor-markdown") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "## New section" } });

    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("## New section");
    expect(lastCall?.[1]).toBe("markdown");
  });

  test("readOnly disables editing", () => {
    const onChange = vi.fn();
    render(
      <ArticleBodyEditor value="Frozen body." bodyFormat="markdown" onChange={onChange} readOnly />
    );

    const textarea = screen.getByTestId("article-body-editor-markdown") as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);

    // Mode tabs are disabled too.
    const richTab = screen.getByTestId("article-body-editor-mode-rich") as HTMLButtonElement;
    const mdTab = screen.getByTestId("article-body-editor-mode-markdown") as HTMLButtonElement;
    expect(richTab.disabled).toBe(true);
    expect(mdTab.disabled).toBe(true);
  });

  test("public API matches BodyFormat union", () => {
    // Type-only check: this won't compile if the union narrows.
    const formats: BodyFormat[] = ["plain", "markdown", "blocks"];
    expect(formats.length).toBe(3);
  });
});
