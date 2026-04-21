import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";

// SHA-256 hashing for the content-addressable blob store.
// See docs/eng-plan.md §1 ("Hashing: Node crypto") and CEO plan Section 1.2
// "Asset store: Content-addressable file store on disk, named by SHA-256 hash".

/**
 * Hash a Buffer synchronously.
 * Fast path for already-in-memory data (image uploads, small files).
 */
export function sha256Buffer(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Hash a file on disk by streaming — does NOT load it all into memory.
 * Use for large files (multi-megabyte images, docx files).
 */
export async function sha256File(filePath: string): Promise<string> {
  return streamToHash(createReadStream(filePath));
}

/**
 * Hash an arbitrary Readable stream.
 */
export function streamToHash(stream: Readable): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (err) => reject(err));
  });
}

/**
 * Split a hex hash into `{prefix, rest}` for blob path layout.
 * Matches git's loose object layout: `assets/{tenant-id}/{aa}/{bbbb...}`.
 */
export function splitHash(hash: string): { prefix: string; rest: string } {
  if (hash.length < 3 || !/^[0-9a-f]+$/i.test(hash)) {
    throw new Error(`invalid sha256 hash: ${hash}`);
  }
  return {
    prefix: hash.slice(0, 2).toLowerCase(),
    rest: hash.slice(2).toLowerCase(),
  };
}
