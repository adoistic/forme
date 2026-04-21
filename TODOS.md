# TODOS — Magazine CMS

Seeded from `/plan-ceo-review` on 2026-04-21. All items below are deferred from MVP.

Format: [P1/P2/P3] TODO title — owner/phase — effort (human → CC)

---

## Strategic v1.1 candidates

### [P2] Voice intake for classifieds (Whisper + LLM extraction)

**What:** Operator records or uploads a phone call. Local Whisper transcribes. LLM extracts structured fields into the classified form. Operator approves.

**Why:** Classifieds originate from phone calls. Form entry is the operator bottleneck at scale. Voice intake is the single biggest UX win for a publisher with 50+ classifieds/week.

**Pros:** Dramatic operator productivity. Aligns with 12-month AI-assisted vision. Uses the existing classified schema.

**Cons:** Local Whisper is 1-2GB binary + model; bundle or download on demand. LLM choice (local llama.cpp vs. cloud opt-in) is a privacy decision for the operator.

**Context:** Deferred in `/plan-ceo-review` Cherry-pick #6 due to MVP scope. Classified schema (from Accepted Scope #5) remains compatible so this slots in cleanly later. Keep per-type JSON schemas stable to avoid rework.

**Effort:** M (human ~1w / CC ~3d).

**Priority:** P2.

**Depends on:** MVP ships with CSV import path (Accepted Scope #5). Schema stable.

---

### [P2-conditional] Paged.js escape hatch for Hindi rendering

**What:** If the Phase 3 Devanagari-in-PPTX gate fails and option 2a (engineering fix) is infeasible, build a parallel Paged.js + HTML/CSS export path for Hindi content only. PPTX remains for English.

**Why:** Hindi is half the target market (Indian regional publishers). If PPTX can't render Hindi cleanly, the product is incomplete. Paged.js uses Chromium's text engine (same engine Pretext uses), eliminating the rendering gap for Hindi.

**Pros:** Unblocks Hindi if PPTX path fails. Uses the same measurement library (Pretext) as the editor. Straightforward export to PDF.

**Cons:** Two export pipelines to maintain. Architecture debt. Loses "one file format" simplicity.

**Context:** Phase 3 gate failure CEO decision per Accepted Scope #2 is either 2a (fix PPTX) or 2b (Hindi v1.1). Paged.js is option 2c, explicitly rejected for MVP scope in `/plan-ceo-review`. Re-opens as a real option if 2a proves uneconomical.

**Effort:** L (human ~2w / CC ~1w).

**Priority:** P2, CONDITIONAL on Phase 3 gate failure.

**Depends on:** Phase 3 gate result.

---

### [P2] Template versioning in placements

**What:** Store the template JSON version hash alongside each placement so old issues re-render with the template version they were authored against.

**Why:** When MVP ships, templates are bundled with the app. As the product evolves, templates will change. Old issues rendered with NEW templates produce different output than what the operator originally saw. Debuggability suffers.

**Pros:** Time-travel debugging; old issues render faithfully. Supports "compare rendering across template versions" for regression catching.

**Cons:** Storage overhead (tiny). Schema migration when template format evolves.

**Context:** Section 8D finding in `/plan-ceo-review`. Low-effort, high-value. Deferred because MVP templates don't change; becomes critical in v1.1.

**Effort:** S (human ~0.5d / CC ~1h).

**Priority:** P2.

**Depends on:** Template JSON schema frozen (Phase 1 deliverable).

---

### [P3] Dark theme for editor chrome

**What:** Optional dark theme for the editor UI. Preview area stays light (mirrors print output). Chrome (panels, navigation, forms) goes dark.

**Why:** Operators work long hours. Dark theme reduces eye strain. Industry-standard.

**Pros:** Operator comfort. Trendy.

**Cons:** Additional design work, CSS variables must be tokenized from day 1 to avoid rework.

**Context:** Section 11 design consideration. Defer to post-MVP; token-first design system in Phase 0 makes this trivially addable. **DESIGN.md tokens are locked as CSS variables** (`/Users/siraj/Print CMS/DESIGN.md` §2-12) — dark mode is a token swap + a handful of component tweaks (box shadows become lighter, cream bg becomes deep charcoal, etc.). The implementer reading this TODO: start from DESIGN.md, mirror every token with a `--dark-*` prefix, swap via `[data-theme="dark"]` selector at document root.

**Effort:** S (human ~2-3d / CC ~3h) because tokens are ready.

**Priority:** P3.

**Depends on:** DESIGN.md tokens shipped (Phase 0 deliverable per Pass 5).

---

### [P2] Devanagari-specific UI review after Phase 3

**What:** Run `/plan-design-review` specifically on the Devanagari UI: Hindi labels in sidebar nav, Hindi content rendered in Issue Board spread thumbnails, mixed-script error messages, Hindi classified forms (when an operator switches the content-language toggle), Hindi wizard copy.

**Why:** DESIGN.md specifies Mukta for Devanagari but doesn't validate it at every UI scale. Devanagari conjuncts sometimes need extra leading at small sizes (12-14px). Hindi labels may break sidebar width assumptions. Mixed-script error messages may render oddly in toasts.

**Pros:** Catches Hindi UI edge cases before the pilot publisher sees them.

**Cons:** Needs sample Hindi content + test passes. Requires Phase 3 to have shipped.

**Context:** Added by `/plan-design-review` on 2026-04-21. Complements but doesn't duplicate the Phase 3 Devanagari PPTX render gate (which is about PRINT output). This TODO is about UI chrome in Hindi.

**Effort:** S (human ~3-4h / CC ~2-3h).

**Priority:** P2.

**Depends on:** Phase 3 (Hindi templates shipped).

---

### [P2] Windows installer + Windows Office 365 PowerPoint QA

**What:** Port the MVP to Windows. Installer via electron-builder Windows target + SignTool. Re-run Devanagari QA gate on Windows Office 365. Validate pptxgenjs font embedding on Windows.

**Why:** Doubles the addressable market (some Indian publishers are Windows-first). Opens SaaS deployment flexibility.

**Pros:** Market expansion. SaaS path. Relatively low marginal cost if Windows-portability discipline held during MVP (per dev-env decision).

**Cons:** Code signing via SignTool has its own infrastructure. Windows font installation UX differs from macOS. Adds a test platform.

**Context:** Dev-env decision in `/plan-ceo-review` kept code Windows-portable. This is the delivery task.

**Effort:** L (human ~2w / CC ~1w).

**Priority:** P2.

**Depends on:** MVP shipped and stable. A Windows machine for testing (acquire).

---

### [P3] Orphan blob garbage collector

**What:** Background job that finds blobs in the asset store not referenced by any snapshot, lists them, offers operator to review + delete.

**Why:** When history compaction lands (v1.1: "keep one per day older than 30 days"), deleted snapshots leave behind unreferenced blobs. Without GC, disk fills over time.

**Pros:** Disk hygiene. Storage cost control.

**Cons:** Race conditions with live editing. Must run in a "locked" mode.

**Context:** Section 1C finding. Prerequisite for the history-compaction feature (also v1.1).

**Effort:** S (human ~1d / CC ~2h).

**Priority:** P3.

**Depends on:** History compaction feature (v1.1, not tracked separately yet).

---

## Lower-priority delight pack (individual items per user preference)

### [P3] Font substitution safety check

When operator uses Section 7.4 font override, verify the substitute font has all required glyphs for the operator's content (especially Devanagari conjuncts). Warn with glyph-missing preview before applying.

Effort: S. Depends on: Section 7.4 UI shipped.

---

### [P3] Typography pairing preview page

Operator can view sample page renders (cover, feature opener, poem, classifieds) in all 4 typography pairings side-by-side, before committing to a pairing for an issue.

Effort: S. Depends on: Pairings in Publisher Profile.

---

### [P3] Cover variant thumbnails

Operator sees thumbnail previews of how the cover would look in each available cover variant (hero-dominant, stacked, etc.) with live content, before committing.

Effort: S. Depends on: Cover editor shipped.

---

### [P3] Classifieds deduplication beyond phone + billing-ref

Fuzzy-matching duplicates using name normalization (after Hindi collation work). Flag "this looks similar to an existing entry" at form submit.

Effort: M (normalization is the hard part). Depends on: CSV import shipped.

---

### [P3] Template style tokens

Each template exposes 2-3 style tokens (accent color, display font weight, divider style) per issue without breaking "templates are sacred." Lets operator change an issue's "feel" without component edits.

Effort: M. Depends on: Template JSON schema extension.

---

### [P2] Issue-to-web HTML export

Export an issue as static HTML (no PPTX) for the publisher's website. Different rendering pipeline than print. Strong SaaS differentiator.

Effort: M. Depends on: Template → HTML renderer built (separate from PPTX path).

---

### [P3] Printer profile upload

Operator uploads their printer's color profile + paper spec + bleed requirements. System warns on profile-specific violations.

Effort: S. Depends on: Publisher Profile shipped.

---

### [P3] Backup-as-ZIP export

"Export this issue as ZIP including PPTX + exported PDF + all images + fonts + README for printer" for archival or printer handoff.

Effort: S. Depends on: Export pipeline shipped.

---

### [P3] Issue structure duplication ("clone last issue skeleton")

Button that creates a new issue with the page skeleton of the previous one (section openers, TOC, masthead, back matter, ad pages) pre-placed but empty. Operator fills in content.

Effort: S. Depends on: Issue Board shipped.

---

### [P3] Crash recovery thumbnail previews

Recovery dialog shows small thumbnails of the 3 most recently changed pages (requires thumbnail rendering at snapshot time). Currently MVP shows text-only "last edited: article X, page 4."

Effort: M. Depends on: Snapshot thumbnail rendering infrastructure.

---

### [P3] Per-issue ignore list for pre-export warnings

Operator can "ignore this warning for this issue" from the pre-export check screen. Requires persistence per issue.

Effort: S. Depends on: Pre-export screen shipped.

---

## Added by /plan-eng-review on 2026-04-21

### [P2] GitHub Actions CI for build + test + notarization

**What:** Workflow running on every PR (Vitest + ESLint + Playwright local-runner gate) and on tag push (electron-builder + `@electron/notarize` + GitHub Releases upload).

**Why:** Solo local builds are fine for MVP, but once there's a team, pilot publisher, or Windows port, CI prevents unsigned DMGs shipping accidentally and catches regressions automatically.

**Pros:** Release automation, no human in the critical path for notarization/signing.

**Cons:** Notarization requires handling Apple credentials in secrets (Apple app-specific password or app-store-connect-api-key). Setup effort ~3-4 days.

**Context:** Added by /plan-eng-review outside voice. Locked MVP is local builds (`bun run dist`). When team grows / Windows port lands, this becomes important.

**Effort:** M (human ~3d / CC ~1d).
**Priority:** P2.
**Depends on:** —

---

### [P3] Storybook (or Ladle) for component library

**What:** Visual component playground for Radix-based UI primitives (our form fields, dialogs, tabs, drag-handles, color pickers). Render in isolation without running full Electron app.

**Why:** Iterate on UI without spinning up Electron. Serves as future designer handoff artifact. Catches visual regressions in components in isolation.

**Pros:** Faster UI iteration; component-level visual regression testing via Storybook's Chromatic or similar.

**Cons:** Extra build artifact to maintain. Marginal value for single-user product; high value once team grows.

**Context:** Added by /plan-eng-review. Not needed for MVP single-user workflow.

**Effort:** M (human ~3-5d / CC ~1d).
**Priority:** P3.
**Depends on:** design system tokens (Phase 0 deliverable).

---

### [P3] Windows CI runner for Devanagari rendering QA

**What:** Once Windows port TODO (above) lands, add a Windows runner to the CI workflow that renders sample Hindi PPTXs and performs the Phase 3 Devanagari gate automatically.

**Why:** Currently Devanagari QA is manual on macOS Office 365. Without Windows automation, every Windows release would require a person with Windows Office 365 to verify.

**Pros:** Cross-platform regression safety.

**Cons:** Windows runners on GitHub Actions cost more credits; PPTX→image rendering on Windows is non-trivial.

**Context:** /plan-eng-review outside voice flagged this. Pairs with Windows port TODO; do them together.

**Effort:** M (~3-5d CC post-Windows-port).
**Priority:** P3.
**Depends on:** Windows port TODO.

---

## Explicitly NOT in TODOS (considered + rejected with reasoning)

- **SQLCipher passphrase encryption for classified PII.** Rejected. Classifieds PII is printed publicly in the magazine. Encryption-at-rest on the operator's laptop protects nothing that isn't already on every newsstand. FileVault covers theft protection of the laptop generally. Documented here so a future reviewer doesn't re-raise the idea without considering the public-print reality.
