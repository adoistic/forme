import { describe, expect, test, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createBlobStore, type BlobStore } from "../../../../src/main/blob-store/store.js";
import { sha256Buffer } from "../../../../src/main/blob-store/hash.js";

async function tempDir(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "forme-blob-test-"));
  return base;
}

describe("BlobStore", () => {
  let rootDir: string;
  let store: BlobStore;

  beforeEach(async () => {
    rootDir = await tempDir();
    store = createBlobStore({ rootDir });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  test("writeBuffer returns a stable hash matching sha256Buffer", async () => {
    const bytes = Buffer.from("hello world");
    const expected = sha256Buffer(bytes);
    const got = await store.writeBuffer(bytes);
    expect(got).toBe(expected);
  });

  test("written blob is retrievable by hash", async () => {
    const bytes = Buffer.from("magazine content");
    const hash = await store.writeBuffer(bytes);
    const retrieved = await store.readBuffer(hash);
    expect(retrieved.equals(bytes)).toBe(true);
  });

  test("writeBuffer is deduplication-by-design", async () => {
    const bytes = Buffer.from("repeat me");
    const h1 = await store.writeBuffer(bytes);
    const h2 = await store.writeBuffer(bytes);
    expect(h1).toBe(h2);
    // Only one physical file should exist for this hash
    const resolved = await store.resolve(h1);
    expect(resolved).toBeTruthy();
  });

  test("writeStream hashes while writing", async () => {
    const bytes = Buffer.from("stream contents!");
    const stream = Readable.from([bytes]);
    const hash = await store.writeStream(stream);
    expect(hash).toBe(sha256Buffer(bytes));
    const retrieved = await store.readBuffer(hash);
    expect(retrieved.equals(bytes)).toBe(true);
  });

  test("writeStream deduplicates on second write", async () => {
    const bytes = Buffer.from("same bytes via stream");
    const h1 = await store.writeStream(Readable.from([bytes]));
    const h2 = await store.writeStream(Readable.from([bytes]));
    expect(h1).toBe(h2);
  });

  test("resolve returns null for missing hash", async () => {
    const p = await store.resolve(
      "0000000000000000000000000000000000000000000000000000000000000000"
    );
    expect(p).toBeNull();
  });

  test("readBuffer throws blob_missing StructuredError", async () => {
    await expect(
      store.readBuffer("1111111111111111111111111111111111111111111111111111111111111111")
    ).rejects.toMatchObject({ code: "blob_missing" });
  });

  test("verify returns true for intact blob", async () => {
    const hash = await store.writeBuffer(Buffer.from("intact data"));
    expect(await store.verify(hash)).toBe(true);
  });

  test("verify returns false for tampered blob", async () => {
    const hash = await store.writeBuffer(Buffer.from("original"));
    const blobPath = await store.resolve(hash);
    expect(blobPath).toBeTruthy();
    // Tamper
    await fs.writeFile(blobPath!, "tampered");
    expect(await store.verify(hash)).toBe(false);
  });

  test("verify returns false for missing hash", async () => {
    expect(
      await store.verify("2222222222222222222222222222222222222222222222222222222222222222")
    ).toBe(false);
  });

  test("size returns byte length for existing blob", async () => {
    const bytes = Buffer.from("exactly 20 chars ok!");
    expect(bytes.length).toBe(20);
    const hash = await store.writeBuffer(bytes);
    expect(await store.size(hash)).toBe(20);
  });

  test("size returns null for missing blob", async () => {
    expect(
      await store.size("3333333333333333333333333333333333333333333333333333333333333333")
    ).toBeNull();
  });

  test("tenant isolation — default tenant + custom tenant don't collide", async () => {
    const customTenant = createBlobStore({ rootDir, tenantId: "publisher_two" });
    const bytes = Buffer.from("shared content");
    const h1 = await store.writeBuffer(bytes);
    const h2 = await customTenant.writeBuffer(bytes);
    expect(h1).toBe(h2); // same bytes, same hash
    // But the physical files are at different tenant paths
    const p1 = await store.resolve(h1);
    const p2 = await customTenant.resolve(h2);
    expect(p1).toBeTruthy();
    expect(p2).toBeTruthy();
    expect(p1).not.toBe(p2);
    expect(p1).toContain("publisher_default");
    expect(p2).toContain("publisher_two");
  });

  test("blob path matches assets/{tenant}/{aa}/{rest} layout", async () => {
    const bytes = Buffer.from("layout check");
    const hash = await store.writeBuffer(bytes);
    const resolved = await store.resolve(hash);
    expect(resolved).toBeTruthy();
    // assets / publisher_default / aa / rest-of-hash
    expect(resolved).toMatch(
      new RegExp(`assets/publisher_default/${hash.slice(0, 2)}/${hash.slice(2)}$`)
    );
  });
});
