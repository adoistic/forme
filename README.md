# Forme

**An editorial magazine CMS for print. Single operator. Offline. Open source.**

Forme is a desktop app (macOS, Electron) that produces print-ready magazine issues (PowerPoint `.pptx` → PDF) for a single non-technical operator. English, Hindi, and bilingual content are first-class. Ads, classifieds, covers, and auto-versioned history are all built in. No cloud, no accounts, no billing — just typography, layout, and the operator's work.

**Status:** v0.5 — end-to-end export is working. A 73-page demo magazine ([download PDF](https://github.com/adoistic/forme/releases/tag/v0.5)) is built entirely through the in-app UI: 20 articles, 120 classifieds, 5 ad placements covering every position. Honest list of what's working vs. what isn't is below.

---

## v0.5 — what's working, what isn't

**Run it yourself:** [download the unsigned macOS DMG](https://github.com/adoistic/forme/releases/tag/v0.5) from the v0.5 release. macOS Gatekeeper will block first launch (no Apple Developer ID yet — that's part of v0.6). Right-click → Open → Open. The unsigned warning is intentional for the preview.

### ✅ Working today

- **Issues** — create with title, number, date, A4/A5 page size, English / Hindi / bilingual language, four typography pairings.
- **Articles via in-app editor** — `NewArticleModal` has a Tiptap rich-text editor and a markdown tab. Paste body text, set headline + deck + byline + content type, save. Auto-detects language from the body (35% Devanagari → Hindi, 5% → bilingual).
- **Articles via .docx upload** — drag a Word file in. Mammoth parses it; Hindi byline / deck patterns recognised; duplicate-headline rows stripped automatically.
- **Layout pipeline** — pretext + Skia canvas measurement + per-paragraph hyphenation (English + Hindi Knuth–Liang patterns), per-script line counting, balanced column packer with sentence-boundary splits, first-page geometry shared between layout planner and PPTX renderer (so they can't drift). 78 % average body fill across the demo magazine, no overflow into footers (audited per-page; see `scripts/audit-all-pages.ts`).
- **Classifieds** — 12 types (matrimonial with/without photo, obituary, public notice, announcement, vehicles, property, jobs, etc.). Two intake paths: (1) bulk CSV import — proven against a 120-row file in the E2E suite, (2) single-classified form (`AddClassifiedModal`) with a type picker and per-type fields (JSON fallback for the rarer types).
- **Ads** — 11 slot types (`full_page`, `double_page_spread`, `half_page_horizontal/vertical`, `quarter_page`, `strip`, `vertical_strip`, `eighth_page`, `cover_strip`, `corner_bookmark`, `section_sponsor_strip`). Aspect ratio + DPI validated on upload (sub-150 DPI rejected). Position label drives placement: inside-front-cover, inside-back-cover, back-cover, run-of-book (between articles), bottom-strip.
- **PPTX export** — produces cover → IFC ad → TOC → articles (interleaved with between-ads every 3) → classifieds → IBC → BC. Per-article folios (recto/verso), running headers, body justification + 4 pt paragraph spacing, embedded Fraunces / Inter / Mukta fonts.
- **PDF rendering** — LibreOffice headless converts the `.pptx` to PDF for the operator's printer. `scripts/audit-all-pages.ts` rasterises every page and reports body fill %, overflow, column unevenness — the v0.5 release PDF was verified through this.
- **Tests** — Vitest unit + integration suite; Playwright E2E spec (`tests/e2e/big-issue.spec.ts`) drives the actual UI to build a 20-article + 120-classified + 5-ad-position issue and asserts the export. Runs in 2.1 minutes on a Mac.
- **Crash + diagnostics** — pino structured logging, single-instance lock, snapshot/recovery store.
- **Window behaves on small screens** — capped to the macOS work area (won't push the bottom of the window behind the Dock).

### 🚧 Known gaps (deferred to v0.6 / v0.7)

These are real, the operator will hit them; they're listed honestly so v0.5 isn't oversold:

| #   | Gap                                                      | What's missing                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Hero image upload from the app**                       | No file picker / URL paste / drag-drop in `NewArticleModal` or `EditArticleModal`. Hero images today only enter the system through `.docx` import. The hero-placement / caption / credit editor in `EditArticleModal` is wired but has no source-image control. |
| 2   | **CSV format documentation for non-technical operators** | Sample CSV exists at `tests/fixtures/classifieds/sample.csv` and the column list lives in `src/main/ipc/handlers/classified.ts`, but neither is accessible from the import UI. Need an in-UI "download sample CSV" + per-type column reference.                 |
| 3   | **Reorder articles / classifieds / ads**                 | Read-only lists. Ordering today is implicit (created-at ASC for articles, type-then-created-at for classifieds). `dnd-kit` is in the locked stack but not wired. The operator can't say "ad X goes between article 5 and 6".                                    |
| 4   | **Manual ad placement**                                  | Ad position is a free-text label (`positionLabel`) that `derivePosition` substring-matches. No UI for "between article 3 and 4" or "bottom of article 5 page 2".                                                                                                |
| 5   | **"Save as…" dialog on export**                          | Export writes to a fixed `~/Documents/Forme/{slug}-{date}.pptx` with no `dialog.showSaveDialog` call. Operator can't choose location or filename at export time.                                                                                                |
| 6   | **Side-image article layouts**                           | Only three image placements exist (`below-headline`, `above-headline`, `full-bleed`). No inline figure with text wrapping around it. Pretext's `layoutNextLineRange(width)` supports the variable-width line stepping needed; not yet wired.                    |
| 7   | **Poetry templates**                                     | `Poem` is a valid `contentType` and `poetry` is in the template-family enum, but no `poetry.json` template exists yet. Poems route to the default feature template today. Quatrain / short / long / multi-poem-per-page packing is the v0.6 brainstorm.         |
| 8   | **Code-signed + notarized DMG**                          | v0.5 DMG ships unsigned. Apple Developer ID + notarization is v0.6.                                                                                                                                                                                             |

### 🗺️ What's next

- **v0.6** — close gaps 1–5 above (hero upload, CSV docs, drag-reorder, manual ad placement, save-as dialog). These are the operator's daily friction.
- **v0.7** — poetry layouts (3+ templates) and side-image article layouts. This is the brainstorm in flight.
- **v0.8** — distribution hardening: code-signed + notarized macOS DMG, plus App Sandbox + Hardened Runtime + entitlements (shipped together — sandbox issues only surface in signed builds). Windows is in `TODOS.md` for v1.x.

---

---

## Why this exists

Most magazine CMS tools target web publishing. The few that target print (InDesign, Scribus, Affinity Publisher) are professional typesetting tools — too expensive, too complex, and too technical for a single operator at a small regional publisher. Forme's goal: let a non-technical operator produce a print-ready issue from start to finish in a single afternoon, with editorial-grade output.

This repository begins with the planning artifacts (CEO plan, engineering plan, design system, test plan, approved mockups) BEFORE any code. The thinking is the product as much as the code is.

---

## What's in this repo (today)

```
.
├── src/
│   ├── main/                       ← Electron main process: IPC handlers, DB, layout planner, export
│   ├── renderer/                   ← React UI: screens, modals, stores, components
│   ├── shared/                     ← schemas, PPTX builder, types crossing process boundaries
│   └── utility/                    ← worker process for pptxgenjs (off main thread)
├── templates/                      ← 3 layout templates (standard-feature-a4, photo-essay-a4, long-form-essay-a4)
├── tests/
│   ├── e2e/                        ← Playwright Electron specs (incl. big-issue full-flow)
│   └── fixtures/                   ← sample articles, classifieds CSV, ad creatives
├── scripts/
│   ├── audit-all-pages.ts          ← per-page PDF audit (fill %, overflow, unevenness)
│   ├── benchmark-pdf-fill.ts       ← summary fill report for any rendered PDF
│   └── build-big-fixture.ts        ← generates the 20-article + 120-classified test corpus
├── designs/                        ← 13 approved mockups (directional), each with `approved.json` + AI-drift notes
├── docs/
│   ├── ceo-plan.md                 ← scope, expansions, preconditions, CEO decisions
│   ├── eng-plan.md                 ← locked stack, architecture, test strategy
│   └── test-plan.md                ← QA test surfaces, edge cases, critical paths
├── DESIGN.md                       ← locked design system: tokens, components, voice, a11y
├── TODOS.md                        ← deferred items, each with full context
└── CLAUDE.md                       ← coding contract for AI agents working in this repo
```

Each design folder contains:

- `approved.png` — the approved mockup
- `approved.json` — direction, implementation notes, **and a list of AI drift to ignore**

---

## Quick facts

**Who it's for:** single non-technical operator at a small regional magazine publisher. Think: one person producing a weekly, monthly, or occasional issue for a readership of 500 to 50,000.

**What it outputs:** a print-ready PowerPoint `.pptx` file per issue. The operator opens it in PowerPoint, reviews, and exports to PDF for the printer. Forme does not produce PDFs directly (intentional scope cut; see [docs/ceo-plan.md](docs/ceo-plan.md)).

**What's inside an issue:** A4 or A5 pages, 4 typography pairings (Editorial Serif / News Sans / Literary / Modern Geometric), bilingual English + Hindi, articles rendered via 52 templates, 12 classified types (matrimonial, obituary, property, etc.), 11 ad slot types (full page, half page, strip, cover strip, etc.), cover editor, and auto-saving Google-Docs-style history.

**What's NOT inside:** multi-user editing, cloud sync, user accounts, pricing/billing logic, AI features, or any public submission portal. Deliberate scope cuts. See [docs/ceo-plan.md](docs/ceo-plan.md) section "NOT in scope."

---

## The engineering stack

Locked via `/plan-eng-review`. All Layer 1 (battle-tested) except [Pretext](https://github.com/chenglou/pretext) (Layer 2, vendored into repo as insurance).

| Layer            | Choice                                                              |
| ---------------- | ------------------------------------------------------------------- |
| Shell            | Electron                                                            |
| UI framework     | React + TypeScript (strict)                                         |
| Build            | Vite                                                                |
| Styling          | Tailwind CSS (tokens from `DESIGN.md`)                              |
| Components       | Radix UI Primitives (unstyled, headless)                            |
| State            | Zustand (with `useShallow` + Immer discipline)                      |
| Drag-and-drop    | dnd-kit                                                             |
| Validation       | Zod                                                                 |
| Database         | SQLite via better-sqlite3                                           |
| Query builder    | Kysely + kysely-ctl (migrations)                                    |
| Images           | sharp (libvips)                                                     |
| Docx parsing     | mammoth.js                                                          |
| CSV parsing      | papaparse                                                           |
| PPTX writing     | pptxgenjs (in Electron utility process, not renderer)               |
| Text measurement | @chenglou/pretext (vendored into `vendor/pretext/`)                 |
| Fonts            | Fraunces (display serif) + Inter (UI) + Mukta (Devanagari), bundled |
| Logging          | pino (structured JSON, 7-day local rotation)                        |
| OOXML validation | LibreOffice headless (on pre-export check + Phase 1 harness)        |
| Testing (unit)   | Vitest                                                              |
| Testing (E2E)    | Playwright (Electron API)                                           |
| Linting          | ESLint + Prettier + Husky + lint-staged                             |
| Packager         | electron-builder (macOS DMG, signed + notarized)                    |

See [docs/eng-plan.md](docs/eng-plan.md) for the full rationale.

---

## Design system

[DESIGN.md](DESIGN.md) is the single source of truth for:

- Color tokens (cream `#F5EFE7`, rust `#C96E4E`, semantic severity colors)
- Typography (Fraunces + Inter + Mukta, full type scale)
- Spacing (4/8/12/16/24/32/48 tokens)
- Radii, shadows, motion (restrained, editorial)
- 20+ component specs (buttons, inputs, pills, cards, modals, drop zones, sidebar nav, toast, inline banner, timeline row, empty-state card, split-pane, collapsible section, aspect-ratio thumbnail, status chip, and more)
- Accessibility floor (WCAG AA, keyboard nav, focus rings)
- Voice + copy rules
- AI-slop blacklist (specific to this product)

The 13 approved mockups in `designs/` are **directional** references for composition. DESIGN.md is authoritative for tokens, components, and behavior. Implementers should read the mockup AND `approved.json` together (the JSON flags AI-drift to ignore — wrong nav items, typos, stylistic bleed).

---

## Roadmap

**Shipped (v0.5):** Foundation, layout pipeline, PPTX export, PDF render verification, classifieds CSV import, ad upload + position routing, in-app rich-text/markdown article composition, per-paragraph hyphenation, three templates (feature, photo-essay, long-form). See "v0.5 — what's working, what isn't" above.

**v0.6 — operator daily friction:** in-app hero image upload (file/URL/paste), CSV format docs in UI, drag-reorder for articles + classifieds + ads (`dnd-kit`), manual ad placement (between which articles), `dialog.showSaveDialog` on export.

**v0.7 — typography expansion:** poetry templates (quatrain, short, long, multi-poem-per-page), side-image article layouts using pretext's `layoutNextLineRange`.

**v0.8 — distribution:** code-signed + notarized macOS DMG (Apple Developer ID), auto-update channel.

**v1.x (in [TODOS.md](TODOS.md)):**

- Windows support
- Voice-to-text classifieds intake (Whisper + local LLM)
- Dark theme
- Storybook for UI component isolation
- Devanagari UI QA pass
- Orphan blob GC
- …and 10+ more delight items each with full context

---

## Why open source

Three reasons:

1. **Small regional publishers deserve better tools.** Paid options are expensive and complex. Free tools are either web-focused or not maintained. Forme is aimed at this gap.
2. **Planning artifacts deserve scrutiny.** The CEO plan, engineering stack, and design decisions are public so anyone can poke at them before code is written. Disagreements become issues, not postmortems.
3. **The planning method is the meta-product.** Forme was produced through a series of structured review passes (CEO review → engineering review → design review → design shotgun) using [gstack](https://garryslist.org/) by [@garrytan](https://github.com/garrytan), running inside [Claude Code](https://claude.com/claude-code) by [@anthropics](https://github.com/anthropics). Coding behavior is constrained by the [Karpathy Guidelines](https://github.com/forrestchang/andrej-karpathy-skills) skill by [@forrestchang](https://github.com/forrestchang), derived from [@karpathy](https://github.com/karpathy)'s [observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls. The artifacts in this repo are worth more than the app that will eventually be built on top of them, and they demonstrate a way of thinking about building software.

---

## Contributing

Not accepting contributions yet — the code hasn't started. Once Phase 0 lands, CONTRIBUTING.md + issue templates will follow.

For now: open an issue if you see something wrong in the planning, design, or technical choices. Cross-checking is genuinely useful at this stage.

---

## License

[MIT](LICENSE). Use, modify, commercialize — whatever helps. Credit appreciated but not required.

---

## Acknowledgments

### The planning chassis

- **[@garrytan](https://github.com/garrytan)** ([Garry Tan](https://x.com/garrytan)) — creator of [gstack](https://garryslist.org/), the open-source AI builder framework whose CEO / eng / design review passes produced every planning document in this repo. The "Boil the Lake" philosophy and the structured review chain are his.
- **[@anthropics](https://github.com/anthropics)** — [Claude Code](https://claude.com/claude-code) is the agent runtime that orchestrated the planning. Skills, subagents, tool use, plan mode, and the gstack plugin ecosystem run on top of it.
- **[@karpathy](https://github.com/karpathy)** ([Andrej Karpathy](https://x.com/karpathy)) — his [observations on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876) are the basis for Forme's default coding behavior contract.
- **[@forrestchang](https://github.com/forrestchang)** (Jiayuan Zhang) — packaged Karpathy's observations into the [Karpathy Guidelines skill](https://github.com/forrestchang/andrej-karpathy-skills) that Forme uses. See `CLAUDE.md`.
- **[@lackeyjb](https://github.com/lackeyjb)** (Bryan Lackey) — [playwright-skill](https://github.com/lackeyjb/playwright-skill), used by Forme's test harness for Electron E2E automation.

### Technical foundations

- **[@chenglou](https://github.com/chenglou)** (Cheng Lou) — [Pretext](https://github.com/chenglou/pretext), the text measurement library Forme vendors and depends on for pixel-perfect layout.
- **[John Hudson](https://tiro.com/)** — Tiro Devanagari Hindi and the multi-script type family tradition that makes bilingual typography possible.
- **Radix UI, Tailwind CSS, Electron, Vite, Zustand, dnd-kit, Kysely, sharp, pptxgenjs, mammoth.js, papaparse, pino, Vitest, Playwright, ESLint, Prettier, electron-builder, Phosphor Icons** — Forme is almost entirely stitched from these teams' work.
- **[Google Fonts](https://fonts.google.com/)** — hosting Fraunces (display), Inter (UI), Mukta (Devanagari), and the four print-side pairings.

### Human context

This repo was produced by one person (Adnan Abbasi) in dialogue with AI agents, over the course of a day. That scale of output is only possible because every acknowledgment above did their work first. The software this repo will eventually become is downstream of decades of compounding open-source craft.
