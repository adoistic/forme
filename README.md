# Forme

**An editorial magazine CMS for print. Single operator. Offline. Open source.**

Forme is a desktop app (macOS, Electron) that produces print-ready magazine issues (PowerPoint `.pptx` → PDF) for a single non-technical operator. English, Hindi, and bilingual content are first-class. Ads, classifieds, covers, and auto-versioned history are all built in. No cloud, no accounts, no billing — just typography, layout, and the operator's work.

**Status:** pre-implementation. The planning is done; the code begins with Phase 0.

---

## Why this exists

Most magazine CMS tools target web publishing. The few that target print (InDesign, Scribus, Affinity Publisher) are professional typesetting tools — too expensive, too complex, and too technical for a single operator at a small regional publisher. Forme's goal: let a non-technical operator produce a print-ready issue from start to finish in a single afternoon, with editorial-grade output.

This repository begins with the planning artifacts (CEO plan, engineering plan, design system, test plan, approved mockups) BEFORE any code. The thinking is the product as much as the code is.

---

## What's in this repo (today)

```
.
├── README.md                       ← you are here
├── LICENSE                         ← MIT
├── DESIGN.md                       ← locked design system: tokens, components, voice, a11y
├── TODOS.md                        ← v1.1+ deferrals, each with full context
├── docs/
│   ├── ceo-plan.md                 ← scope, expansions, preconditions, CEO decisions
│   ├── eng-plan.md                 ← locked stack, architecture, test strategy
│   └── test-plan.md                ← QA test surfaces, edge cases, critical paths
└── designs/                        ← 13 approved mockups with AI-drift implementer notes
    ├── README.md                   ← mockup index
    ├── issue-board/                ← signature screen
    ├── first-run-wizard/
    ├── classified-form/
    ├── cover-editor/
    ├── history-panel/
    ├── settings-profile/
    ├── pre-export-check/
    ├── export-progress/
    ├── crash-recovery/
    ├── empty-issue-board/
    ├── articles-tab/
    ├── classifieds-queue/
    └── ads-tab/
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

| Layer | Choice |
|-------|--------|
| Shell | Electron |
| UI framework | React + TypeScript (strict) |
| Build | Vite |
| Styling | Tailwind CSS (tokens from `DESIGN.md`) |
| Components | Radix UI Primitives (unstyled, headless) |
| State | Zustand (with `useShallow` + Immer discipline) |
| Drag-and-drop | dnd-kit |
| Validation | Zod |
| Database | SQLite via better-sqlite3 |
| Query builder | Kysely + kysely-ctl (migrations) |
| Images | sharp (libvips) |
| Docx parsing | mammoth.js |
| CSV parsing | papaparse |
| PPTX writing | pptxgenjs (in Electron utility process, not renderer) |
| Text measurement | @chenglou/pretext (vendored into `vendor/pretext/`) |
| Fonts | Fraunces (display serif) + Inter (UI) + Mukta (Devanagari), bundled |
| Logging | pino (structured JSON, 7-day local rotation) |
| OOXML validation | LibreOffice headless (on pre-export check + Phase 1 harness) |
| Testing (unit) | Vitest |
| Testing (E2E) | Playwright (Electron API) |
| Linting | ESLint + Prettier + Husky + lint-staged |
| Packager | electron-builder (macOS DMG, signed + notarized) |

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

**MVP** (in this plan):
- Phase 0: foundation (Electron + Vite + React + TS + Tailwind + Radix + SQLite + test infra + signing)
- Phase 1: Pretext + PowerPoint scripting + font embedding probes
- Phase 2: one template end-to-end (Standard Feature A4 English)
- Phase 3: Hindi support + A5 sibling + history UI
- Phases 4–13: editorial templates fan-out, poetry, photo essays, service templates, cover, classifieds, ads, bulk import, auto-fit, issue assembly, print-readiness

**v1.1+** (in [TODOS.md](TODOS.md)):
- Windows support
- Voice-to-text classifieds intake (Whisper + local LLM)
- Dark theme
- GitHub Actions CI + notarization pipeline
- Storybook for UI component isolation
- Devanagari UI QA pass
- Orphan blob GC
- …and 10 more delight items each with full context

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
