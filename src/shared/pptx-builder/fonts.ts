import fs from "node:fs/promises";
import path from "node:path";

// Font resolution helpers for PPTX embedding.
// pptxgenjs's `embedFonts` option takes `{ fontName, fontFace, file }` entries
// where `file` is a path to a TTF. We ship Fraunces + Inter + Mukta in
// src/assets/fonts/ and let electron-builder copy them into the packaged app
// resources. In dev, we resolve from the repo root.
//
// Per CEO plan §4.4: "The .pptx must embed font subsets for every Google Font
// used in the issue. This guarantees the file renders identically wherever it
// is opened."

export interface FontBundle {
  fontName: string;
  fontFace: "normal" | "italic" | "bold" | "bold-italic";
  path: string;
}

/**
 * Find the fonts directory across dev + packaged builds.
 * Dev: ./src/assets/fonts
 * Packaged: <resources>/fonts
 */
async function resolveFontsDir(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "src/assets/fonts"),
    path.resolve(process.cwd(), "assets/fonts"),
    process.resourcesPath
      ? path.join(process.resourcesPath, "fonts")
      : null,
  ].filter((p): p is string => !!p);

  for (const dir of candidates) {
    try {
      await fs.access(dir);
      return dir;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Return the font bundle available on disk, or [] if fonts are missing.
 * Missing fonts are NOT a fatal error — the PPTX renders with system
 * fallback (same behavior as before embedding was wired).
 */
export async function loadBundledFonts(): Promise<FontBundle[]> {
  const dir = await resolveFontsDir();
  if (!dir) return [];

  const manifest: { file: string; fontName: string; fontFace: FontBundle["fontFace"] }[] = [
    { file: "Fraunces-Regular.ttf", fontName: "Fraunces", fontFace: "normal" },
    { file: "Fraunces-Italic.ttf", fontName: "Fraunces", fontFace: "italic" },
    { file: "Inter-Regular.ttf", fontName: "Inter", fontFace: "normal" },
    { file: "Inter-Italic.ttf", fontName: "Inter", fontFace: "italic" },
    { file: "Mukta-Regular.ttf", fontName: "Mukta", fontFace: "normal" },
    { file: "Mukta-Bold.ttf", fontName: "Mukta", fontFace: "bold" },
  ];

  const bundles: FontBundle[] = [];
  for (const entry of manifest) {
    const p = path.join(dir, entry.file);
    try {
      await fs.access(p);
      bundles.push({
        fontName: entry.fontName,
        fontFace: entry.fontFace,
        path: p,
      });
    } catch {
      // skip missing files silently
    }
  }
  return bundles;
}
