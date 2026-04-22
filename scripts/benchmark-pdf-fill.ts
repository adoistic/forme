// Benchmark each page in the big-issue PDF: count the white-pixel rows
// in each column to estimate the fill ratio. Outputs a per-page table
// showing how much of each column is body text vs empty space.
//
// Usage: bun scripts/benchmark-pdf-fill.ts <png-dir>
//
// Reads page-NN.png from the given directory. Returns:
//   pageNum  fill%   col1%   col2%   col3%   issues

import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";

interface PageStats {
  page: number;
  width: number;
  height: number;
  fillRatio: number;
  colFillRatios: number[];
  flags: string[];
}

async function analyzePage(pngPath: string, page: number): Promise<PageStats> {
  const img = sharp(pngPath).greyscale().raw();
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  // Margins to skip (folios, headers). 8% top, 8% bottom, 8% sides.
  const top = Math.floor(height * 0.08);
  const bot = Math.floor(height * 0.92);
  const left = Math.floor(width * 0.08);
  const right = Math.floor(width * 0.92);

  // 3-col split — body region only.
  const innerW = right - left;
  const colW = Math.floor(innerW / 3);
  const cols = [
    { x0: left, x1: left + colW },
    { x0: left + colW, x1: left + 2 * colW },
    { x0: left + 2 * colW, x1: right },
  ];

  // Count rows that have any non-white pixel in the col band.
  // Threshold: pixel < 200 = "ink".
  const colRowCounts: number[] = [0, 0, 0];
  const colTotal = bot - top;
  for (const [i, c] of cols.entries()) {
    let inkRows = 0;
    for (let y = top; y < bot; y += 1) {
      let hasInk = false;
      for (let x = c.x0; x < c.x1; x += 1) {
        const px = data[y * width + x] ?? 255;
        if (px < 200) {
          hasInk = true;
          break;
        }
      }
      if (hasInk) inkRows += 1;
    }
    colRowCounts[i] = inkRows / colTotal;
  }

  const fillRatio = (colRowCounts[0]! + colRowCounts[1]! + colRowCounts[2]!) / 3;

  // Flags: column imbalance, severe under-fill.
  const flags: string[] = [];
  const max = Math.max(...colRowCounts);
  const min = Math.min(...colRowCounts);
  if (max - min > 0.15) flags.push("uneven");
  if (fillRatio < 0.55) flags.push("under-filled");
  if (colRowCounts.some((r) => r < 0.4)) flags.push("col-empty");

  return {
    page,
    width,
    height,
    fillRatio,
    colFillRatios: colRowCounts,
    flags,
  };
}

async function main() {
  const dir = process.argv[2] ?? "test-results/big-issue";
  const files = (await fs.readdir(dir)).filter((f) => /^page-\d+\.png$/.test(f)).sort();

  console.log("page    fill   col1   col2   col3   flags");
  console.log("----   -----  -----  -----  -----  -----");

  let totalUnder = 0;
  let totalUneven = 0;
  for (const f of files) {
    const m = f.match(/^page-(\d+)\.png$/);
    const pageNum = m && m[1] ? Number.parseInt(m[1], 10) : 0;
    const s = await analyzePage(path.join(dir, f), pageNum);
    const fmt = (n: number): string => (n * 100).toFixed(0).padStart(4) + "%";
    console.log(
      `${String(s.page).padStart(4)}  ${fmt(s.fillRatio)}  ${fmt(s.colFillRatios[0]!)}  ${fmt(s.colFillRatios[1]!)}  ${fmt(s.colFillRatios[2]!)}  ${s.flags.join(",")}`
    );
    if (s.flags.includes("under-filled")) totalUnder += 1;
    if (s.flags.includes("uneven")) totalUneven += 1;
  }

  console.log("\nSummary:");
  console.log(`  pages: ${files.length}`);
  console.log(`  under-filled (<55% fill): ${totalUnder}`);
  console.log(`  uneven cols (>15% spread): ${totalUneven}`);
}

void main();
