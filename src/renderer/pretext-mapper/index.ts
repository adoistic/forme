// Pretext adapter for the renderer.
//
// Forme vendors Pretext at vendor/pretext/ per eng-plan §1. The vendored
// repo ships TypeScript source that uses .ts-extension imports, which
// requires Pretext's own build step (not ours) to produce the runtime
// dist/ entry point.
//
// Phase 1 probe + Phase 2 mapping harness will wire this up for real —
// building Pretext's dist/ and importing it from here. For now this file
// is a placeholder that exports the interface our renderer + tests will
// consume, so the import graph is stable ahead of Phase 2.

export interface PretextLineMeasurement {
  /** Text of this line, already line-broken. */
  text: string;
  /** Horizontal offset in px from the text box origin. */
  leftPx: number;
  /** Vertical offset in px from the text box origin (top). */
  topPx: number;
  /** Rendered width of the line in px. */
  widthPx: number;
  /** Line height in px (matches the typography spec's leading). */
  heightPx: number;
}

export interface PretextLayout {
  lines: PretextLineMeasurement[];
  /** Total height in px this layout consumes. */
  totalHeightPx: number;
  /** Count of lines actually produced (may be < requested if body ran short). */
  lineCount: number;
}

export interface PretextMeasureOptions {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  maxWidthPx: number;
  letterSpacingPx?: number;
}

/**
 * Measure text for layout. Stub in Phase 0; real implementation wired in
 * Phase 1 probe to vendor/pretext/dist/layout.js.
 */
export function measureText(_options: PretextMeasureOptions): PretextLayout {
  throw new Error(
    "Pretext adapter not wired yet. Implement in Phase 1 by importing from " +
      "vendor/pretext/dist/layout.js after building the vendored Pretext."
  );
}
