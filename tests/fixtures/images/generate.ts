/**
 * Generate image test fixtures via sharp. Run once:
 *   bun run tests/fixtures/images/generate.ts
 */
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 1. A proper 300 DPI A4 image (2480x3508 px, PNG, sRGB)
  await sharp({
    create: {
      width: 2480,
      height: 3508,
      channels: 3,
      background: { r: 180, g: 100, b: 80 }, // rust-ish
    },
  })
    .png()
    .toFile(path.join(outDir, "a4-300dpi.png"));

  // 2. A low-res 90 DPI A4 image (744x1052) — should get "reject" in DPI check
  await sharp({
    create: {
      width: 744,
      height: 1052,
      channels: 3,
      background: { r: 50, g: 50, b: 50 },
    },
  })
    .png()
    .toFile(path.join(outDir, "a4-90dpi.png"));

  // 3. A 150 DPI A4 image (1240x1755) — should get "warn"
  await sharp({
    create: {
      width: 1240,
      height: 1755,
      channels: 3,
      background: { r: 120, g: 80, b: 60 },
    },
  })
    .png()
    .toFile(path.join(outDir, "a4-150dpi.png"));

  // 4. A true single-channel grayscale PNG
  await sharp({
    create: {
      width: 1000,
      height: 1400,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })
    .toColorspace("b-w")
    .png()
    .toFile(path.join(outDir, "grayscale.png"));

  // 5. A JPEG image (for re-encoding path)
  await sharp({
    create: {
      width: 2100,
      height: 2970,
      channels: 3,
      background: { r: 30, g: 150, b: 100 },
    },
  })
    .jpeg({ quality: 85 })
    .toFile(path.join(outDir, "a4-jpeg.jpg"));

  // eslint-disable-next-line no-console
  console.log("image fixtures generated");
}

await main();
