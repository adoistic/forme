/**
 * Asserts the global `prefers-reduced-motion: reduce` reset is present
 * in the renderer's global stylesheet (ER2-6 / design review 6A).
 *
 * This is a static-source check — we read globals.css directly rather
 * than the compiled bundle so the test stays cheap and independent of
 * Vite. The block must zero-out animation + transition durations so
 * third-party CSS (BlockNote, Radix) honors the OS reduce-motion
 * preference.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS_PATH = resolve(__dirname, "../../../../src/renderer/styles/globals.css");

describe("globals.css — prefers-reduced-motion reset", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  test("contains @media (prefers-reduced-motion: reduce) block", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  test("zeros animation-duration to ~0ms", () => {
    expect(css).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
  });

  test("clamps animation-iteration-count to 1", () => {
    expect(css).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });

  test("zeros transition-duration to ~0ms", () => {
    expect(css).toMatch(/transition-duration:\s*0\.001ms\s*!important/);
  });

  test("forces auto scroll-behavior", () => {
    expect(css).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });
});
