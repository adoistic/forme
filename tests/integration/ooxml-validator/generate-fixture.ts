/**
 * Generate a minimal valid PPTX fixture for the OOXML validator tests.
 * Run once: bun run tests/integration/ooxml-validator/generate-fixture.ts
 */
import pptxgen from "pptxgenjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const outDir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  const slide = pres.addSlide();
  slide.addText("Forme validator smoke test", {
    x: 1,
    y: 1,
    w: 8,
    h: 1,
    fontSize: 32,
    fontFace: "Helvetica",
  });
  slide.addText("If LibreOffice opens this, the OOXML validator passes.", {
    x: 1,
    y: 2.5,
    w: 8,
    h: 1,
    fontSize: 16,
    fontFace: "Helvetica",
  });

  const outPath = path.join(outDir, "smoke.pptx");
  await pres.writeFile({ fileName: outPath });
  const stat = await fs.stat(outPath);
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath} (${stat.size} bytes)`);
}

await main();
