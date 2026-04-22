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

// 6 varied Wikipedia articles to exercise the builder's templates +
// page-count range. Each gets a different content_type + hero so the
// export demonstrates the template selection rules.
//
// `heroSeed` is the Lorem Picsum seed used to fetch a deterministic
// landscape photo. Set null to skip a hero (text-only feature).
// `credit` is the photographer name shown beneath the hero image.
interface WikiArticleSpec {
  slug: string;
  title: string;
  contentType: "Article" | "Photo Essay" | "Interview" | "Opinion" | "Brief" | "Letter";
  heroSeed: string | null;
  credit: string;
  caption: string;
  /** "en" → en.wikipedia.org; "hi" → hi.wikipedia.org. */
  wiki?: "en" | "hi";
  /** Optional second-language paragraphs appended to body for bilingual demo. */
  bilingualPair?: { wiki: "en" | "hi"; title: string; paragraphs: number };
  /** Force the body's primary language (otherwise auto-detected). */
  language?: "en" | "hi" | "bilingual";
  byline?: string;
  deck?: string;
}

const WIKI_ARTICLES: WikiArticleSpec[] = [
  {
    slug: "chandrayaan-3",
    title: "Chandrayaan-3",
    contentType: "Photo Essay",
    heroSeed: "forme-moon",
    credit: "NASA / Public Domain",
    caption: "The lunar south pole — terrain that defied every previous landing attempt.",
  },
  {
    slug: "typography",
    title: "Typography",
    contentType: "Article",
    heroSeed: null,
    credit: "",
    caption: "",
  },
  {
    slug: "movable-type",
    title: "Movable_type",
    contentType: "Article",
    heroSeed: "forme-press",
    credit: "Lorem Picsum",
    caption: "A working letterpress, still in commercial use in 2024.",
  },
  {
    slug: "monsoon-mumbai",
    title: "Monsoon_of_South_Asia",
    contentType: "Photo Essay",
    heroSeed: "forme-monsoon",
    credit: "Lorem Picsum",
    caption: "First rain of the season, Mumbai.",
  },
  {
    slug: "nilgiri-railway",
    title: "Nilgiri_Mountain_Railway",
    contentType: "Article",
    heroSeed: "forme-rails",
    credit: "Lorem Picsum",
    caption: "The blue mountains, viewed from the rack-and-pinion line.",
  },
  {
    slug: "ladakh-feature",
    title: "Ladakh",
    contentType: "Photo Essay",
    heroSeed: "forme-ladakh",
    credit: "Lorem Picsum",
    caption: "High-altitude desert. The light at 3,500m never quite finishes settling.",
  },
  // Hindi-only article from hi.wikipedia.org. Mukta + Devanagari rendering.
  {
    slug: "kabir-hindi",
    title: "कबीर",
    contentType: "Article",
    heroSeed: null,
    credit: "",
    caption: "",
    wiki: "hi",
    language: "hi",
    byline: "लेखक — क्यूए परीक्षक",
    deck: "एक संत-कवि का जीवन और काव्य।",
  },
  // Bilingual article (English headline + body that mixes English Wikipedia
  // intro with a Hindi Wikipedia paragraph). Forces the parser's language
  // detector to "bilingual" and the exporter still uses Fraunces for body
  // since "bilingual" routes to Latin font.
  {
    slug: "delhi-bilingual",
    title: "Delhi",
    contentType: "Article",
    heroSeed: null,
    credit: "",
    caption: "",
    bilingualPair: { wiki: "hi", title: "दिल्ली", paragraphs: 4 },
    language: "bilingual",
    byline: "By QA Harness · क्यूए परीक्षक",
    deck: "A bilingual feature: English Wikipedia introduction followed by a Hindi Wikipedia passage on the same subject.",
  },
];

async function fetchWikipediaPlainText(
  title: string,
  wiki: "en" | "hi" = "en",
  maxWords = 2500
): Promise<string> {
  const host = `${wiki}.wikipedia.org`;
  const url = `https://${host}/w/api.php?format=json&action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(title)}&redirects=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Forme QA (https://github.com/adoistic/forme)" },
  });
  const json = (await res.json()) as {
    query: { pages: Record<string, { extract?: string; title: string }> };
  };
  const pages = Object.values(json.query.pages);
  const p = pages[0];
  if (!p || !p.extract) throw new Error(`no extract for ${wiki}:${title}`);
  // Trim to keep test runs fast
  const words = p.extract.split(/\s+/);
  return words.slice(0, maxWords).join(" ");
}

async function plainTextToDocx(
  plain: string,
  headline: string,
  outPath: string,
  options?: {
    heroImagePath?: string;
    deck?: string;
    byline?: string;
    contentType?: string;
  }
): Promise<void> {
  // Produce a clean HTML page with a single H1 + paragraphs, then run pandoc
  // to convert it to .docx. Result is a normal Word doc, not a markdown doc.
  let paragraphs = plain
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Drop any leading paragraph that exactly matches the headline —
  // Wikipedia plaintext extracts often start with the article title
  // repeated. Without this, the title shows up both as the H1 AND as
  // the first body paragraph after extraction.
  while (
    paragraphs.length > 0 &&
    paragraphs[0]!.replace(/\s+/g, " ").trim() === headline.replace(/\s+/g, " ").trim()
  ) {
    paragraphs.shift();
  }
  const heroTag = options?.heroImagePath
    ? `<p><img src="${options.heroImagePath}" alt="Hero image"></p>`
    : "";
  const deck =
    options?.deck ??
    "A Wikipedia-sourced article converted for end-to-end testing of Forme's PPTX builder.";
  const byline = options?.byline ?? "By QA Harness";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(headline)}</title></head><body>
<h1>${escapeHtml(headline)}</h1>
<p><em>${escapeHtml(deck)}</em></p>
<p><strong>${escapeHtml(byline)}</strong></p>
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

/**
 * Fetch a deterministic photo from Lorem Picsum (real Unsplash photos
 * served via a free, no-auth proxy). Same seed → same photo every time
 * so test outputs stay reproducible.
 */
async function fetchPicsumPhoto(
  seed: string,
  width: number,
  height: number,
  outPath: string
): Promise<void> {
  if (await exists(outPath)) {
    console.log(`✓ ${outPath} (cached)`);
    return;
  }
  const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`picsum ${seed} ${width}×${height} → ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
  console.log(`  picsum → ${outPath} (${buf.length} bytes)`);
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

  // Real Unsplash hero photos via Lorem Picsum (deterministic by seed).
  // These get embedded into the article's docx via plainTextToDocx; the
  // article-import handler extracts them into the blob store, and the
  // export handler renders them as the hero on page 1.
  for (const a of WIKI_ARTICLES) {
    if (!a.heroSeed) continue;
    const heroPath = path.join(ARTICLES_DIR, `_hero-${a.slug}.jpg`);
    await fetchPicsumPhoto(a.heroSeed, 2000, 1200, heroPath);
  }

  // Cover photo for the issue cover page — a wide, evocative shot.
  const coverPath = path.join(ARTICLES_DIR, "_cover.jpg");
  await fetchPicsumPhoto("forme-cover", 2400, 1500, coverPath);

  // Articles — always rewrite so fixture fields (hero, byline, contentType)
  // stay in sync with the latest fixture spec.
  for (let i = 0; i < WIKI_ARTICLES.length; i += 1) {
    const a = WIKI_ARTICLES[i]!;
    const outPath = path.join(ARTICLES_DIR, `${a.slug}.docx`);
    console.log(`Fetching ${a.title}…`);
    try {
      const wiki = a.wiki ?? "en";
      let text = await fetchWikipediaPlainText(a.title, wiki);
      // Bilingual: append a chunk from the paired language Wikipedia
      if (a.bilingualPair) {
        const otherText = await fetchWikipediaPlainText(
          a.bilingualPair.title,
          a.bilingualPair.wiki,
          400
        );
        // Take just N paragraphs from the bilingual pair for a clean mix
        const otherParas = otherText
          .split(/\n\s*\n/)
          .slice(0, a.bilingualPair.paragraphs)
          .join("\n\n");
        text = `${text}\n\n${otherParas}`;
      }
      const heroPath = a.heroSeed ? path.join(ARTICLES_DIR, `_hero-${a.slug}.jpg`) : undefined;
      const deck =
        a.deck ??
        (a.caption ||
          "A Wikipedia-sourced article converted for end-to-end testing of Forme's PPTX builder.");
      const byline = a.byline ?? "By QA Harness";
      await plainTextToDocx(text, a.title.replace(/_/g, " "), outPath, {
        ...(heroPath ? { heroImagePath: heroPath } : {}),
        deck,
        byline,
        contentType: a.contentType,
      });
      const stat = await fs.stat(outPath);
      console.log(
        `  → ${outPath} (${stat.size} bytes${heroPath ? " — w/ hero" : ""}${a.wiki === "hi" ? " — hi" : ""}${a.bilingualPair ? " — bilingual" : ""})`
      );
    } catch (e) {
      console.error(`  FAIL ${a.title}:`, e);
    }
  }

  // Portrait headshots for the matrimonial classifieds (Lorem Picsum
  // serves real Unsplash photos; we use square crops since the matrimonial
  // entry frames the photo in a circle).
  const PORTRAITS_DIR = path.join(FIXTURES, "portraits");
  await fs.mkdir(PORTRAITS_DIR, { recursive: true });
  for (const seed of ["matri-aanya", "matri-rohan", "matri-sara", "matri-daniel"]) {
    await fetchPicsumPhoto(seed, 600, 600, path.join(PORTRAITS_DIR, `${seed}.jpg`));
  }

  // Ads — three realistic magazine ad slot sizes
  const adSpecs = [
    {
      file: "full-page-rust.png",
      w: 2480,
      h: 3508,
      bg: "#C96E4E",
      label: "Aurora",
      sub: "Jewellery you actually want to wear.",
    },
    {
      file: "half-page-teal.png",
      w: 2480,
      h: 1754,
      bg: "#3F6F6E",
      label: "Fieldnotes",
      sub: "A weekly for people who take the long way home.",
    },
    {
      file: "quarter-page-gold.png",
      w: 1240,
      h: 1754,
      bg: "#8A6A2A",
      label: "Saptahik Press",
      sub: "Print matters. Still. Always.",
    },
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
      "photo_path",
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
      "occasion_type",
      "recipient_name",
      "message_text",
      "sender_names",
      "make",
      "model",
      "year",
      "kilometers",
      "fuel_type",
      "expected_price",
    ];
    // Indices for column lookup so the rows below stay readable.
    const idx = (k: string): number => headers.indexOf(k);
    const make = (cells: Record<string, string>): string[] => {
      const row = new Array(headers.length).fill("");
      for (const [k, v] of Object.entries(cells)) {
        const i = idx(k);
        if (i >= 0) row[i] = v;
      }
      return row;
    };
    const portraitDir = path.join(FIXTURES, "portraits");
    const rows: string[][] = [
      // Matrimonials with real Unsplash portraits via photo_path
      make({
        type: "matrimonial_with_photo",
        language: "en",
        weeks_to_run: "2",
        photo_path: path.join(portraitDir, "matri-aanya.jpg"),
        name: "Aanya Sharma",
        age: "29",
        location: "Delhi",
        religion_community: "Hindu",
        education: "MBA Finance",
        occupation: "Investment banker",
        contact_name: "Mrs. Sharma",
        contact_phones: "+91-98100-00000",
      }),
      make({
        type: "matrimonial_with_photo",
        language: "en",
        weeks_to_run: "2",
        photo_path: path.join(portraitDir, "matri-rohan.jpg"),
        name: "Rohan Iyer",
        age: "32",
        location: "Bengaluru",
        religion_community: "Hindu Iyer",
        education: "MS Computer Science",
        occupation: "Senior software engineer",
        contact_name: "Mr. Iyer",
        contact_phones: "+91-98101-23456",
      }),
      make({
        type: "matrimonial_no_photo",
        language: "en",
        weeks_to_run: "1",
        name: "Sara Khan",
        age: "27",
        location: "Hyderabad",
        religion_community: "Sunni Muslim",
        education: "MD Pediatrics",
        occupation: "Doctor (Apollo)",
        contact_name: "Mr. Khan",
        contact_phones: "+91-98102-34567",
      }),
      make({
        type: "matrimonial_no_photo",
        language: "en",
        weeks_to_run: "1",
        name: "Daniel Mathew",
        age: "30",
        location: "Kochi",
        religion_community: "Syrian Christian",
        education: "B.Tech, MBA",
        occupation: "Family business",
        contact_name: "Mr. Mathew",
        contact_phones: "+91-98103-45678",
      }),
      // Obituaries
      make({
        type: "obituary",
        language: "en",
        weeks_to_run: "1",
        name_of_deceased: "R. Sharma",
        date_of_death: "2026-04-18",
        life_summary:
          "A printer, teacher, and community organizer who spent forty years at the local press.",
        surviving_family: "Wife Meena, two daughters, five grandchildren.",
        prayer_meeting: "Lodhi Crematorium, 23 April 2026, 11 AM.",
      }),
      make({
        type: "obituary",
        language: "en",
        weeks_to_run: "1",
        name_of_deceased: "Geeta Devi (1939–2026)",
        date_of_death: "2026-04-15",
        life_summary: "Schoolteacher, gardener, and grandmother to half the neighbourhood.",
        surviving_family: "Husband Lakshman, three sons, eight grandchildren.",
        prayer_meeting: "Bharat Sevashram Sangha, 22 April, 10 AM.",
      }),
      // Public notices
      make({
        type: "public_notice",
        language: "en",
        weeks_to_run: "2",
        notice_type: "name_change",
        notice_text:
          "I, Anand Kumar Verma, son of late S. K. Verma, resident of Sector 21, Noida, have changed my name to Anand Verma. Affidavit dated 10 April 2026.",
        published_by: "Anand Verma",
        date: "2026-04-10",
      }),
      make({
        type: "public_notice",
        language: "en",
        weeks_to_run: "1",
        notice_type: "lost_document",
        notice_text:
          "I, Priya Iyer, lost my Class 10 ICSE certificate (Cert No. ICSE/2008/12345) on the Andheri local on 17 April 2026. Finder kindly contact below.",
        published_by: "Priya Iyer",
        date: "2026-04-19",
      }),
      // Announcements
      make({
        type: "announcement",
        language: "en",
        weeks_to_run: "1",
        occasion_type: "birthday",
        recipient_name: "Master Aarav, on his 5th birthday",
        message_text:
          "Many happy returns of the day from the entire Khan-Iyer family. May you grow in laughter and curiosity.",
        sender_names: "Mom, Dad, Naani, Dadu",
      }),
      make({
        type: "announcement",
        language: "en",
        weeks_to_run: "1",
        occasion_type: "anniversary",
        recipient_name: "Mr. & Mrs. Banerjee — 50 golden years",
        message_text:
          "From your children, grandchildren, and the entire C-23 housing society. Here's to fifty more.",
        sender_names: "The Banerjee clan",
      }),
      // Vehicles
      make({
        type: "vehicles",
        language: "en",
        weeks_to_run: "2",
        location: "Lodhi Colony",
        contact_phones: "+91-98104-44444",
        make: "Mahindra",
        model: "XUV300",
        year: "2021",
        kilometers: "32000",
        fuel_type: "petrol",
        expected_price: "₹8.5 lakh, neg.",
      }),
      make({
        type: "vehicles",
        language: "en",
        weeks_to_run: "1",
        location: "Pune",
        contact_phones: "+91-98105-55555",
        make: "Honda",
        model: "City",
        year: "2018",
        kilometers: "78000",
        fuel_type: "diesel",
        expected_price: "₹5.2 lakh",
      }),
    ];
    const csv =
      headers.join(",") +
      "\n" +
      rows
        .map((r) =>
          r.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")
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
