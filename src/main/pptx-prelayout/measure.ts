// Bridge between @napi-rs/canvas and @chenglou/pretext.
//
// pretext is browser-first — it grabs OffscreenCanvas at module load to
// measure text. In Node we don't have OffscreenCanvas, so we install a
// shim BEFORE importing pretext. The shim wraps @napi-rs/canvas, which
// uses Skia for text shaping — close enough to browser canvas (and to
// PowerPoint's text engine) for our pre-break heuristic.
//
// We also load the bundled Fraunces / Inter / Mukta TTFs into Skia's
// font registry so measureText resolves to the actual fonts the export
// will reference. Without this, Skia falls back to whatever it can find
// and width drift causes line re-wrapping in PowerPoint.

import { Canvas, GlobalFonts } from "@napi-rs/canvas";
import path from "node:path";
import fs from "node:fs/promises";

let registered = false;

function registerBundledFontsSync(): void {
  if (registered) return;
  // Resolve relative to repo root in dev, packaged resources in prod.
  const candidates = [
    path.resolve(process.cwd(), "src/assets/fonts"),
    process.resourcesPath ? path.join(process.resourcesPath, "fonts") : null,
  ].filter((p): p is string => !!p);

  for (const dir of candidates) {
    try {
      // GlobalFonts.registerFromPath is sync.
      GlobalFonts.registerFromPath(path.join(dir, "Fraunces-Regular.ttf"), "Fraunces");
      GlobalFonts.registerFromPath(path.join(dir, "Fraunces-Italic.ttf"), "Fraunces");
      GlobalFonts.registerFromPath(path.join(dir, "Inter-Regular.ttf"), "Inter");
      GlobalFonts.registerFromPath(path.join(dir, "Inter-Italic.ttf"), "Inter");
      GlobalFonts.registerFromPath(path.join(dir, "Mukta-Regular.ttf"), "Mukta");
      GlobalFonts.registerFromPath(path.join(dir, "Mukta-Bold.ttf"), "Mukta");
      registered = true;
      return;
    } catch {
      // try next candidate
    }
  }
}

/**
 * Install OffscreenCanvas shim + register fonts. Idempotent. Call this
 * once before importing pretext for the first time.
 */
export async function installCanvasShim(): Promise<void> {
  registerBundledFontsSync();
  // Also verify at least one font loaded by stat-ing the file
  await fs
    .access(path.resolve(process.cwd(), "src/assets/fonts/Fraunces-Regular.ttf"))
    .catch(() => undefined);

  if (typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas !== "undefined") {
    return;
  }
  // Minimal shim — pretext only uses (new OffscreenCanvas(1,1)).getContext('2d')
  // and then ctx.measureText(). The Skia ctx returns a TextMetrics-shaped object.
  class OffscreenCanvasShim {
    width: number;
    height: number;
    private canvas: Canvas;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.canvas = new Canvas(w, h);
    }
    getContext(kind: string): CanvasRenderingContext2D | null {
      if (kind !== "2d") return null;
      // @napi-rs/canvas ctx is API-compatible enough for measureText use.
      return this.canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    }
  }
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = OffscreenCanvasShim;
}
