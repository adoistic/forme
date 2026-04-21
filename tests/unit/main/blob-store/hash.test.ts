import { describe, expect, test } from "vitest";
import { sha256Buffer, splitHash, streamToHash } from "../../../../src/main/blob-store/hash.js";
import { Readable } from "node:stream";

describe("sha256Buffer", () => {
  test("matches canonical empty-string hash", () => {
    // Known: sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const h = sha256Buffer(Buffer.alloc(0));
    expect(h).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("matches canonical 'hello' hash", () => {
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const h = sha256Buffer(Buffer.from("hello"));
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("accepts Uint8Array", () => {
    const bytes = new Uint8Array([0x68, 0x69]); // "hi"
    const h = sha256Buffer(bytes);
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different inputs produce different hashes", () => {
    const a = sha256Buffer(Buffer.from("a"));
    const b = sha256Buffer(Buffer.from("b"));
    expect(a).not.toBe(b);
  });
});

describe("splitHash", () => {
  test("splits canonical hash into {prefix:2, rest:62}", () => {
    const h = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const { prefix, rest } = splitHash(h);
    expect(prefix).toBe("e3");
    expect(rest).toBe("b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(prefix.length + rest.length).toBe(64);
  });

  test("normalizes uppercase to lowercase", () => {
    const h = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
    const { prefix, rest } = splitHash(h);
    expect(prefix).toBe("e3");
    expect(rest).toBe("b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("rejects malformed hashes", () => {
    expect(() => splitHash("xyz")).toThrow(/invalid sha256 hash/);
    expect(() => splitHash("")).toThrow();
    expect(() => splitHash("not-hex-characters-but-long-enough-string-here")).toThrow();
  });
});

describe("streamToHash", () => {
  test("hashes a single-chunk stream", async () => {
    const s = Readable.from([Buffer.from("hello")]);
    const h = await streamToHash(s);
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("hashes a multi-chunk stream consistently", async () => {
    const s = Readable.from([Buffer.from("hel"), Buffer.from("lo")]);
    const h = await streamToHash(s);
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("propagates stream errors", async () => {
    const s = new Readable({
      read() {
        this.destroy(new Error("boom"));
      },
    });
    await expect(streamToHash(s)).rejects.toThrow("boom");
  });
});
