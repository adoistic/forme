// Build realistic end-to-end fixtures:
//   - 3 Wikipedia articles as clean .docx
//   - 3 sample ad images (different aspect ratios)
//   - 1 classifieds CSV
// Run: bun scripts/build-fixtures.ts
// Idempotent — skips what's already on disk.

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import sharp from "sharp";

const repoRoot = process.cwd();
const FIXTURES = path.join(repoRoot, "tests/fixtures");
const ARTICLES_DIR = path.join(FIXTURES, "articles");
const ADS_DIR = path.join(FIXTURES, "ads");
const CLASSIFIEDS_DIR = path.join(FIXTURES, "classifieds");

// 3 varied articles — short, medium-ish, longer — to exercise the builder's
// page-count range. Slugs double as filenames.
const WIKI_ARTICLES = [
  { slug: "chandrayaan-3", title: "Chandrayaan-3" },
  { slug: "typography", title: "Typography" },
  { slug: "movable-type", title: "Movable_type" },
];

async function fetchWikipediaPlainText(title: string): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(title)}&redirects=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Forme QA (https://github.com/adoistic/forme)" },
  });
  const json = (await res.json()) as {
    query: { pages: Record<string, { extract?: string; title: string }> };
  };
  const pages = Object.values(json.query.pages);
  const p = pages[0];
  if (!p || !p.extract) throw new Error(`no extract for ${title}`);
  // Trim to first ~2500 words to keep test runs fast
  const words = p.extract.split(/\s+/);
  return words.slice(0, 2500).join(" ");
}

async function plainTextToDocx(
  plain: string,
  headline: string,
  outPath: string,
  heroImagePath?: string
): Promise<void> {
  // Produce a clean HTML page with a single H1 + paragraphs, then run pandoc
  // to convert it to .docx. Result is a normal Word doc, not a markdown doc.
  const paragraphs = plain
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const heroTag = heroImagePath
    ? `<p><img src="${heroImagePath}" alt="Hero image"></p>`
    : "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(headline)}</title></head><body>
<h1>${escapeHtml(headline)}</h1>
<p><em>A Wikipedia-sourced article converted for end-to-end testing of Forme's PPTX builder.</em></p>
<p><strong>By QA Harness</strong></p>
${heroTag}
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
</body></html>`;

  const tmpHtml = outPath.replace(/\.docx$/, ".html");
  await fs.writeFile(tmpHtml, html, "utf-8");
  await new Promise<void>((resolve, reject) => {
    const p = spawn("pandoc", [tmpHtml, "-f", "html", "-t", "docx", "-o", outPath], {
      stdio: "inherit",
    });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`pandoc ${c}`))));
  });
  await fs.unlink(tmpHtml).catch(() => {});
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function makeAdImage(
  label: string,
  subtitle: string,
  w: number,
  h: number,
  bgHex: string,
  outPath: string
): Promise<void> {
  // Render a clean SVG with a solid tinted background + typography, then
  // convert to high-DPI PNG via sharp. Simulates an ad creative.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="${bgHex}"/>
  <rect x="32" y="32" width="${w - 64}" height="${h - 64}" fill="none" stroke="white" stroke-width="3"/>
  <text x="50%" y="40%" font-family="Georgia, serif" font-size="${Math.round(h / 8)}" text-anchor="middle" fill="white" font-weight="700">${escapeHtml(label)}</text>
  <text x="50%" y="58%" font-family="sans-serif" font-size="${Math.round(h / 18)}" text-anchor="middle" fill="white" opacity="0.85">${escapeHtml(subtitle)}</text>
  <text x="50%" y="${h - 48}" font-family="sans-serif" font-size="${Math.round(h / 28)}" text-anchor="middle" fill="white" opacity="0.65">SAMPLE · Forme QA</text>
</svg>`;
  await sharp(Buffer.from(svg)).png({ quality: 95 }).toFile(outPath);
}

async function main() {
  await fs.mkdir(ARTICLES_DIR, { recursive: true });
  await fs.mkdir(ADS_DIR, { recursive: true });
  await fs.mkdir(CLASSIFIEDS_DIR, { recursive: true });

  // Generate a sample hero image once — 2000×1200 landscape, the first
  // article's docx embeds it so we can exercise the hero-image path end-to-end.
  const heroImagePath = path.join(ARTICLES_DIR, "_hero.png");
  if (!(await exists(heroImagePath))) {
    await makeAdImage(
      "Chandrayaan-3",
      "On the surface. For the first time.",
      2000,
      1200,
      "#1A3A5C",
      heroImagePath
    );
    console.log(`  hero → ${heroImagePath}`);
  }

  // Articles — always rewrite so fixture fields (hero image, byline) stay in
  // sync with the latest docx layout.
  for (let i = 0; i < WIKI_ARTICLES.length; i += 1) {
    const a = WIKI_ARTICLES[i]!;
    const outPath = path.join(ARTICLES_DIR, `${a.slug}.docx`);
    console.log(`Fetching ${a.title}…`);
    try {
      const text = await fetchWikipediaPlainText(a.title);
      // Only the first article gets a hero image — keeps the test matrix
      // small while still exercising the path.
      const hero = i === 0 ? heroImagePath : undefined;
      await plainTextToDocx(text, a.title.replace(/_/g, " "), outPath, hero);
      const stat = await fs.stat(outPath);
      console.log(`  → ${outPath} (${stat.size} bytes${hero ? " — includes hero" : ""})`);
    } catch (e) {
      console.error(`  FAIL ${a.title}:`, e);
    }
  }

  // Ads — three realistic magazine ad slot sizes
  const adSpecs = [
    { file: "full-page-rust.png", w: 2480, h: 3508, bg: "#C96E4E", label: "Aurora", sub: "Jewellery you actually want to wear." },
    { file: "half-page-teal.png", w: 2480, h: 1754, bg: "#3F6F6E", label: "Fieldnotes", sub: "A weekly for people who take the long way home." },
    { file: "quarter-page-gold.png", w: 1240, h: 1754, bg: "#8A6A2A", label: "Saptahik Press", sub: "Print matters. Still. Always." },
  ];
  for (const s of adSpecs) {
    const p = path.join(ADS_DIR, s.file);
    if (await exists(p)) {
      console.log(`✓ ${p} (cached)`);
      continue;
    }
    await makeAdImage(s.label, s.sub, s.w, s.h, s.bg, p);
    const stat = await fs.stat(p);
    console.log(`  ad → ${p} (${stat.size} bytes)`);
  }

  // Classifieds — sparse-column CSV with one row per representative type.
  // Column rule (matches classified:import-csv handler):
  //   - type, language, weeks_to_run, billing_reference are reserved
  //   - any other column becomes a field on the classified, with these
  //     special-cased: age/year/kilometers as numbers, contact_phones +
  //     sender_names as comma-separated arrays.
  // Empty cells are skipped, so each row only fills the columns its type
  // actually needs. Operators can keep this in Excel — it's the same idea.
  const csvPath = path.join(CLASSIFIEDS_DIR, "sample.csv");
  // Always rewrite — schema may have changed since last gen.
  {
    const headers = [
      "type",
      "language",
      "weeks_to_run",
      "name",
      "age",
      "location",
      "religion_community",
      "education",
      "occupation",
      "contact_name",
      "contact_phones",
      "name_of_deceased",
      "date_of_death",
      "life_summary",
      "surviving_family",
      "prayer_meeting",
      "notice_type",
      "notice_text",
      "published_by",
      "date",
      "make",
      "model",
      "year",
      "kilometers",
      "fuel_type",
      "expected_price",
    ];
    const rows: string[][] = [
      [
        "matrimonial_no_photo", "en", "2",
        "Aanya Sharma", "29", "Delhi", "Hindu", "MBA Finance", "Investment banker",
        "Mrs. Sharma", "+91-98100-00000",
        "", "", "", "", "",
        "", "", "", "",
        "", "", "", "", "", "",
      ],
      [
        "obituary", "en", "1",
        "", "", "", "", "", "", "", "",
        "R. Sharma", "2026-04-18",
        "A printer, teacher, and community organizer who spent forty years at the local press.",
        "Wife Meena, two daughters, five grandchildren.",
        "Lodhi Crematorium, 23 April 2026, 11 AM.",
        "", "", "", "",
        "", "", "", "", "", "",
      ],
      [
        "public_notice", "en", "2",
        "", "", "", "", "", "", "", "",
        "", "", "", "", "",
        "name_change",
        "I, Anand Kumar Verma, son of late S. K. Verma, resident of Sector 21, Noida, have changed my name to Anand Verma. Affidavit dated 10 April 2026.",
        "Anand Verma", "2026-04-10",
        "", "", "", "", "", "",
      ],
      [
        "vehicles", "en", "2",
        "", "", "Lodhi Colony", "", "", "", "", "+91-98104-44444",
        "", "", "", "", "",
        "", "", "", "",
        "Mahindra", "XUV300", "2021", "32000", "petrol", "₹8.5 lakh, neg.",
      ],
    ];
    const csv =
      headers.join(",") +
      "\n" +
      rows
        .map((r) =>
          r
            .map((cell) =>
              /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
            )
            .join(",")
        )
        .join("\n");
    await fs.writeFile(csvPath, csv);
    console.log(`  csv → ${csvPath} (${csv.length} bytes)`);
  }

  console.log("\nfixtures ready under:", FIXTURES);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
