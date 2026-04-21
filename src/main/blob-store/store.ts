import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { sha256Buffer, splitHash, streamToHash } from "./hash.js";
import { makeError, type StructuredError } from "@shared/errors/structured.js";

// Content-addressable blob store.
// Per CEO plan Section 18.1 + eng-plan §1: stores at
// `assets/{tenant-id}/{first-2-hash-chars}/{rest-of-hash}`.
// Dedup-by-design — writing the same bytes twice is a no-op on the second write.

export interface BlobStore {
  /** Absolute path to an existing blob, or null if not present. */
  resolve(hash: string): Promise<string | null>;
  /** Write bytes; returns the hash (newly written or existing). */
  writeBuffer(buffer: Buffer | Uint8Array): Promise<string>;
  /** Write a stream; returns the hash (newly written or existing). */
  writeStream(stream: Readable): Promise<string>;
  /** Read bytes for a given hash. Errors with blob_missing if absent. */
  readBuffer(hash: string): Promise<Buffer>;
  /** Verify stored bytes match the hash (integrity check). */
  verify(hash: string): Promise<boolean>;
  /** Return bytes size of a blob, or null if missing. */
  size(hash: string): Promise<number | null>;
}

export interface BlobStoreOptions {
  rootDir: string;
  tenantId?: string;
}

class FsBlobStore implements BlobStore {
  private readonly tenantDir: string;

  constructor(options: BlobStoreOptions) {
    const tenant = options.tenantId ?? "publisher_default";
    this.tenantDir = path.join(options.rootDir, "assets", tenant);
  }

  private pathFor(hash: string): string {
    const { prefix, rest } = splitHash(hash);
    return path.join(this.tenantDir, prefix, rest);
  }

  async resolve(hash: string): Promise<string | null> {
    const p = this.pathFor(hash);
    try {
      await fs.access(p);
      return p;
    } catch {
      return null;
    }
  }

  async writeBuffer(buffer: Buffer | Uint8Array): Promise<string> {
    const hash = sha256Buffer(buffer);
    const target = this.pathFor(hash);

    const existing = await this.resolve(hash);
    if (existing) return hash;

    await fs.mkdir(path.dirname(target), { recursive: true });

    // Atomic write: write to .tmp then rename
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, buffer);
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {
        /* ignore */
      });
      throw err;
    }

    return hash;
  }

  async writeStream(stream: Readable): Promise<string> {
    // Tee the stream: hash one copy, write the other to a temp file, then rename by hash.
    await fs.mkdir(this.tenantDir, { recursive: true });
    const tmp = path.join(
      this.tenantDir,
      `incoming-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
    );

    const hasher = createHash("sha256");
    const writer = createWriteStream(tmp);

    stream.on("data", (chunk) => hasher.update(chunk));
    await pipeline(stream, writer);

    const hash = hasher.digest("hex");
    const target = this.pathFor(hash);

    const existing = await this.resolve(hash);
    if (existing) {
      await fs.unlink(tmp).catch(() => {
        /* ignore */
      });
      return hash;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {
        /* ignore */
      });
      throw err;
    }

    return hash;
  }

  async readBuffer(hash: string): Promise<Buffer> {
    const p = this.pathFor(hash);
    try {
      return await fs.readFile(p);
    } catch {
      const structured: StructuredError = makeError("blob_missing", "error", { hash });
      throw structured;
    }
  }

  async verify(hash: string): Promise<boolean> {
    const p = await this.resolve(hash);
    if (!p) return false;
    const { createReadStream } = await import("node:fs");
    const computed = await streamToHash(createReadStream(p));
    return computed === hash.toLowerCase();
  }

  async size(hash: string): Promise<number | null> {
    const p = this.pathFor(hash);
    try {
      const stat = await fs.stat(p);
      return stat.size;
    } catch {
      return null;
    }
  }
}

export function createBlobStore(options: BlobStoreOptions): BlobStore {
  return new FsBlobStore(options);
}
