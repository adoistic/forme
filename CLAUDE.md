# CLAUDE.md — Forme

Context for Claude Code (and any other AI coding agent) working in this repo.

---

## What this project is

Forme is an editorial magazine CMS for print-ready output. Single non-technical operator, offline-first desktop Electron app, macOS MVP, ships `.pptx` files the operator exports to PDF in PowerPoint. See [README.md](README.md) for the product pitch.

**Status:** planning-complete, pre-implementation. No `src/` yet. The first feature commit starts Phase 0 per `docs/eng-plan.md`.

---

## How to work in this repo

The planning artifacts are authoritative. When you land in this repo, read in this order:

1. [README.md](README.md) — what the product is and who it's for
2. [docs/ceo-plan.md](docs/ceo-plan.md) — scope, accepted expansions, "NOT in scope," CEO decisions
3. [docs/eng-plan.md](docs/eng-plan.md) — locked engineering stack, process model, Phase 0 checklist
4. [DESIGN.md](DESIGN.md) — design tokens, components, voice, accessibility floor
5. [docs/test-plan.md](docs/test-plan.md) — QA test surfaces, edge cases, critical paths
6. [designs/](designs/) — 13 approved mockups + `approved.json` with AI-drift notes per screen
7. [TODOS.md](TODOS.md) — what's deferred to v1.1+ and why

If a user asks you to build something, assume they want it to align with these artifacts. If a request contradicts them, surface the contradiction rather than silently picking one.

---

## Coding philosophy: Karpathy guidelines (primary)

This project uses the **karpathy-guidelines** skill (installed from [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)) as the default behavioral contract for any coding work.

**Invoke the skill** (`/karpathy-guidelines`) before writing, reviewing, or refactoring code. Its four principles take precedence over the general instinct to "just write it":

### 1. Think Before Coding
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them. Don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes
- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it. Don't delete it.
- Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
- Transform tasks into verifiable goals. "Add validation" → "Write tests for invalid inputs, then make them pass."
- For multi-step tasks, state a brief plan with per-step verification.
- Strong success criteria let the agent loop independently. Weak criteria require constant clarification.

**When Forme-specific rules (below) and Karpathy guidelines conflict:** Karpathy wins on **how** to write code; Forme's planning docs win on **what** to build.

---

## Ground rules specific to Forme

- **Never add features beyond CEO-plan accepted scope.** Adding a feature means either a new `/plan-ceo-review` pass or a TODO in `TODOS.md` with explicit reasoning. Not a drive-by commit.
- **Templates are data, not code.** Template JSON schemas are validated via Zod at load. No per-template component code. See `docs/eng-plan.md` §3.
- **Mockups are directional, not pixel-perfect.** `DESIGN.md` tokens are authoritative. Each `designs/*/approved.json` lists the AI-drift to ignore (wrong nav items, typos, stylistic bleed). Read both the PNG and the JSON together.
- **Pretext → PPTX mapping is the #1 technical risk.** Read `docs/eng-plan.md` §4 before touching the mapping layer. Phase 1 probes gate Phase 2.
- **macOS only for MVP.** Windows port is in `TODOS.md`. Keep code Windows-portable: no macOS-only APIs outside well-scoped modules.
- **No telemetry auto-sent from the app.** Local pino logs + operator-initiated Diagnostics export only. `docs/eng-plan.md` §1 (observability).
- **Classifieds PII is already public.** It prints in the magazine. Don't propose SQLCipher or encryption-at-rest for MVP. See `TODOS.md` "Explicitly NOT in TODOs" for the reasoning.

---

## Tech stack (locked)

See `docs/eng-plan.md` §1 for the full list. Quick reference:

- Electron + React + TypeScript (strict) + Vite
- Tailwind CSS (tokens from `DESIGN.md`) + Radix UI Primitives
- Zustand (with `useShallow` + Immer discipline) + dnd-kit + Zod
- better-sqlite3 + Kysely + kysely-ctl (migrations)
- sharp (main-process only) + mammoth + papaparse
- pptxgenjs (utility process, not renderer) + @chenglou/pretext (vendored in `vendor/pretext/`)
- pino logs + LibreOffice headless for OOXML validation
- Vitest (unit) + Playwright (Electron E2E, local-only gate)
- ESLint + Prettier + Husky + lint-staged
- electron-builder (macOS `.dmg`, signed + notarized)

**Do not swap stack choices without a new `/plan-eng-review` pass.** Each choice has a documented reason.

---

## Testing

Expected once Phase 0 lands:

```
bun run test        # Vitest unit + integration
bun run test:e2e    # Playwright Electron E2E (local-only, not CI)
bun run lint        # ESLint
bun run format      # Prettier
bun run typecheck   # tsc --noEmit
```

**Coverage target:** ≥ 90% for new pure functions + at least 1 integration test per new module. Every PR must include tests for new code. See `docs/test-plan.md` for the full QA surface.

---

## Commit conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- First line under 72 chars
- Body explains **why**, not what (the diff shows what)
- Reference the planning doc driving the change when relevant, e.g.:
  `feat(issue-board): spread grid per docs/eng-plan.md §2`

---

## Skill routing

When a matching skill exists, invoke it FIRST. Skills encode disciplined workflows; the default "just answer" path is a last resort.

| Situation | Skill |
|-----------|-------|
| Writing, reviewing, or refactoring code | `/karpathy-guidelines` (always, as the coding contract) |
| Pre-landing diff review | `/review` (or the equivalent in your harness) |
| Significant new feature or scope change | `/plan-ceo-review` |
| New architecture decision or library swap | `/plan-eng-review` |
| New screen, UI direction, or visual audit | `/plan-design-review` (plan-stage) or `/design-review` (implemented) |
| Explore alternate visual directions | `/design-shotgun` |
| Turn approved mockup into HTML/CSS | `/design-html` |
| Bugs, errors, unexpected behavior | `/investigate` |
| QA the running app | `/qa` |
| Shipping a PR | `/ship` |
| Save work-in-progress state | `/checkpoint` |
| Weekly retrospective | `/retro` |

Skills run at plan-stage or implementation-stage, not as post-hoc validation. Use them early.

---

## When to ask vs. when to act

**Always ask when:**
- A request contradicts `docs/ceo-plan.md`, `docs/eng-plan.md`, or `DESIGN.md`.
- The user's framing is ambiguous and you'd have to pick one interpretation.
- You're about to introduce a pattern not in `DESIGN.md`.
- A Phase 1 precondition is unresolved (Pretext probe, PowerPoint scripting probe, font embedding probe).
- The change would require a scope addition (propose a TODO or a `/plan-ceo-review` pass).

**Act without asking when:**
- The work is clearly scoped by an existing doc (e.g., "implement Phase 0 foundation").
- It's a bug fix for existing code (show the fix + a regression test).
- The user explicitly says "just do it" or "don't ask, ship it."

---

## Contributing voice

Commits, PR descriptions, code comments, error messages, and docs aimed at end users should match Forme's product voice (see `DESIGN.md` §13):

- Confident and quiet. No exclamation marks except in genuine celebration ("You're ready.").
- Plain English. Avoid jargon. The operator is non-technical.
- Label specificity. "Save to queue," not "Save." "Export to PowerPoint," not "Export."
- Error messages explain and suggest. "We couldn't read that .docx. Try re-exporting from Word." Not "Error parsing file."
- Reassurance in progress states. "Setting up your fonts..." not "Loading..."

Internal-only text (log messages, technical error codes, test names) can be terser.

---

## One-line summary

**Build what the plan says. Test what you build. Touch only what you must. Ask when you don't know. Ship when it's done.**
