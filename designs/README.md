# Design mockups

13 approved mockups covering the signature screens of Forme, generated via the gstack designer (OpenRouter) and approved via `/plan-design-review` + `/design-shotgun` on 2026-04-21.

## How to read this folder

Each screen folder contains:

- `approved.png` — the approved variant (the other generated variants are not in the repo).
- `approved.json` — the implementer's contract:
  - `direction`: the layout/composition intent.
  - `feedback`: why this variant was chosen.
  - `ai_drift_notes`: **specific AI drift to ignore** (wrong nav items, typos like "TEDAY", Safari chrome bleed, wrong typography pairing names, etc.).
  - `implementation_correction`: where the mockup differs from the CEO plan and which one wins.

**The mockups are directional.** [DESIGN.md](../DESIGN.md) is authoritative for tokens, components, and behavior. When in doubt, follow DESIGN.md. The mockups inform layout, hierarchy, and density — not pixel values.

---

## Index

### Primary screens (from `/plan-design-review`)

- **`issue-board/`** — signature screen. Facing-page spread grid. 8-tab sidebar, rust accent on selection, auto-save indicator.
- **`first-run-wizard/`** — Publisher Profile step (step 2 of 3). Display-serif headline + italic subline + typography pairing cards + language pill selector.
- **`classified-form/`** — modal pattern. Two-column layout with photo drop zone, marital-status pill selector, language toggle, "Save to queue" primary action.

### Secondary screens (from `/design-shotgun`)

- **`cover-editor/`** — split-pane (form left 40% / live cover preview right 60%). Cover lines add/remove, masthead + hero + barcode.
- **`history-panel/`** — full-tab view. Timeline on left, snapshot preview on right. "Restore this version" outlined primary.
- **`settings-profile/`** — sectioned cards in two columns. Per-card save link. House-style accent color swatch row.
- **`pre-export-check/`** — page-overlay. Spread grid with severity-outlined spreads + right findings panel with "Focus page" navigation.
- **`export-progress/`** — standalone "Done." success modal at maximum typographic weight.
- **`crash-recovery/`** — inline banner at top of main canvas (not blocking modal). Three buttons: Discard / Open fresh / Restore from HH:MM + X-close.
- **`empty-issue-board/`** — centered CTA card ("Let's put something on page 1.") on wireframe spread grid.
- **`articles-tab/`** — list view with drag handles, thumbnails, metadata columns, three-dot menu.
- **`classifieds-queue/`** — grouped-by-type collapsible sections (Matrimonial / Obituary / Property / etc.).
- **`ads-tab/`** — grouped-by-publication-position with true-aspect-ratio thumbnails and Filled/Open status chips.

---

## Design process

These mockups came from two review passes:

1. **`/plan-design-review`** (full 7-pass review): rated the plan's design completeness from 4/10 → 9/10. Established DESIGN.md, approved 3 signature screens. Outside voice: Claude subagent.
2. **`/design-shotgun`** (visual exploration): generated 20 layout variants (10 screens × 2 compositions each) in parallel subagent waves. User picked one composition per screen. Total time: ~27 minutes.

Both passes used the gstack designer (Google Gemini image gen via OpenRouter).

---

## What's NOT in this folder

- Rejected variants (kept in `~/.gstack/projects/PrintCMS/designs/` on the author's machine; not pushed for repo size).
- CSV bulk import flow (gap; implementer builds from DESIGN.md form patterns).
- Hindi/Devanagari UI versions (gap; tracked in [TODOS.md](../TODOS.md) as a v1.1 review — run `/plan-design-review` on Devanagari chrome after Phase 3).
- Per-template content layouts (the 52 print templates are a separate concern — they render PPTX output, not editor chrome, and have their own design session in Phase 4+).

---

## Regenerating mockups

If the design direction shifts and these mockups go stale:

```bash
# Re-run the full design exploration
# Requires ~/.gstack/openrouter.json with an OpenRouter API key
/design-shotgun
```

Approved mockups should be re-exported to this folder via `cp` from `~/.gstack/projects/PrintCMS/designs/*/approved.png`.
