// Bigger fixture set for the "big issue" stress test:
//   - 20 Wikipedia articles (12 English, 6 Hindi, 2 mixed-language)
//   - Each saved as plain markdown so the E2E can paste them into the
//     in-app rich-text editor (NewArticleModal) instead of going through
//     the .docx pipeline.
//   - 5 ad creatives: inside-front-cover, inside-back-cover, back-cover,
//     between-articles, bottom-strip — different aspect ratios.
//   - 120-classified CSV spanning every type, plus a few matrimonial
//     entries with portrait photos.
//
// Run: bun scripts/build-big-fixture.ts

import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

const repoRoot = process.cwd();
const FIXTURES = path.join(repoRoot, "tests/fixtures");
const ARTICLES_MD = path.join(FIXTURES, "articles-md");
const ADS_DIR = path.join(FIXTURES, "ads");
const PORTRAITS_DIR = path.join(FIXTURES, "portraits");
const CLASSIFIEDS_DIR = path.join(FIXTURES, "classifieds");

interface ArticleSpec {
  slug: string;
  title: string;
  wiki: "en" | "hi";
  contentType: "Article" | "Photo Essay" | "Interview" | "Opinion" | "Brief" | "Letter";
  byline: string;
  deck: string;
  bilingualPair?: { wiki: "en" | "hi"; title: string; paragraphs: number };
  language?: "en" | "hi" | "bilingual";
}

const ARTICLES: ArticleSpec[] = [
  // English features (12)
  {
    slug: "kerala-backwaters",
    title: "Kerala_backwaters",
    wiki: "en",
    contentType: "Photo Essay",
    byline: "By Anjali Menon",
    deck: "A network of brackish lagoons, parallel to the Arabian Sea.",
  },
  {
    slug: "darjeeling-railway",
    title: "Darjeeling_Himalayan_Railway",
    wiki: "en",
    contentType: "Article",
    byline: "By Sayan Roy",
    deck: "Two-foot gauge through tea country, climbing 7,000 feet.",
  },
  {
    slug: "konark-sun-temple",
    title: "Konark_Sun_Temple",
    wiki: "en",
    contentType: "Article",
    byline: "By Saraswati Patnaik",
    deck: "Twelve carved wheels, twenty-four spokes, one chariot of the sun.",
  },
  {
    slug: "thar-desert",
    title: "Thar_Desert",
    wiki: "en",
    contentType: "Photo Essay",
    byline: "By Ramesh Choudhary",
    deck: "The Great Indian Desert: salt flats, dunes, and silence.",
  },
  {
    slug: "bhimbetka-rock-shelters",
    title: "Bhimbetka_rock_shelters",
    wiki: "en",
    contentType: "Article",
    byline: "By Aarav Singh",
    deck: "Mesolithic paintings, in continuous use for 30,000 years.",
  },
  {
    slug: "khajuraho",
    title: "Khajuraho_Group_of_Monuments",
    wiki: "en",
    contentType: "Article",
    byline: "By Priya Mishra",
    deck: "Twenty-five surviving temples of nagara-style architecture.",
  },
  {
    slug: "sundarbans",
    title: "Sundarbans",
    wiki: "en",
    contentType: "Photo Essay",
    byline: "By Indrani Bose",
    deck: "Mangrove forest at the meeting of the Ganges and the Bay of Bengal.",
  },
  {
    slug: "ladakh-feature-2",
    title: "Ladakh",
    wiki: "en",
    contentType: "Photo Essay",
    byline: "By Tenzin Wangmo",
    deck: "High-altitude desert. The light at 3,500m never quite finishes settling.",
  },
  {
    slug: "qutub-minar",
    title: "Qutb_Minar",
    wiki: "en",
    contentType: "Article",
    byline: "By Mohammed Ahmed",
    deck: "Seventy-two metres of Indo-Islamic architecture, rising since 1192.",
  },
  {
    slug: "varkala-cliff",
    title: "Varkala",
    wiki: "en",
    contentType: "Photo Essay",
    byline: "By Lakshmi Pillai",
    deck: "Cliff-side town where the Arabian Sea meets red laterite.",
  },
  {
    slug: "dholavira",
    title: "Dholavira",
    wiki: "en",
    contentType: "Article",
    byline: "By Hardik Patel",
    deck: "Indus Valley city of stone and water reservoirs.",
  },
  {
    slug: "rann-of-kutch",
    title: "Rann_of_Kutch",
    wiki: "en",
    contentType: "Photo Essay",
    byline: "By Madhumita Joshi",
    deck: "Salt marsh that turns white under the moon, every winter.",
  },

  // Hindi articles (6)
  {
    slug: "kabir-feature",
    title: "कबीर",
    wiki: "hi",
    contentType: "Article",
    byline: "लेखक — अनुराग शर्मा",
    deck: "एक संत-कवि का जीवन और काव्य।",
    language: "hi",
  },
  {
    slug: "tulsidas-feature",
    title: "तुलसीदास",
    wiki: "hi",
    contentType: "Article",
    byline: "लेखक — मीरा त्रिपाठी",
    deck: "रामचरितमानस के रचयिता।",
    language: "hi",
  },
  {
    slug: "premchand-feature",
    title: "मुंशी_प्रेमचंद",
    wiki: "hi",
    contentType: "Article",
    byline: "लेखक — विकास कुमार",
    deck: "हिंदी-उर्दू कथा-साहित्य के पितामह।",
    language: "hi",
  },
  {
    slug: "dilli-hindi",
    title: "दिल्ली",
    wiki: "hi",
    contentType: "Article",
    byline: "लेखक — रोहन गुप्ता",
    deck: "देश की राजधानी का संक्षिप्त परिचय।",
    language: "hi",
  },
  {
    slug: "ganga-river",
    title: "गंगा_नदी",
    wiki: "hi",
    contentType: "Photo Essay",
    byline: "लेखक — सरिता पाण्डेय",
    deck: "हिमालय से बंगाल की खाड़ी तक।",
    language: "hi",
  },
  {
    slug: "varanasi-hindi",
    title: "वाराणसी",
    wiki: "hi",
    contentType: "Article",
    byline: "लेखक — पंकज मिश्रा",
    deck: "गंगा के तट पर बसा प्राचीन नगर।",
    language: "hi",
  },

  // Bilingual (2)
  {
    slug: "delhi-bi-2",
    title: "Delhi",
    wiki: "en",
    contentType: "Article",
    byline: "By QA Harness · क्यूए परीक्षक",
    deck: "A bilingual feature: English then Hindi.",
    bilingualPair: { wiki: "hi", title: "दिल्ली", paragraphs: 5 },
    language: "bilingual",
  },
  {
    slug: "ayurveda-bi",
    title: "Ayurveda",
    wiki: "en",
    contentType: "Article",
    byline: "By Aditi Joshi · आदिति जोशी",
    deck: "Traditional medicine, English overview followed by Hindi context.",
    bilingualPair: { wiki: "hi", title: "आयुर्वेद", paragraphs: 4 },
    language: "bilingual",
  },
];

async function fetchWikipedia(title: string, wiki: "en" | "hi", maxWords = 1800): Promise<string> {
  const host = `${wiki}.wikipedia.org`;
  const url = `https://${host}/w/api.php?format=json&action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(title)}&redirects=1`;
  const res = await fetch(url, { headers: { "User-Agent": "Forme QA" } });
  const json = (await res.json()) as { query: { pages: Record<string, { extract?: string }> } };
  const p = Object.values(json.query.pages)[0];
  if (!p?.extract) throw new Error(`no extract for ${wiki}:${title}`);
  return p.extract.split(/\s+/).slice(0, maxWords).join(" ");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchPicsumPhoto(
  seed: string,
  w: number,
  h: number,
  outPath: string
): Promise<void> {
  if (await exists(outPath)) return;
  const res = await fetch(`https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`, {
    redirect: "follow",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

async function makeAdImage(
  label: string,
  sub: string,
  w: number,
  h: number,
  bgHex: string,
  outPath: string
): Promise<void> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="${bgHex}"/>
  <rect x="32" y="32" width="${w - 64}" height="${h - 64}" fill="none" stroke="white" stroke-width="3"/>
  <text x="50%" y="40%" font-family="Georgia, serif" font-size="${Math.round(h / 8)}" text-anchor="middle" fill="white" font-weight="700">${label}</text>
  <text x="50%" y="58%" font-family="sans-serif" font-size="${Math.round(h / 18)}" text-anchor="middle" fill="white" opacity="0.85">${sub}</text>
  <text x="50%" y="${h - 48}" font-family="sans-serif" font-size="${Math.round(h / 28)}" text-anchor="middle" fill="white" opacity="0.65">SAMPLE · Forme</text>
</svg>`;
  await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(outPath);
}

async function main() {
  await fs.mkdir(ARTICLES_MD, { recursive: true });
  await fs.mkdir(ADS_DIR, { recursive: true });
  await fs.mkdir(PORTRAITS_DIR, { recursive: true });
  await fs.mkdir(CLASSIFIEDS_DIR, { recursive: true });

  // Articles → markdown files (paragraphs separated by \n\n).
  for (const a of ARTICLES) {
    const outPath = path.join(ARTICLES_MD, `${a.slug}.md`);
    console.log(`fetching ${a.wiki}:${a.title}…`);
    try {
      let text = await fetchWikipedia(a.title, a.wiki);
      if (a.bilingualPair) {
        const other = await fetchWikipedia(a.bilingualPair.title, a.bilingualPair.wiki, 400);
        const otherParas = other
          .split(/\n\s*\n/)
          .slice(0, a.bilingualPair.paragraphs)
          .join("\n\n");
        text = `${text}\n\n${otherParas}`;
      }
      // Drop the leading "Title" duplicate
      const paras = text.split(/\n\s*\n/);
      while (
        paras.length > 0 &&
        paras[0]!.replace(/\s+/g, " ").trim() === a.title.replace(/_/g, " ")
      )
        paras.shift();
      const body = paras.join("\n\n");
      // Markdown with a leading metadata block the E2E can parse
      const md = `---\ntitle: ${a.title.replace(/_/g, " ")}\nbyline: ${a.byline}\ndeck: ${a.deck}\ncontentType: ${a.contentType}\n${a.language ? `language: ${a.language}\n` : ""}---\n\n${body}`;
      await fs.writeFile(outPath, md);
      const stat = await fs.stat(outPath);
      console.log(`  → ${a.slug}.md (${stat.size} bytes)`);
    } catch (e) {
      console.error(`  FAIL ${a.slug}:`, e);
    }
  }

  // Ads — five different positions / formats
  await makeAdImage(
    "Aurora",
    "Jewellery you actually want to wear.",
    2480,
    3508,
    "#C96E4E",
    path.join(ADS_DIR, "ifc-aurora.png")
  );
  await makeAdImage(
    "Fieldnotes",
    "A weekly for people who take the long way home.",
    2480,
    3508,
    "#3F6F6E",
    path.join(ADS_DIR, "ibc-fieldnotes.png")
  );
  await makeAdImage(
    "Saptahik Press",
    "Print matters. Still. Always.",
    2480,
    3508,
    "#1A1A1A",
    path.join(ADS_DIR, "back-saptahik.png")
  );
  await makeAdImage(
    "HORIZON BOOKS",
    "Independent bookstore · Defence Colony",
    2480,
    3508,
    "#8A6A2A",
    path.join(ADS_DIR, "between-horizon.png")
  );
  // Strip slot aspect = 210/35 = 6.0 (per src/shared/schemas/ad.ts).
  // At 2480px wide the height must be 2480/6 ≈ 413 to pass the 1% tolerance.
  await makeAdImage(
    "Saptahik · Subscribe",
    "1 year · ₹1,200 · saptahik.in",
    2480,
    413,
    "#C96E4E",
    path.join(ADS_DIR, "strip-subscribe.png")
  );

  // Portraits for matrimonial classifieds
  for (const seed of [
    "matri-aanya",
    "matri-rohan",
    "matri-sara",
    "matri-daniel",
    "matri-priya",
    "matri-vikram",
    "matri-nisha",
    "matri-arjun",
    "matri-sneha",
    "matri-rajesh",
    "matri-meera",
    "matri-karan",
  ]) {
    await fetchPicsumPhoto(seed, 600, 600, path.join(PORTRAITS_DIR, `${seed}.jpg`));
  }

  // Classifieds — generate 120 entries spanning all types
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
  const idx = (k: string) => headers.indexOf(k);
  const make = (cells: Record<string, string>): string[] => {
    const row = new Array(headers.length).fill("");
    for (const [k, v] of Object.entries(cells)) {
      const i = idx(k);
      if (i >= 0) row[i] = v;
    }
    return row;
  };

  const rows: string[][] = [];

  // 30 matrimonial-with-photo (cycle through 12 portraits)
  const portraits = [
    "matri-aanya",
    "matri-rohan",
    "matri-sara",
    "matri-daniel",
    "matri-priya",
    "matri-vikram",
    "matri-nisha",
    "matri-arjun",
    "matri-sneha",
    "matri-rajesh",
    "matri-meera",
    "matri-karan",
  ];
  const matriNames = [
    [
      "Aanya Sharma",
      "29",
      "Delhi",
      "Hindu",
      "MBA",
      "Investment banker",
      "Mrs. Sharma",
      "+91-98100-00001",
    ],
    [
      "Rohan Iyer",
      "32",
      "Bengaluru",
      "Hindu Iyer",
      "MS Comp Sci",
      "Senior software engineer",
      "Mr. Iyer",
      "+91-98100-00002",
    ],
    [
      "Sara Khan",
      "27",
      "Hyderabad",
      "Sunni Muslim",
      "MD Pediatrics",
      "Doctor",
      "Mr. Khan",
      "+91-98100-00003",
    ],
    [
      "Daniel Mathew",
      "30",
      "Kochi",
      "Syrian Christian",
      "B.Tech, MBA",
      "Family business",
      "Mr. Mathew",
      "+91-98100-00004",
    ],
    [
      "Priya Reddy",
      "28",
      "Hyderabad",
      "Hindu",
      "CA",
      "Tax consultant",
      "Mr. Reddy",
      "+91-98100-00005",
    ],
    [
      "Vikram Singh",
      "34",
      "Chandigarh",
      "Sikh",
      "MBA Marketing",
      "Brand director",
      "Mr. Singh",
      "+91-98100-00006",
    ],
    [
      "Nisha Gupta",
      "26",
      "Delhi",
      "Hindu",
      "Architect",
      "Architect (own firm)",
      "Mrs. Gupta",
      "+91-98100-00007",
    ],
    [
      "Arjun Nair",
      "31",
      "Trivandrum",
      "Hindu Nair",
      "M.Tech",
      "Aerospace engineer",
      "Mr. Nair",
      "+91-98100-00008",
    ],
    [
      "Sneha Banerjee",
      "29",
      "Kolkata",
      "Bengali Hindu",
      "PhD History",
      "University lecturer",
      "Dr. Banerjee",
      "+91-98100-00009",
    ],
    [
      "Rajesh Kumar",
      "33",
      "Bengaluru",
      "Hindu",
      "MBA",
      "Product manager",
      "Mr. Kumar",
      "+91-98100-00010",
    ],
    [
      "Meera Krishnan",
      "28",
      "Chennai",
      "Tamil Brahmin",
      "CA, CS",
      "Auditor",
      "Mr. Krishnan",
      "+91-98100-00011",
    ],
    [
      "Karan Mehta",
      "30",
      "Mumbai",
      "Jain",
      "MBA Finance",
      "Investment banker",
      "Mr. Mehta",
      "+91-98100-00012",
    ],
  ];
  for (let i = 0; i < 30; i++) {
    const m = matriNames[i % matriNames.length]!;
    const portrait = portraits[i % portraits.length]!;
    rows.push(
      make({
        type: "matrimonial_with_photo",
        language: "en",
        weeks_to_run: "2",
        photo_path: path.join(PORTRAITS_DIR, `${portrait}.jpg`),
        name: m[0],
        age: m[1],
        location: m[2],
        religion_community: m[3],
        education: m[4],
        occupation: m[5],
        contact_name: m[6],
        contact_phones: m[7],
      })
    );
  }

  // 25 matrimonial-no-photo
  for (let i = 0; i < 25; i++) {
    const m = matriNames[i % matriNames.length]!;
    rows.push(
      make({
        type: "matrimonial_no_photo",
        language: "en",
        weeks_to_run: "1",
        name: m[0],
        age: m[1],
        location: m[2],
        religion_community: m[3],
        education: m[4],
        occupation: m[5],
        contact_name: m[6],
        contact_phones: m[7],
      })
    );
  }

  // 20 obituaries
  const obitNames = [
    [
      "R. Sharma",
      "2026-04-18",
      "A printer, teacher, and community organizer.",
      "Wife Meena and two daughters.",
      "Lodhi Crematorium, 23 April 11 AM.",
    ],
    [
      "Geeta Devi (1939–2026)",
      "2026-04-15",
      "Schoolteacher and gardener.",
      "Husband Lakshman, three sons.",
      "Bharat Sevashram, 22 April 10 AM.",
    ],
    [
      "K. Subramanian",
      "2026-04-12",
      "Retired bank manager.",
      "Wife Lakshmi and son.",
      "Chennai Crematorium, 17 April 9 AM.",
    ],
    [
      "M. Choudhury",
      "2026-04-10",
      "Lifelong railway employee.",
      "Wife and two sons.",
      "Howrah Crematorium, 14 April 11 AM.",
    ],
    [
      "P. Nair",
      "2026-04-08",
      "Veteran journalist.",
      "Wife and three children.",
      "Trivandrum Crematorium, 12 April 8 AM.",
    ],
  ];
  for (let i = 0; i < 20; i++) {
    const o = obitNames[i % obitNames.length]!;
    rows.push(
      make({
        type: "obituary",
        language: "en",
        weeks_to_run: "1",
        name_of_deceased: o[0],
        date_of_death: o[1],
        life_summary: o[2],
        surviving_family: o[3],
        prayer_meeting: o[4],
      })
    );
  }

  // 15 public notices
  const notices = [
    [
      "name_change",
      "I, Anand Verma, son of late S. K. Verma, have changed my name to Anand K. Verma. Affidavit dated 10 April 2026.",
      "Anand Verma",
      "2026-04-10",
    ],
    [
      "lost_document",
      "I, Priya Iyer, lost my Class 10 ICSE certificate (Cert No. ICSE/2008/12345) on the Andheri local on 17 April 2026.",
      "Priya Iyer",
      "2026-04-19",
    ],
    [
      "legal_notice",
      "Notice is hereby given that the partnership between A Patel and B Shah dissolves on 30 April 2026.",
      "Patel & Shah",
      "2026-04-22",
    ],
    [
      "missing_person",
      "Missing since 8 April 2026: Anil Mehta, age 67, last seen at Connaught Place. Any information appreciated.",
      "Mehta family",
      "2026-04-09",
    ],
  ];
  for (let i = 0; i < 15; i++) {
    const n = notices[i % notices.length]!;
    rows.push(
      make({
        type: "public_notice",
        language: "en",
        weeks_to_run: "2",
        notice_type: n[0],
        notice_text: n[1],
        published_by: n[2],
        date: n[3],
      })
    );
  }

  // 15 announcements
  const announcements = [
    [
      "birthday",
      "Master Aarav, on his 5th birthday",
      "Many happy returns from the entire Khan-Iyer family.",
      "Mom, Dad, Naani, Dadu",
    ],
    [
      "anniversary",
      "Mr. & Mrs. Banerjee — 50 golden years",
      "From your children, grandchildren, and the entire C-23 housing society.",
      "The Banerjee clan",
    ],
    [
      "congratulations",
      "Aanya Sharma — IIT Bombay",
      "Wishing you the very best as you start the next chapter.",
      "Family and friends",
    ],
    [
      "festival",
      "To all our readers — Happy Diwali",
      "May this festival bring light, laughter, and prosperity to every home.",
      "Saptahik Weekly",
    ],
  ];
  for (let i = 0; i < 15; i++) {
    const a = announcements[i % announcements.length]!;
    rows.push(
      make({
        type: "announcement",
        language: "en",
        weeks_to_run: "1",
        occasion_type: a[0],
        recipient_name: a[1],
        message_text: a[2],
        sender_names: a[3],
      })
    );
  }

  // 15 vehicles
  const vehicles = [
    [
      "Lodhi Colony",
      "+91-98104-44441",
      "Mahindra",
      "XUV300",
      "2021",
      "32000",
      "petrol",
      "₹8.5 lakh",
    ],
    ["Pune", "+91-98104-44442", "Honda", "City", "2018", "78000", "diesel", "₹5.2 lakh"],
    ["Bengaluru", "+91-98104-44443", "Toyota", "Innova", "2019", "65000", "diesel", "₹14 lakh"],
    ["Chennai", "+91-98104-44444", "Hyundai", "i20", "2020", "45000", "petrol", "₹6.5 lakh"],
    ["Mumbai", "+91-98104-44445", "Maruti", "Swift", "2022", "18000", "petrol", "₹7 lakh"],
  ];
  for (let i = 0; i < 15; i++) {
    const v = vehicles[i % vehicles.length]!;
    rows.push(
      make({
        type: "vehicles",
        language: "en",
        weeks_to_run: "2",
        location: v[0],
        contact_phones: v[1],
        make: v[2],
        model: v[3],
        year: v[4],
        kilometers: v[5],
        fuel_type: v[6],
        expected_price: v[7],
      })
    );
  }

  const csv =
    headers.join(",") +
    "\n" +
    rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");
  const csvPath = path.join(CLASSIFIEDS_DIR, "big-issue.csv");
  await fs.writeFile(csvPath, csv);
  console.log(`csv → ${csvPath} (${rows.length} entries, ${csv.length} bytes)`);

  console.log("\nfixtures ready under:", FIXTURES);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
