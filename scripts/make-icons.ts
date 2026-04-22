// Render build-resources/icon.svg to all the sizes electron-builder /
// macOS need, then build the .icns via the system iconutil.
//
// Run: bun scripts/make-icons.ts
// Output:
//   build-resources/icon.iconset/  — intermediate, kept for inspection
//   build-resources/icon.icns      — what electron-builder picks up
//   build-resources/icon-1024.png  — also kept (used as fallback + docs)

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import sharp from "sharp";

const repoRoot = process.cwd();
const RES = path.join(repoRoot, "build-resources");
const SVG = path.join(RES, "icon.svg");
const ICONSET = path.join(RES, "icon.iconset");
const ICNS = path.join(RES, "icon.icns");

// Apple HIG iconset spec — these exact filenames + sizes.
const SIZES: Array<{ name: string; px: number }> = [
  { name: "icon_16x16.png", px: 16 },
  { name: "icon_16x16@2x.png", px: 32 },
  { name: "icon_32x32.png", px: 32 },
  { name: "icon_32x32@2x.png", px: 64 },
  { name: "icon_128x128.png", px: 128 },
  { name: "icon_128x128@2x.png", px: 256 },
  { name: "icon_256x256.png", px: 256 },
  { name: "icon_256x256@2x.png", px: 512 },
  { name: "icon_512x512.png", px: 512 },
  { name: "icon_512x512@2x.png", px: 1024 },
];

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "pipe" });
    let stderr = "";
    p.stderr?.on("data", (d) => (stderr += d));
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${stderr}`))
    );
  });
}

async function main() {
  const svg = await fs.readFile(SVG);
  await fs.rm(ICONSET, { recursive: true, force: true });
  await fs.mkdir(ICONSET, { recursive: true });

  // Render every target size from the SVG. sharp uses librsvg internally
  // which honors the Fraunces font as long as it's installed on the
  // host. We installed Fraunces system-wide as part of v0.5 setup.
  for (const { name, px } of SIZES) {
    await sharp(svg, { density: 384 }) // higher density for crisp serifs
      .resize(px, px)
      .png({ compressionLevel: 9 })
      .toFile(path.join(ICONSET, name));
    process.stdout.write(`  ${name} (${px}×${px})\n`);
  }

  // Also keep a flat 1024 PNG for docs / README / web.
  await sharp(svg, { density: 384 })
    .resize(1024, 1024)
    .png({ compressionLevel: 9 })
    .toFile(path.join(RES, "icon-1024.png"));

  // Compile the iconset into an .icns via macOS iconutil.
  await run("iconutil", ["-c", "icns", ICONSET, "-o", ICNS]);

  const stat = await fs.stat(ICNS);
  console.log(`\nWrote ${path.relative(repoRoot, ICNS)} (${(stat.size / 1024).toFixed(1)} KB)`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
