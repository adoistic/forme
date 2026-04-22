# Engineering Plan — Forme

Locked via `/plan-eng-review` on 2026-04-21. Synthesized from the review session + outside-voice findings + locked decisions.

This document is authoritative for engineering choices. The [CEO plan](ceo-plan.md) is authoritative for scope. [DESIGN.md](../DESIGN.md) is authoritative for visual language. The [test plan](test-plan.md) is authoritative for QA surfaces.

---

## 1. Stack summary

### Runtime

- **Shell:** Electron (latest stable)
- **UI framework:** React + TypeScript (strict mode: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`)
- **Build:** Vite
- **Process model:**
  - **Main process:** SQLite, file system, windows, IPC handlers, file locks, sharp (native), LibreOffice subprocess invocation.
  - **Renderer process:** React UI, Pretext (Canvas-dependent), dnd-kit, Zustand, mammoth (docx), papaparse (CSV).
  - **Utility process:** pptxgenjs (generates PPTX ArrayBuffer, sends via IPC to main for atomic disk write — keeps the UI thread unblocked during export).

### UI

- **Styling:** Tailwind CSS 3+ with `theme.extend` mapping every DESIGN.md token.
- **Components:** Radix UI Primitives (unstyled, headless; we style via Tailwind). Accessibility and keyboard nav come free.
- **State:** Zustand with two disciplines:
  - `useShallow` on every selector for equality checks.
  - Immer patches for mutations to enable structural sharing in snapshots.
- **Drag-and-drop:** dnd-kit (accessibility + keyboard DnD built in).
- **Validation:** Zod (runtime + TS inference from same schema).
- **Icons:** Phosphor Icons regular weight (1.5px stroke) via `@phosphor-icons/react`.
- **Routing:** none. Single-window app; view state handled by Zustand.

### Data

- **Database:** SQLite via `better-sqlite3` (synchronous API; fits Electron main).
- **Query builder:** Kysely (typed, no-runtime-ORM). Migrations via `kysely-ctl`.
- **Blob storage:** content-addressable (SHA-256 via Node's `crypto`), stored at `assets/{tenant-id}/{first-2-hash}/{rest-of-hash}` on disk. Tenant-id is `publisher_default` in MVP.

### File I/O

- **Images:** sharp (libvips). Main process only (native lib not renderer-compatible). Handles ingest, format normalization, DPI validation, sRGB conversion.
- **Docx parsing:** mammoth.js (renderer process; converts docx → HTML → our Article schema).
- **CSV parsing:** papaparse (renderer process; handles BOM, streams large files).
- **PPTX writing:** pptxgenjs (utility process). Output ArrayBuffer sent to main via IPC for atomic disk write (temp → rename).

### Text measurement

- **Pretext** (`@chenglou/pretext`, **vendored into `vendor/pretext/`** for bus-factor protection). Runs in renderer, uses Canvas 2D `measureText()` as ground truth. See the critical caveat in §4 below.

### Fonts

- **Bundled in the installer:** Fraunces (display), Inter (UI), Mukta (Devanagari), plus the 4 print-side typography pairings' font sets. First-run copies missing fonts to `~/Library/Fonts` (user-writable on macOS).
- **Detection:** `document.fonts.ready` before any Pretext call. Missing font blocks the editor (per CEO 1I decision).

### Observability

- **Logging:** pino with structured JSON. Local rotation keeps 7 days at `~/Library/Logs/Forme/`. No remote telemetry auto-sent (per brief and CEO 3C).
- **Diagnostics export:** menu item `Help → Export diagnostics` zips logs + recent snapshots + version info for operator to email when things break.

### IPC

- **Central typed wrapper** with `{ok, error}` result shape. Every handler wrapped in error-catching middleware that logs context (handler name, args summary, stack) and returns structured errors to the renderer. No raw throws crossing the IPC boundary.

### Testing

- **Unit:** Vitest.
- **E2E:** Playwright with `_electron.launch()`. Note: Playwright's Electron API is second-class — pin E2E to a local runner, not CI, for the Pretext pixel-diff harness (font antialiasing differs across machines).
- **Test infra scaffolding:** Phase 0 deliverable alongside the foundation. Includes Vitest config, Playwright config, fixtures directory, golden-export scaffolding, Pretext harness bones, LibreOffice test invocation.
- **Coverage:** ≥ 90% unit coverage for new pure functions + at least 1 integration test per new module. Gated per PR.

### Packaging + distribution

- **Packager:** electron-builder. Target: macOS `.dmg`, signed (Developer ID Application) + notarized via `@electron/notarize`.
- **CI:** none in MVP (solo dev, local `bun run dist` is enough). GitHub Actions workflow is tracked in TODOS.md for when team or Windows port lands.
- **Update mechanism:** none in MVP. Operator reinstalls manually from new `.dmg`. Tracked in TODOS.md as a security TODO.

### Linting + formatting

- **ESLint + Prettier** (not Biome; ESLint has better TS-specific rules in 2026).
- **Husky + lint-staged** pre-commit hooks.

### OOXML validation (per CEO decision 2A)

- **LibreOffice headless** subprocess (`soffice --headless --convert-to pdf`). Runs on:
  1. "Check my issue" screen (before export, for operator-initiated validation).
  2. Phase 2 Pretext-harness (automated template-fidelity gate).
- NOT run on every export (2-5s cost is UX tax). Trusts pptxgenjs + the per-template harness.
- First-run check detects if LibreOffice is installed; if missing, setup prompt points to download.

---

## 2. Folder structure

```
forme/
├── src/
│   ├── main/                     Electron main process
│   │   ├── windows/
│   │   ├── sqlite/              Kysely + better-sqlite3 + kysely-ctl migrations
│   │   ├── blob-store/          SHA-256 content-addressable
│   │   ├── snapshot-store/      auto-save + snapshot + restore
│   │   ├── docx-ingest/         mammoth wrapper + language detection
│   │   ├── image-ingest/        sharp wrapper + DPI/ICC validation
│   │   ├── pptx-writer/         IPC receiver, atomic disk write
│   │   ├── ooxml-validator/     LibreOffice subprocess wrapper
│   │   ├── font-install/        macOS user font dir install + detection
│   │   ├── ipc/                 typed IPC wrapper (main side)
│   │   └── crash-recovery/      single-instance lock + recovery flow
│   ├── renderer/                React UI
│   │   ├── app/                 root + routing-as-state
│   │   ├── screens/             Issue Board, Articles, Classifieds, Ads, Images, Templates, History, Settings
│   │   ├── components/          Radix-wrapped primitives + custom (Button, Modal, Banner, etc.)
│   │   ├── pretext-mapper/      Pretext → PPTX layout object
│   │   ├── stores/              Zustand slices with useShallow + Immer
│   │   ├── csv-import/          papaparse + validation + preview UI
│   │   └── ipc/                 typed IPC wrapper (renderer side)
│   ├── utility/                 Electron utility process
│   │   └── pptx-gen/            pptxgenjs generation (non-blocking UI)
│   ├── shared/                  types, IPC contracts, Zod schemas, utilities
│   │   ├── schemas/             TemplateSchema, ClassifiedSchema × 12, AdSchema, Article, Issue
│   │   ├── errors/              error taxonomy + user-message registry
│   │   └── types/
│   └── assets/                  bundled Google Fonts
├── templates/                   52 JSON template definitions, versioned
├── vendor/
│   └── pretext/                 vendored @chenglou/pretext source
├── tests/                       Vitest unit + Playwright E2E + fixtures
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
│       ├── docx-samples/
│       ├── images/
│       ├── articles/
│       └── devanagari-gate/    Phase 3 QA corpus
├── qa/
│   ├── devanagari-gate.md      runbook for Phase 3 manual QA
│   └── devanagari-gate-YYYYMMDD.md  dated results
└── docs/                       this folder
```

---

## 3. Architecture invariants (non-negotiable)

1. **Templates are data, not code.** One JSON file per template, validated via Zod at load. Rendered by a single renderer function. No per-template component code.
2. **Pretext is the single source of measurement** for the editor preview. The PPTX generator consumes Pretext's layout output; never computes its own line breaks.
3. **Snapshots are content-addressable.** JSON state + SHA-256 blob references. Deduplication free.
4. **Every save creates a snapshot.** Auto-save every 30s + explicit saves + every export.
5. **No cloud calls from core functions.** Offline-first is absolute.
6. **The PPTX export must visually match the Pretext preview.** See §4 for the tolerance model.

---

## 4. The Pretext → PPTX mapping problem (CRITICAL)

**Why this is the #1 risk:**

Pretext uses Canvas 2D `measureText()` as ground truth — the browser's font engine. PowerPoint-macOS uses CoreText. Canvas and CoreText commonly disagree by 1-3% on glyph advances at the same font + size. EMU-precise box positioning fixes box locations, not per-glyph advances inside a line.

**The solution:**

Do NOT let PowerPoint re-typeset. Force it to display exactly what Pretext measured.

Three mapping approaches, tried in order:

1. **Paragraph-per-line OOXML** — each Pretext-measured line becomes its own `<a:p>`. PowerPoint renders line-by-line without running its wrap algorithm. Wide-enough text boxes keep PowerPoint's wrap from firing. Default approach.

2. **Text-box-per-line at explicit EMU coordinates** — each line becomes its own text box at an exact (x, y). Fidelity is near-perfect. Loses editability in PowerPoint (lines are independent), which is fine per brief ("operator does not edit in PPT").

3. **SVG embedding for problem text** — convert a Pretext-rendered HTML block into SVG and embed. Last resort. Loses PPTX text selection and searchability; file size bloats.

**Phase 1 probe validates which approach passes.** Gate: "no line overflows its box in PowerPoint; visual layout reads as identical at normal viewing distance." Measured via LibreOffice headless PDF conversion + pixel diff (ImageMagick `compare -metric AE -fuzz 2%`), with human-in-loop verification for Phase 2's first template.

**If all three fail on Hindi:** the CEO plan's Accepted Scope #2 (Devanagari gate) fails. Options: (a) engineering fix specific to Devanagari glyphs; (b) ship Hindi in v1.1 instead of MVP. Decided at the time based on failure specifics.

---

## 5. Phase 1 preconditions (must resolve before Phase 2 begins)

1. **Pretext → PPTX mapping probe** — prove at least one mapping approach above yields acceptable drift on Standard Feature A4 English.
2. **PowerPoint scripting probe (macOS)** — determine if AppleScript with Office 365 macOS can return per-text-block line counts for automated verification. If not, harness is human-in-loop; adjust timeline.
3. **Font subset embedding verification** — confirm pptxgenjs (or raw OOXML fallback) can embed Google Font subsets that render correctly in Office 365 macOS. Non-trivial historically.

Everything else in [CEO plan open questions](ceo-plan.md#blocking-preconditions-resolve-in-phase-1-before-phase-2) is Publisher Profile first-run config — not an engineering blocker.

---

## 6. Critical engineering gaps flagged

Two failure modes that must be covered in Phase 0 tests (not shipping without):

1. **pptxgenjs utility-process OOM on large issues** — no graceful recovery path currently. Need specific handler: "Export failed due to memory. Try exporting a smaller issue, or restart the app." Logs include the OOM for debugging.
2. **Electron single-instance silent-exit on second launch** — `app.requestSingleInstanceLock()` exits the second process silently without a `second-instance` event handler to bring the existing window forward. Must wire up the handler in Phase 0 and add an E2E test (double-click app icon while running → main window raises).

---

## 7. Key reviewer concerns (carried forward from the engineering review)

Unresolved by design — belong to Phase 1 or later:

- **PowerPoint scripting feasibility (macOS)** — Phase 1 probe.
- **Devanagari rendering diff tool + tolerance** — handled by `qa/devanagari-gate.md` SOP (runbook).
- **CSV parser + encoding edge cases** — papaparse handles most; Hindi UTF-8 CSV with BOM (Excel artifact) is accepted explicitly.
- **File-lock mechanism for crash recovery** — Electron's `app.requestSingleInstanceLock()` is the chosen built-in. Beats PID-based or `proper-lockfile`.
- **Pretext → PPTX mapping approach selection** — locked to paragraph-per-line first, fallback to text-box-per-line, SVG last resort.

---

## 8. Worktree parallelization strategy

13 phases, but after Phase 0–3 are sequential-critical-path, phases 4–10 fan out into 6 parallel lanes:

- Phase 0 → Phase 2 → Phase 3 sequential (foundation + first template + Hindi pipeline).
- Then six parallel lanes:
  - Lane A: Phase 4 editorial templates → Phase 7 service templates (TOC depends on 4).
  - Lane B: Phase 5 poetry templates.
  - Lane C: Phase 6 photo essay templates.
  - Lane D: Phase 8 cover editor.
  - Lane E: Phase 9 classifieds (packing engine + 12 form schemas).
  - Lane F: Phase 10 ads (11 slot defs + placement).
- Merge all six → Phase 11 auto-fit + bulk import → Phase 12 issue assembly polish → Phase 13 print-readiness.

Lanes A, B, C, D all touch `templates/` — but in disjoint subdirectories (`templates/editorial/`, `templates/poetry/`, `templates/photo-essay/`, `templates/cover/`). Merge conflicts should be cosmetic if subdirs stay disjoint.

---

## 9. NOT in scope (this engineering plan)

- GitHub Actions CI (deferred to TODOS.md; solo local `bun run dist` is enough for MVP)
- Sentry / cloud crash reporting (local pino logs + Diagnostics zip export only)
- Component-level Storybook (TODOS.md)
- Cross-platform CI (macOS only; Windows in TODOS.md)
- Performance monitoring in production (local metrics via pino)
- Auto-update channel (operator reinstalls from new `.dmg`)

---

## 10. Next action

Phase 0 begins with:

1. Electron + Vite + React + TS scaffold
2. Tailwind + DESIGN.md token compile
3. Radix + Phosphor component wrapper baseline
4. Zustand store skeleton
5. Kysely + better-sqlite3 + kysely-ctl migration setup
6. IPC typed wrapper
7. Font install + verification logic
8. electron-builder + signing + notarization config
9. Vitest + Playwright config + test fixtures directory
10. LibreOffice install check on first run
11. Vendored Pretext pull into `vendor/pretext/`

Budget: ~3-4 days CC. First deliverable: `bun run dev` opens a window showing an empty Issue Board with DESIGN.md tokens applied, nav sidebar functional, and a passing Vitest + Playwright smoke test.
