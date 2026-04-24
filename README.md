# Forme

**An editorial magazine CMS for print. Single operator. Offline. Open source.**

Forme is a desktop app (macOS, Electron) that produces print-ready magazine issues (PowerPoint `.pptx` → PDF) for a single non-technical operator. English, Hindi, and bilingual content are first-class. Ads, classifieds, covers, and auto-versioned history are all built in. No cloud, no accounts, no billing — just typography, layout, and the operator's work.

**Status:** v0.6 — end-to-end export is working, and the daily-friction gaps from v0.5 (hero upload, drag-reorder, manual ad placement, save-as dialog, CSV format docs) are closed. Article-level edit history with a diff viewer and restore is in. Honest list of what's working vs. what isn't is below.

---

## v0.6 — what's working, what isn't

**Run it yourself:** [download the unsigned macOS DMG](https://github.com/adoistic/forme/releases/tag/v0.6.0) from the v0.6.0 release. macOS Gatekeeper will block first launch (no Apple Developer ID yet — that's part of v0.8). Right-click → Open → Open. The unsigned warning is intentional for the preview.

### ✅ Working today

- **Issues** — create with title, number, date, A4/A5 page size, English / Hindi / bilingual language, four typography pairings.
- **Articles via in-app editor** — `NewArticleModal` + `EditArticleModal` host a BlockNote rich-text editor (with a markdown source tab). Paste body, set headline + deck + byline + content type, save. Auto-detects language from the body (35% Devanagari → Hindi, 5% → bilingual). Paste is sanitised through DOMPurify.
- **Articles via .docx upload** — drag a Word file in. Mammoth parses it; Hindi byline / deck patterns recognised; duplicate-headline rows stripped automatically.
- **Hero image upload (new in v0.6)** — file picker, URL paste, and drag-drop in the article modals. URL fetches pass through an SSRF guard (private / link-local / metadata IPs rejected) and re-encode via sharp.
- **Article edit history (new in v0.6)** — per-article snapshot store using jsondiffpatch deltas, a date-grouped history panel with keyboard navigation, a side-by-side diff viewer (block-level map + intra-block char diff), and one-click restore. Unsaved-edits restore dialog fires on next open after a crash.
- **Issue history timeline (new in v0.6)** — issue-level activity tab aggregating article, classified, and ad changes for the current issue.
- **Layout pipeline** — pretext + Skia canvas measurement + per-paragraph hyphenation (English + Hindi Knuth–Liang patterns), per-script line counting, balanced column packer with sentence-boundary splits, first-page geometry shared between layout planner and PPTX renderer (so they can't drift). 78 % average body fill across the demo magazine, no overflow into footers (audited per-page; see `scripts/audit-all-pages.ts`).
- **Classifieds** — 12 types (matrimonial with/without photo, obituary, public notice, announcement, vehicles, property, jobs, etc.). Three intake paths: bulk CSV import (proven against a 120-row file in the E2E suite), **JSON import with per-type column reference panel (new in v0.6)**, and single-classified form (`AddClassifiedModal`).
- **Ads with structured placement (updated in v0.6)** — 11 slot types (`full_page`, `double_page_spread`, `half_page_horizontal/vertical`, `quarter_page`, `strip`, `vertical_strip`, `eighth_page`, `cover_strip`, `corner_bookmark`, `section_sponsor_strip`). Aspect ratio + DPI validated on upload (sub-150 DPI rejected). Placement is now a typed schema with radio-button UI: inside-front-cover, inside-back-cover, back-cover, between-articles, bottom-of-article.
- **Drag-reorder (new in v0.6)** — articles, classifieds, and ads all reorderable via `dnd-kit` using fractional positions (no cascading rewrites on reorder).
- **Save-as dialog on export (new in v0.6)** — `dialog.showSaveDialog` with last-directory memory and reveal-in-Finder after write. No more fixed export path.
- **Storage settings (new in v0.6)** — per-article disk usage panel in Settings; app-shell threshold banner warns at configurable levels and re-arms at +100 MB, with a critical tier at 1 GB.
- **PPTX export** — produces cover → IFC ad → TOC → articles (interleaved with between-ads) → classifieds → IBC → BC. Per-article folios (recto/verso), running headers, body justification + 4 pt paragraph spacing, embedded Fraunces / Inter / Mukta fonts.
- **PDF rendering** — LibreOffice headless converts the `.pptx` to PDF for the operator's printer. `scripts/audit-all-pages.ts` rasterises every page and reports body fill %, overflow, column unevenness.
- **Tests** — Vitest unit + integration suite (557 tests at v0.6); Playwright E2E spec (`tests/e2e/big-issue.spec.ts`) drives the actual UI to build a 20-article + 120-classified + 5-ad-position issue and asserts the export. Runs in 2.1 minutes on a Mac.
- **Accessibility + motion** — global `prefers-reduced-motion` respected in CSS; focus rings preserved on keyboard nav through history panels and modals.
- **Crash + diagnostics** — pino structured logging, single-instance lock, snapshot/recovery store.
- **Window behaves on small screens** — capped to the macOS work area (won't push the bottom of the window behind the Dock).

### 🚧 Known gaps (deferred to v0.7 / v0.8)

These are real, the operator will hit them; they're listed honestly so v0.6 isn't oversold:

| #   | Gap                             | What's missing                                                                                                                                                                                                                                          |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Side-image article layouts**  | Only three image placements exist (`below-headline`, `above-headline`, `full-bleed`). No inline figure with text wrapping around it. Pretext's `layoutNextLineRange(width)` supports the variable-width line stepping needed; not yet wired.            |
| 2   | **Poetry templates**            | `Poem` is a valid `contentType` and `poetry` is in the template-family enum, but no `poetry.json` template exists yet. Poems route to the default feature template today. Quatrain / short / long / multi-poem-per-page packing is the v0.7 brainstorm. |
| 3   | **Code-signed + notarized DMG** | v0.6 DMG ships unsigned. Apple Developer ID + notarization is v0.8, shipped together with App Sandbox + Hardened Runtime (sandbox issues only surface in signed builds).                                                                                |

### 🗺️ What's next

- **v0.7** — poetry layouts (3+ templates) and side-image article layouts using pretext's `layoutNextLineRange`.
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

## Pretext in Node, for print

[Pretext](https://github.com/chenglou/pretext) is a browser-first text measurement library by Cheng Lou. It exists to skip DOM reflow in web apps: measure how tall a paragraph will be at a given width without mounting it, by running `OffscreenCanvas.getContext('2d').measureText` over segmented, shaped runs. Its normal home is in-browser virtualization, masonry, JS-driven flex layouts, and development-time overflow checks.

Forme uses Pretext in Node — inside the Electron main process — to plan **print pages** for a PowerPoint export. As far as we know, this is the first shipping use of Pretext outside a browser and outside a web UI.

**The problem.** PowerPoint wraps and justifies body text itself, but we need to know _before_ we write a single shape how many visual lines each paragraph will occupy at the column width and typography of the chosen template. Get the count wrong and the column spills past the body trim into the running footer. The old heuristic (chars-per-line × lines-per-column) drifted 4–12%; columns that looked full in the planner ended up 20–40% empty after PowerPoint actually rendered.

**How the bridge works** ([src/main/pptx-prelayout](src/main/pptx-prelayout/)):

- **`OffscreenCanvas` shim over Skia.** Pretext grabs `new OffscreenCanvas(1,1).getContext('2d')` at module load. Node doesn't have it; we install a ~30-line shim over [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) (Skia) before importing Pretext. See [measure.ts](src/main/pptx-prelayout/measure.ts).
- **The exact print fonts, registered in Skia.** Bundled Fraunces (display), Inter (UI), and Mukta (Devanagari) TTFs are loaded into `GlobalFonts` before the first `measureText`. Without this, Skia picks whatever it can find and widths drift by a few pixels per run — enough to widow a last line or re-wrap a column in the .pptx.
- **Measure, don't wrap.** Only `prepareWithSegments` + `measureLineStats(prepared, colWidthPx).lineCount` are used. The returned visual-line count at the exact column width is the input to our column packer. PowerPoint does the actual wrap + justify on its side; both engines agree because they're measuring the same text in the same font at the same size.
- **Soft-hyphen densification.** Body paragraphs are pre-processed through Knuth–Liang patterns (English + Hindi) so U+00AD soft hyphens land inside long words. Pretext treats them as discretionary break candidates; PowerPoint renders the hyphen glyph only at the line end where a break actually happens — invisible everywhere else. Net result: 10–20% denser justified columns, the same trick every print magazine uses.
- **Devanagari correction.** Skia's Mukta shaper under-counts because it doesn't expand stacked matras + conjuncts the way LibreOffice's HarfBuzz does at render time. For Hindi paragraphs we take `max(pretext_count, char_width_fallback)` so the planner overshoots slightly rather than overflows.

**The output** is `pages[pageIdx][colIdx] = paragraphs[]` — one PPTX paragraph per entry, spillover sentence-split at the column break (Latin `.!?`, Devanagari `।`, CJK `。`, Arabic `؟` all recognised) so no paragraph gets orphaned. First-page geometry is shared between planner and renderer via [first-page-geometry.ts](src/shared/pptx-builder/first-page-geometry.ts) so they can't drift.

**How Pretext helps PowerPoint.** PowerPoint doesn't plan layout across pages — it fills one text box at a time. Give it a monolithic 10,000-character body string in a fixed-size box and one of two things happens: the text runs past the bottom (overflow into the footer), or PowerPoint's auto-fit silently shrinks the type to 9.3pt to make it fit (defeating the template's typography). Pretext's job is to pre-decide the split: _"paragraph A is 7 lines at 14pt Fraunces in a 2.15″ column, paragraph B is 4 lines, paragraph C spills after the 3rd sentence"_. Forme then emits one fixed-size text box per column — sized to the column rectangle in inches — with exactly the paragraphs the planner said would fit. PowerPoint wraps inside that box (honouring the soft hyphens), justifies non-final lines, and the rendered column lands on the same visual lines the planner predicted (within ±1). Across 73 pages of the demo magazine, that's the difference between "the operator opens the .pptx and is done" and "the operator opens the .pptx and finds half the columns bleeding into the footer."

**Why Pretext, not math.** The cheap substitute — `chars-per-line × lines-per-column` — drifts 4–12% because a proportional font's `'l'` is not an `'M'` and justified-text space-stretching is a per-line negotiation, not a constant. The old Forme planner used exactly this heuristic; columns that looked 100% full in the planner ended up 60–80% full after PowerPoint rendered. The next step up, measuring every glyph and running Knuth–Plass line-breaking ourselves, is a multi-thousand-line typesetting project — and it would still need script-aware shaping (Devanagari conjuncts, Arabic ligatures, bidi text) to be accurate. Pretext is the thing that already does all of it: segmentation, canvas-based width measurement, greedy line-breaking, soft-hyphen honouring, `wordBreak` / `whiteSpace` modes, RTL-aware segments. Plugging it in + patching the one place Skia's Mukta shaper under-counts is a few hundred lines; rolling our own is the rest of the project.

**Why this is unusual.** Pretext's whole design case is "don't hit the DOM in the browser." Forme is already Electron; a hidden DOM would be cheap. We reach for Pretext anyway because measurement has to happen _in the main process_ where the PPTX is assembled, outside the renderer, and it has to match what PowerPoint will draw on the other side. Pretext + Skia + the same TTFs PowerPoint embeds gets us that agreement without shipping a PowerPoint-compatible text shaper of our own.

**Audit proof.** `scripts/audit-all-pages.ts` rasterises every page of the exported PDF and reports body fill %, overflow into footers, and column unevenness. The v0.6 demo magazine averages 78% fill across 73 pages with zero footer overflow.

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

**Shipped (v0.5):** Foundation, layout pipeline, PPTX export, PDF render verification, classifieds CSV import, ad upload + position routing, in-app rich-text/markdown article composition, per-paragraph hyphenation, three templates (feature, photo-essay, long-form).

**Shipped (v0.6):** Article edit history (snapshots + diff viewer + restore), issue history timeline, BlockNote editor with lazy migration, hero image upload (file/URL/drag-drop with SSRF guard), JSON classifieds import + per-type column reference, drag-reorder for articles + classifieds + ads (fractional positions via `dnd-kit`), structured ad placement schema, save-as dialog with last-directory memory, storage settings + threshold banner, DOMPurify paste hardening, `prefers-reduced-motion` support. See "v0.6 — what's working, what isn't" above.

**v0.7 — typography expansion:** poetry templates (quatrain, short, long, multi-poem-per-page), side-image article layouts using pretext's `layoutNextLineRange`.

**v0.8 — distribution:** code-signed + notarized macOS DMG (Apple Developer ID) + App Sandbox + Hardened Runtime + entitlements, auto-update channel.

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
