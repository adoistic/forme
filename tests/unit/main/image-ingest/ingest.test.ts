import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestImage, classifyDpi } from "../../../../src/main/image-ingest/ingest.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/images"
);

async function readFixture(name: string): Promise<Buffer> {
  return fs.readFile(path.join(fixturesDir, name));
}

describe("classifyDpi", () => {
  test("300+ DPI is ok", () => {
    expect(classifyDpi(300)).toBe("ok");
    expect(classifyDpi(400)).toBe("ok");
  });
  test("2480 px / A4 ≈ 299.97 DPI rounds to ok", () => {
    expect(classifyDpi(299.97)).toBe("ok");
  });
  test("150-299 DPI is warn", () => {
    expect(classifyDpi(150)).toBe("warn");
    expect(classifyDpi(200)).toBe("warn");
    expect(classifyDpi(299)).toBe("warn");
  });
  test("<150 DPI is reject", () => {
    expect(classifyDpi(149)).toBe("reject");
    expect(classifyDpi(72)).toBe("reject");
  });
});

describe("ingestImage", () => {
  test("300-DPI A4 PNG ingests as RGB with ~300 DPI", async () => {
    const buf = await readFixture("a4-300dpi.png");
    const result = await ingestImage({ filename: "a4-300dpi.png", buffer: buf });

    expect(result.width).toBe(2480);
    expect(result.height).toBe(3508);
    expect(result.color_mode).toBe("rgb");
    expect(result.mimeType).toBe("image/png");
    expect(result.dpi).toBeGreaterThanOrEqual(299);
    expect(result.dpi).toBeLessThanOrEqual(301);
    expect(classifyDpi(result.dpi)).toBe("ok");
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  test("90-DPI A4 PNG classifies as reject", async () => {
    const buf = await readFixture("a4-90dpi.png");
    const result = await ingestImage({ filename: "a4-90dpi.png", buffer: buf });
    expect(classifyDpi(result.dpi)).toBe("reject");
  });

  test("150-DPI A4 PNG classifies as warn", async () => {
    const buf = await readFixture("a4-150dpi.png");
    const result = await ingestImage({ filename: "a4-150dpi.png", buffer: buf });
    expect(classifyDpi(result.dpi)).toBe("warn");
  });

  test("JPEG round-trips as JPEG", async () => {
    const buf = await readFixture("a4-jpeg.jpg");
    const result = await ingestImage({ filename: "a4-jpeg.jpg", buffer: buf });
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(2100);
    expect(result.height).toBe(2970);
  });

  test("grayscale image is detected", async () => {
    const buf = await readFixture("grayscale.png");
    const result = await ingestImage({ filename: "grayscale.png", buffer: buf });
    expect(result.color_mode).toBe("grayscale");
  });

  test("empty buffer throws corrupt_image", async () => {
    await expect(
      ingestImage({ filename: "empty.png", buffer: Buffer.alloc(0) })
    ).rejects.toMatchObject({ code: "corrupt_image" });
  });

  test("garbage bytes throw corrupt_image", async () => {
    await expect(
      ingestImage({ filename: "garbage.png", buffer: Buffer.from("not an image") })
    ).rejects.toMatchObject({ code: "corrupt_image" });
  });

  test("oversize buffer throws file_too_large with size in context", async () => {
    const bigBuf = Buffer.alloc(11 * 1024 * 1024); // 11 MB
    await expect(
      ingestImage({
        filename: "huge.png",
        buffer: bigBuf,
        maxBytes: 10 * 1024 * 1024,
      })
    ).rejects.toMatchObject({
      code: "file_too_large",
      context: expect.objectContaining({
        filename: "huge.png",
      }),
    });
  });

  test("warnings include missing ICC profile for sharp-generated fixtures", async () => {
    const buf = await readFixture("a4-300dpi.png");
    const result = await ingestImage({ filename: "a4-300dpi.png", buffer: buf });
    // Sharp's `create` channel doesn't embed an ICC profile, so we expect the warning
    expect(result.warnings.some((w) => /ICC/i.test(w))).toBe(true);
  });

  test("custom printWidthMM changes inferred DPI", async () => {
    const buf = await readFixture("a4-300dpi.png"); // 2480 px wide
    // At 148mm (A5), same 2480px = ~425 DPI
    const result = await ingestImage({
      filename: "a.png",
      buffer: buf,
      printWidthMM: 148,
    });
    expect(result.dpi).toBeGreaterThan(400);
  });
});
