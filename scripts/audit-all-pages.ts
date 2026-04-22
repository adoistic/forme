// Per-page audit of the big-issue PDF render. For EVERY page, reports:
//   - body fill % (per col, average)
//   - column unevenness
//   - overflow into footer area (text past the bottom margin line)
//   - large gaps inside the body region (sign of skipped paragraphs)
//
// This is the ground-truth check: if a page looks bad to a human reader,
// it should show here. No spot-checking.

import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";

interface PageStats {
  page: number;
  type: "cover" | "ad" | "toc" | "body" | "classifieds" | "unknown";
  width: number;
  height: number;
  bodyTopFrac: number;    // top of body region, fraction of page height
  bodyBotFrac: number;    // bottom of body region (= bottom margin)
  colFill: number[];      // per-col fill ratio of body region (0..1)
  colInkPx: number[];     // per-col total inked pixels in body region
  overflowPx: number[];   // per-col pixels of ink past body bottom (footer overlap)
  largestGapPx: number[]; // per-col tallest empty band inside body region
  flags: string[];
}

const PAGE_W_INCH = 11.69; // A4 portrait height
const BODY_BOT_INCH = 10.90; // trim - marginBottom
const FOLIO_TOP_INCH = 11.30; // folio sits ~here
const LEADING_PT = 14;

async function analyze(pngPath: string, page: number): Promise<PageStats> {
  const img = sharp(pngPath).greyscale().raw();
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pxPerInch = height / PAGE_W_INCH;
  const pxPerLine = LEADING_PT * pxPerInch / 72;

  // Find first inked row in left-margin column to estimate where the
  // headline starts — anything above 0.30 height suggests a first-page layout.
  const left = Math.floor(width * 0.10);
  const right = Math.floor(width * 0.90);
  const colW = Math.floor((right - left) / 3);
  const cols = [
    { x0: left, x1: left + colW },
    { x0: left + colW, x1: left + 2 * colW },
    { x0: left + 2 * colW, x1: right },
  ];

  // Find body top: scan rows. The body top is below any header strip,
  // headline, deck, byline (first page). Heuristic: the first row in col 1
  // where the inked-row pattern becomes regular (every 14pt = body line).
  // Simpler: detect the largest inked region near the top, take its bottom.
  function rowInked(y: number, x0: number, x1: number): boolean {
    for (let x = x0; x < x1; x += 1) {
      if ((data[y * width + x] ?? 255) < 100) return true;
    }
    return false;
  }

  // Find body top — the START of the regularly-spaced body line block.
  // First-page articles have headline + deck + byline above body; those
  // are taller blocks (36pt headline) with bigger gaps. Body has a tight
  // ~14pt rhythm. Scan downward; after every contiguous inked block
  // taller than 1.6 × body line height (= a non-body block like headline
  // or deck), update bodyTop to just past it. Stop when we hit a block
  // that's small (a body line — first one) AND the next several rows
  // also follow the body rhythm.
  let bodyTop = Math.floor(height * 0.05);
  let y = Math.floor(height * 0.04);
  while (y < height * 0.4) {
    // Skip whitespace
    while (y < height * 0.4 && !rowInked(y, cols[0]!.x0, cols[0]!.x1)) y += 1;
    if (y >= height * 0.4) break;
    // Measure inked block height
    const blockStart = y;
    while (y < height && rowInked(y, cols[0]!.x0, cols[0]!.x1)) y += 1;
    const blockH = y - blockStart;
    if (blockH > pxPerLine * 1.6) {
      // Tall block — headline / deck / heading. Continue past it.
      bodyTop = y;
    } else {
      // Body-line-sized block — this is body. Use blockStart as top.
      bodyTop = blockStart;
      break;
    }
  }

  // Body bottom: pixel at BODY_BOT_INCH
  const bodyBot = Math.floor(height * (BODY_BOT_INCH / PAGE_W_INCH));
  const folioTop = Math.floor(height * (FOLIO_TOP_INCH / PAGE_W_INCH));

  const colFill: number[] = [];
  const colInkPx: number[] = [];
  const overflowPx: number[] = [];
  const largestGapPx: number[] = [];

  for (const c of cols) {
    let inkedRows = 0;
    let firstInked = -1;
    let lastInked = -1;
    let currentGap = 0;
    let maxGap = 0;
    for (let y = bodyTop; y < bodyBot; y += 1) {
      if (rowInked(y, c.x0, c.x1)) {
        inkedRows += 1;
        if (firstInked < 0) firstInked = y;
        lastInked = y;
        currentGap = 0;
      } else if (firstInked >= 0) {
        currentGap += 1;
        if (currentGap > maxGap) maxGap = currentGap;
      }
    }
    const span = lastInked - firstInked;
    const colHeight = bodyBot - bodyTop;
    colFill.push(span > 0 ? span / colHeight : 0);
    colInkPx.push(inkedRows);
    largestGapPx.push(maxGap);

    // Overflow: ink past body bottom but before folio area
    let overflow = 0;
    for (let y = bodyBot; y < folioTop; y += 1) {
      if (rowInked(y, c.x0, c.x1)) overflow += 1;
    }
    overflowPx.push(overflow);
  }

  // Page type heuristic
  const avgFill = (colFill[0]! + colFill[1]! + colFill[2]!) / 3;
  const totalInk = colInkPx[0]! + colInkPx[1]! + colInkPx[2]!;
  let type: PageStats["type"] = "body";
  if (totalInk < 100) type = "cover";
  if (avgFill > 0.97 && colFill[0]! > 0.97 && colFill[1]! > 0.97 && colFill[2]! > 0.97) {
    type = "ad"; // full-page solid block
  }

  const flags: string[] = [];
  // Real overflow (>1 line into footer area)
  if (overflowPx.some((o) => o > pxPerLine * 1)) flags.push("overflow");
  // Body region under-filled (< 70%)
  if (avgFill < 0.70 && type === "body") flags.push("under-filled");
  // Cols uneven (>20% spread)
  if (Math.max(...colFill) - Math.min(...colFill) > 0.20) flags.push("uneven");
  // Large gap inside body region (>5 line heights of empty space mid-column)
  if (largestGapPx.some((g) => g > pxPerLine * 5)) flags.push("internal-gap");

  return {
    page,
    type,
    width,
    height,
    bodyTopFrac: bodyTop / height,
    bodyBotFrac: bodyBot / height,
    colFill,
    colInkPx,
    overflowPx,
    largestGapPx,
    flags,
  };
}

async function main() {
  const dir = process.argv[2] ?? "test-results/big-issue";
  const files = (await fs.readdir(dir))
    .filter((f) => /^page-\d+\.png$/.test(f))
    .sort();

  console.log(
    "page  type  bodyTop  fill   col1   col2   col3   ovf1  ovf2  ovf3  gap1  gap2  gap3  flags"
  );
  console.log(
    "----  ----  -------  -----  -----  -----  -----  ----  ----  ----  ----  ----  ----  -----"
  );

  let pageStats: PageStats[] = [];
  for (const f of files) {
    const m = f.match(/^page-(\d+)\.png$/);
    const pageNum = m && m[1] ? Number.parseInt(m[1], 10) : 0;
    const s = await analyze(path.join(dir, f), pageNum);
    pageStats.push(s);
    const fillPct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;
    const px3 = (n: number) => String(n).padStart(4);
    console.log(
      `${String(s.page).padStart(4)}  ${s.type.padEnd(4)}  ${(s.bodyTopFrac * 100).toFixed(0).padStart(3)}%    ` +
      `${fillPct((s.colFill[0]! + s.colFill[1]! + s.colFill[2]!) / 3)}  ` +
      `${fillPct(s.colFill[0]!)}  ${fillPct(s.colFill[1]!)}  ${fillPct(s.colFill[2]!)}  ` +
      `${px3(s.overflowPx[0]!)}  ${px3(s.overflowPx[1]!)}  ${px3(s.overflowPx[2]!)}  ` +
      `${px3(s.largestGapPx[0]!)}  ${px3(s.largestGapPx[1]!)}  ${px3(s.largestGapPx[2]!)}  ` +
      s.flags.join(",")
    );
  }

  // Aggregate report
  console.log("\n=== Summary ===");
  const bodyPages = pageStats.filter((p) => p.type === "body");
  const issues = {
    overflow: pageStats.filter((p) => p.flags.includes("overflow")),
    underFilled: bodyPages.filter((p) => p.flags.includes("under-filled")),
    uneven: pageStats.filter((p) => p.flags.includes("uneven")),
    internalGap: pageStats.filter((p) => p.flags.includes("internal-gap")),
  };
  console.log(`Total pages: ${pageStats.length}`);
  console.log(`  body pages: ${bodyPages.length}`);
  console.log(`  overflow into footer: ${issues.overflow.length} → pages [${issues.overflow.map((p) => p.page).join(",")}]`);
  console.log(`  under-filled body (<70%): ${issues.underFilled.length} → pages [${issues.underFilled.map((p) => p.page).join(",")}]`);
  console.log(`  uneven cols (>20% spread): ${issues.uneven.length} → pages [${issues.uneven.map((p) => p.page).join(",")}]`);
  console.log(`  internal mid-col gap (>5 lines empty): ${issues.internalGap.length} → pages [${issues.internalGap.map((p) => p.page).join(",")}]`);

  const avgFillBody = bodyPages.reduce((a, p) => a + (p.colFill[0]! + p.colFill[1]! + p.colFill[2]!) / 3, 0) / bodyPages.length;
  console.log(`  avg body fill across body pages: ${(avgFillBody * 100).toFixed(0)}%`);
}

void main();
