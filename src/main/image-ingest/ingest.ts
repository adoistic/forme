import sharp from "sharp";
import { makeError, type StructuredError } from "@shared/errors/structured.js";

// Image ingest per docs/eng-plan.md §1 + CEO plan Section 18 (asset management).
// Uses libvips (via sharp) for memory-safe decoding + color conversion.
// Runs in the Electron MAIN process only (native lib not renderer-compatible).

export interface IngestedImage {
  /** Original filename (for reference, not the blob identifier). */
  filename: string;
  /** Mime type of the processed image. */
  mimeType: string;
  /** Width in pixels AFTER normalization. */
  width: number;
  /** Height in pixels AFTER normalization. */
  height: number;
  /** Inferred DPI at a typical print size (assumes A4 trim 210mm). */
  dpi: number;
  /** "rgb" | "grayscale" | "cmyk-converted" (CMYK is converted to sRGB on ingest) */
  color_mode: "rgb" | "grayscale" | "cmyk-converted";
  /** Size of the normalized buffer in bytes. */
  size_bytes: number;
  /** Normalized image bytes (sRGB + possibly re-encoded). Caller writes to blob store. */
  bytes: Buffer;
  /** Warnings worth surfacing (ICC profile missing, low DPI, etc.) */
  warnings: string[];
}

export interface IngestImageOptions {
  filename: string;
  buffer: Buffer;
  /** Target print width in mm used for DPI inference. Default 210 (A4 trim width). */
  printWidthMM?: number;
  /** If set, bytes over this size error out as file_too_large. Default 50 MB. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const MM_PER_INCH = 25.4;

export async function ingestImage(options: IngestImageOptions): Promise<IngestedImage> {
  const { filename, buffer, printWidthMM = 210, maxBytes = DEFAULT_MAX_BYTES } = options;

  if (buffer.length === 0) {
    throw makeError("corrupt_image", "error", { filename, reason: "empty_buffer" });
  }

  if (buffer.length > maxBytes) {
    throw makeError("file_too_large", "warning", {
      filename,
      size: formatBytes(buffer.length),
      max: formatBytes(maxBytes),
    });
  }

  let image: sharp.Sharp;
  try {
    image = sharp(buffer, { failOn: "truncated" });
  } catch (cause: unknown) {
    throw makeError("corrupt_image", "error", { filename, reason: errorMsg(cause) });
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await image.metadata();
  } catch (cause: unknown) {
    throw makeError("corrupt_image", "error", { filename, reason: errorMsg(cause) });
  }

  const { width: origWidth, height: origHeight } = metadata;
  if (!origWidth || !origHeight) {
    throw makeError("corrupt_image", "error", { filename, reason: "no_dimensions" });
  }

  // Color mode + conversion (per CEO §18.4 — convert to sRGB on import).
  const warnings: string[] = [];
  let colorMode: IngestedImage["color_mode"] = "rgb";
  let pipeline = image;

  if (metadata.space === "cmyk") {
    colorMode = "cmyk-converted";
    pipeline = pipeline.toColorspace("srgb");
    warnings.push("Converted CMYK to sRGB on import.");
  } else if (metadata.space === "b-w" || metadata.channels === 1) {
    colorMode = "grayscale";
  }

  // Note whether an ICC profile was missing (CEO §18.4: assume sRGB).
  if (!metadata.icc) {
    warnings.push("No ICC profile found; assumed sRGB.");
  }

  // Re-encode to a consistent format. Preserve JPEG if it was JPEG (compression
  // already optimized by the operator); re-encode others to PNG for lossless.
  const outputMime =
    metadata.format === "jpeg" || metadata.format === "jpg"
      ? "image/jpeg"
      : metadata.format === "png"
        ? "image/png"
        : metadata.format === "webp"
          ? "image/webp"
          : "image/png";

  let normalized: Buffer;
  try {
    if (outputMime === "image/jpeg") {
      normalized = await pipeline.jpeg({ quality: 90 }).toBuffer();
    } else if (outputMime === "image/webp") {
      normalized = await pipeline.webp({ quality: 92 }).toBuffer();
    } else {
      normalized = await pipeline.png({ compressionLevel: 6 }).toBuffer();
    }
  } catch (cause: unknown) {
    throw makeError("corrupt_image", "error", { filename, reason: errorMsg(cause) });
  }

  // Re-read final metadata (dimensions may have shifted post-normalization)
  const finalMeta = await sharp(normalized).metadata();
  const finalWidth = finalMeta.width ?? origWidth;
  const finalHeight = finalMeta.height ?? origHeight;
  const dpi = Math.round(finalWidth / (printWidthMM / MM_PER_INCH));

  return {
    filename,
    mimeType: outputMime,
    width: finalWidth,
    height: finalHeight,
    dpi,
    color_mode: colorMode,
    size_bytes: normalized.byteLength,
    bytes: normalized,
    warnings,
  };
}

/**
 * Classify a DPI value according to the product's 300/150 thresholds.
 * Matches the ad validator in shared/schemas/ad.ts but applies to any image.
 */
export function classifyDpi(dpi: number): "ok" | "warn" | "reject" {
  if (dpi >= 299.5) return "ok";
  if (dpi >= 149.5) return "warn";
  return "reject";
}

function errorMsg(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)}KB`;
  return `${bytes}B`;
}

// Re-export StructuredError for callers wanting to narrow
export type { StructuredError };
