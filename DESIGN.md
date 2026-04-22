# DESIGN.md — Magazine CMS

Single source of truth for visual language. Locked by `/plan-design-review` on 2026-04-21 using three approved mockups as the reference. Extended on 2026-04-22 by `/design-shotgun` (v0.6 net-new surfaces) with three additional approved mockups.

**Approved mockups** (visual ground truth):

- `~/.gstack/projects/PrintCMS/designs/issue-board-20260421/variant-B.png` — Issue Board (THE signature screen).
- `~/.gstack/projects/PrintCMS/designs/first-run-wizard-20260421/variant-C.png` — First-run wizard, Publisher Profile step.
- `~/.gstack/projects/PrintCMS/designs/classified-form-20260421/variant-C.png` — Classified form (Matrimonial with Photo, representative modal).
- `~/.gstack/projects/PrintCMS/designs/edit-article-modal-3pane-20260422/variant-C.png` — EditArticleModal 3-pane (v0.6: 200/516/280 list/editor/print-preview, "Portfolio Spread" direction).
- `~/.gstack/projects/PrintCMS/designs/scrub-timeline-detail-20260422/variant-A.png` — ScrubTimeline detail (v0.6: vertical typeset list with date dividers, hover callout, ⌘F search).
- `~/.gstack/projects/PrintCMS/designs/diff-viewer-overlay-20260422/variant-C.png` — DiffViewer overlay (v0.6: modal-on-modal with diff heatmap rail + focused paragraph BEFORE/AFTER).

Any future screen must visually agree with these. If it doesn't, re-review before building.

---

## 1. Design principles

1. **Editorial, not admin.** This is a magazine tool, not a SaaS dashboard. Typography-forward, generous whitespace, warm.
2. **Typography does most of the work.** Chrome uses one display serif + one sans. Everything else is color, spacing, and restraint.
3. **Rust accent earns every appearance.** Used for primary actions, active states, accents. Never decorative.
4. **Cards earn their existence.** Spread thumbnails are cards because they ARE the navigable content. Don't add cards for decoration.
5. **Empty states are features.** Every empty state has a specific CTA + warmth. Never "No items found."
6. **Subtraction default.** If a UI element doesn't earn its pixels, cut it.
7. **Hierarchy serves the task.** The operator's current work is the loudest thing on screen.

---

## 2. Color tokens

```
/* Canvas */
--color-bg-canvas:          #F5EFE7   /* cream — main app background, inside the window */
--color-bg-surface:          #FFFFFF  /* cards, modals, input backgrounds */
--color-bg-overlay:          rgba(26,26,26,0.50)   /* modal scrim */

/* Text */
--color-text-primary:        #1A1A1A  /* deep charcoal, body + headings */
--color-text-secondary:      #5C5853  /* muted, supporting text + labels */
--color-text-tertiary:       #9B958E  /* even more muted, timestamps, hints */
--color-text-inverse:        #FEFCF8  /* on-rust text */
--color-text-link:           #C96E4E  /* rust, only for interactive text */

/* Accent (rust / terracotta — THE ONLY ACCENT) */
--color-accent:              #C96E4E  /* default rust */
--color-accent-hover:        #B85942  /* rust, deeper */
--color-accent-pressed:      #A64733  /* rust, deeper still */
--color-accent-muted:        #E8C4B3  /* tinted background (rust + 70% white) */
--color-accent-bg:           #FCF1EC  /* very light rust wash for selected states */

/* Borders */
--color-border-default:      #E5DFD5  /* cream-cast border */
--color-border-strong:       #D4CBB8  /* for active/focused fields */
--color-border-dashed:       #C96E4E  /* dashed drop zones use rust */

/* Semantic (restrained — rust is primary) */
--color-success:             #4A7C59  /* muted forest green */
--color-warning:             #C9904E  /* mustard-adjacent, stays warm */
--color-error:               #B84545  /* muted brick red, harmonizes with rust */
--color-info:                #5C7A9E  /* muted navy, used rarely */

/* Semantic backgrounds (for toast + inline alerts) */
--color-success-bg:          #EEF3EE
--color-warning-bg:          #FAF3E8
--color-error-bg:            #F5E8E8
--color-info-bg:             #E8EEF3
```

**Important:** the Publisher Profile "house style accent" picker selects a PRINT-SIDE color that applies to dividers, pull quotes, section labels in the EXPORTED PPTX. It does NOT override the UI chrome rust. The chrome rust is a product color, not a brand color. Resolved per Pass 7 decision 7D.

---

## 3. Typography

### Display serif (the editorial voice)

**Primary choice: Fraunces (Google Fonts, SIL OFL).** Variable font, excellent at display weights, modern-but-warm character. Fallback: Playfair Display Black.

Used for: masthead wordmarks, page/modal titles, wizard headlines, empty-state headlines.

### Sans-serif (the chrome)

**Primary choice: Inter (Google Fonts, SIL OFL).** Variable, excellent screen rendering, strong for labels and numbers.

Used for: everything else — nav labels, buttons, form inputs, body text, metadata.

### Devanagari (Hindi previews + Hindi chrome text)

**Primary choice: Mukta (Google Fonts, SIL OFL).** Matches Inter's proportions for mixed-script UI labels. For magazine preview content, the operator's chosen typography pairing (Editorial Serif/News Sans/Literary/Modern Geometric) applies.

---

## 4. Type scale

```
name            px/rem     line-height   weight   use
----            ------     -----------   ------   ---
display-xl      56/3.5     1.05           800      "You're ready." / wizard headline
display-lg      40/2.5     1.10           700      Modal title (e.g. Matrimonial headline)
display-md      28/1.75    1.20           700      Canvas section title
title-lg        22/1.375   1.25           700      Publication masthead inline (canvas header)
title-md        18/1.125   1.30           600      Sidebar item labels (hover state)
title-sm        14/0.875   1.35           600      Tab labels, button labels
body            14/0.875   1.50           400      Form fields, paragraph body
caption         12/0.75    1.40           500      "Last auto-saved 14s ago"
label-caps      11/0.6875  1.20           600      UPPERCASE field labels (letter-spacing 0.08em)
mono            13/0.8125  1.45           400      File paths, numbers in diagnostics
```

All display sizes use **Fraunces**. All sans sizes use **Inter**.

---

## 5. Spacing scale (tokens)

```
--space-0:       0
--space-1:       4px
--space-2:       8px
--space-3:       12px
--space-4:       16px
--space-5:       20px
--space-6:       24px
--space-8:       32px
--space-10:      40px
--space-12:      48px
--space-16:      64px
--space-24:      96px
--space-32:      128px
```

Conventions:

- Form field vertical rhythm: `space-6` (24px) between field groups.
- Card interior padding: `space-5` (20px).
- Modal interior padding: `space-8` (32px).
- Sidebar horizontal padding: `space-6` (24px).
- Grid gap between spreads: `space-6` (24px).
- Between major page sections: `space-12` (48px).

---

## 6. Radii (locked per Pass 4A fix — no radius drift)

```
--radius-sm:     4px   /* small chips, pill inner elements */
--radius-md:     6px   /* inputs, buttons, small cards */
--radius-lg:     8px   /* spread thumbnail cards, photo drop, typography pairing cards */
--radius-xl:     12px  /* modals */
--radius-pill:   999px /* pill selectors, segmented controls */
```

Rule: **never invent a new radius**. If you need one, audit whether an existing token works.

---

## 7. Shadows

Editorial restraint: shadows exist but are subtle.

```
--shadow-none:   none
--shadow-sm:     0 1px 2px rgba(26,26,26,0.04)             /* hover lift on cards */
--shadow-md:     0 2px 8px rgba(26,26,26,0.06)             /* dropdown menus, tooltips */
--shadow-lg:     0 4px 24px rgba(26,26,26,0.08)            /* modals */
--shadow-window: 0 8px 40px rgba(26,26,26,0.12)            /* macOS window chrome */
```

---

## 8. Iconography

**Phosphor Icons (regular weight, 1.5px stroke) via `@phosphor-icons/react`.** Consistent with editorial typography's stroke contrast; not as geometric as Lucide but still clean. Free + SIL OFL.

Sizes:

- 16px for inline with body text.
- 18px for sidebar nav.
- 20px for form field icons.
- 24px for large CTAs.

All icons inherit `currentColor`. Never colored decorative icons.

---

## 9. Components

### Buttons

```
Primary (filled rust):           Export, "Save to queue", "Start your first issue"
  bg: --color-accent
  text: --color-text-inverse
  border: none
  radius: --radius-md
  padding: 10px 20px (small), 12px 24px (medium), 14px 32px (large)
  hover: bg --color-accent-hover
  pressed: bg --color-accent-pressed
  disabled: opacity 40%, cursor default

Secondary (outlined rust):       "Check my issue", "Continue" in wizard (until required fields fill)
  bg: transparent
  text: --color-accent
  border: 1.5px solid --color-accent
  radius: --radius-md
  hover: bg --color-accent-bg
  pressed: bg --color-accent-muted
  disabled: opacity 40%

Tertiary (ghost, dark):          "Cancel", "Back", "Save as draft"
  bg: transparent
  text: --color-text-primary
  border: none
  hover: bg rgba(26,26,26,0.04)

Destructive:                     "Delete this classified", "Remove image"
  bg: transparent
  text: --color-error
  border: 1.5px solid --color-error
  (only outlined; no filled destructive action)
```

### Form inputs

```
Text input:
  bg: --color-bg-surface
  text: --color-text-primary
  placeholder: --color-text-tertiary
  border: 1.5px solid --color-border-default
  radius: --radius-md
  padding: 10px 14px
  font: body
  focus: border --color-accent, focus ring 3px rgba(201,110,78,0.20)
  invalid: border --color-error, focus ring rgba(184,69,69,0.20)
  disabled: bg --color-bg-canvas, opacity 60%
```

### Segmented control / pill selector (locked per Pass 4B fix)

```
Container: flex of pill buttons; bg transparent, gap 4px
Each option:
  padding: 6px 14px
  radius: --radius-pill
  font: title-sm
  default: bg transparent, text --color-text-secondary
  selected: bg --color-accent, text --color-text-inverse
  hover (unselected): bg --color-accent-bg, text --color-text-primary
```

USED EVERYWHERE a mutually-exclusive set of options appears inline: Primary language, Marital status, Content language, Language defaults in wizard.

### Cards (spread thumbnails, typography pairing cards)

```
bg: --color-bg-surface
border: 1.5px solid --color-border-default
radius: --radius-lg
padding: 0 (spread thumb) or --space-4 (type pairing card)
selected: border --color-accent, subtle rust halo (box-shadow 0 0 0 3px rgba(201,110,78,0.15))
hover: border --color-border-strong
```

### Modal (sheet style)

```
scrim: --color-bg-overlay
sheet:
  bg: --color-bg-surface
  radius: --radius-xl
  max-width: 640px
  shadow: --shadow-lg
  padding: --space-8
header: small label-caps on top-left, display-lg title below, action dropdown top-right
footer: flex row, ghost buttons left, primary/secondary right
```

### Drop zone (upload)

```
bg: --color-bg-canvas
border: 2px dashed --color-accent
radius: --radius-lg
text: "Drop photo here" in body, --color-accent
padding: --space-10
hover: bg --color-accent-bg
dragging-over: border-width 3px, bg --color-accent-muted
```

### Sidebar nav item

```
padding: 10px 16px
font: title-sm
default: text --color-text-primary, icon --color-text-secondary
hover: bg rgba(26,26,26,0.04)
active:
  text --color-text-primary, icon --color-accent
  + 3px-wide left bar in --color-accent inset from the left edge
  (NOT a filled pill, NOT a colored background — just the left bar)
```

### Toast

```
bg: --color-bg-surface
shadow: --shadow-md
radius: --radius-md
padding: --space-4 --space-5
icon: leading (success = green checkmark, warning = amber, error = red)
position: bottom-right of app window, stack upward, auto-dismiss 5s
```

### Focus ring (a11y-critical)

Every focusable element shows a visible focus ring on `:focus-visible`:

```
outline: none
box-shadow: 0 0 0 3px rgba(201,110,78,0.35)
```

The 35% alpha makes it survive on any background. Applies to buttons, inputs, cards when selectable, nav items, toggles.

### Inline banner (non-modal notification)

Distinct from Toast. A banner appears INSIDE the canvas (e.g., crash recovery prompt, export-stale warning). Persistent until dismissed.

```
position: top of main canvas, full-width, below canvas header
bg: --color-accent-bg (cream-tinted, #FCF1EC for default; semantic bg for severity)
border-left: 1.5px solid --color-accent (rust for default; semantic color for severity)
padding: --space-4 --space-6
radius: --radius-md (right side only; left edge has the border)
contents: leading icon + text block (title + subline) + inline action buttons (right) + X-close (far right, ghost)
```

**Severity variants:**

- Default (informational / warm): cream-tinted bg + rust left-border.
- Warning: `--color-warning-bg` + `--color-warning` left-border.
- Error: `--color-error-bg` + `--color-error` left-border.
- Success: `--color-success-bg` + `--color-success` left-border.

The colored LEFT border is acceptable here because it's a severity marker, not decoration. See §14: this is the exception that proves the rule.

### Severity-bordered cards (pre-export check only)

For the pre-export check screen, affected spread thumbnails gain a colored 3px border AROUND (not left-only) to indicate severity:

```
error spread: border 3px solid --color-error
warning spread: border 3px solid --color-warning
```

Only this screen uses the colored-border-around-card pattern. Elsewhere, severity communicates via icon + text.

### Sectioned card with per-card save

Used for settings screens with multiple concerns (Publication basics / Print defaults / Fonts / Backup / Diagnostics).

```
card bg: --color-bg-surface
card border: 1.5px solid --color-border-default
card radius: --radius-lg (8px)
card padding: --space-6 (24px)
card header: display-md title + body-size subline in --color-text-secondary
card fields: normal form rhythm
"Save changes" rust text link top-right of card, visible ONLY when card is dirty
```

Dirty state is per-card, not global. Changing one card's fields reveals its Save link; other cards stay clean. Saves trigger a toast on success.

### Collapsible section group (queues and tables)

Used for classifieds queue, ads tab grouped views, potentially history panel.

```
section header:
  display-serif title (18px Fraunces bold) + count in parens "(N)"
  chevron icon on right (down = expanded, right = collapsed)
  optional per-section action (e.g., "Sort by: First-come ▾") on far right
  click header to toggle expand/collapse
section body (when expanded):
  list of rows, 1px hairline dividers between
  row hover: subtle --color-bg-canvas background
  row selected: --color-accent-bg background + --color-accent left-border-dot
```

Groups remember their expanded/collapsed state in local UI state (Zustand store) until session ends. Not persisted in snapshots.

### List row (Articles, Classifieds, any data list)

Editorial, not SaaS-card-grid.

```
row height: 56-72px depending on content density
padding: --space-4 --space-6 (vertical horizontal)
divider between rows: 1px solid --color-border-default
contents (left to right):
  drag handle icon (Phosphor dots-six-vertical, muted, 16px — visible only on row hover OR always for drag targets)
  optional thumbnail (48-60px, locked aspect per list type)
  main text block (headline semibold + byline + preview, truncate)
  right metadata block (pills, counts, status)
  three-dot menu icon on row hover, opens Radix DropdownMenu
```

### Timeline row (history panel)

Variant of List Row with time-series affordances.

```
row: flex, 8px dot marker on left (--color-accent, 8px circle), timestamp + middot + description text
selected row: --color-accent-bg background + 3px rust left-border
row hover: reveal "Restore" ghost link on the right
sections: grouped by date with small-caps "TODAY / YESTERDAY / LAST WEEK" headers
```

### ScrubTimeline (per-article version history rail) — added 2026-04-22

Approved mockup: `~/.gstack/projects/PrintCMS/designs/scrub-timeline-detail-20260422/variant-A.png`.

The 200px left rail of EditArticleModal in 3-pane mode. Acts as both a chronological list and a scrub control (arrow keys step versions, PgUp/PgDn jumps 10).

```
container: 200px wide, full modal-content height, --color-bg-surface, border-right --color-border-default
header: 11px label-caps "VERSION HISTORY" + Inter 11px caption count "12 versions" right-aligned, padding --space-3
search: Inter 13px input "Find a version..." with ⌘F kbd hint at right edge, --space-3 horizontal padding
date-divider: small-caps Inter 11px ("TODAY", "YESTERDAY", "LAST WEEK", "OLDER"), 1px hairline below in --color-border-default
row: 56px tall, --space-3 horizontal padding, two-column flex
  left col: timestamp (Inter 13px charcoal) + caption-style version label (Inter 13px charcoal-secondary)
  right col: optional 8px star dot (--color-accent) for starred versions; optional Mukta Devanagari char for Hindi-content edits
row hover: 1px --color-accent horizontal indicator + floating callout card to the right (Inter 11px on white, --shadow-md)
  callout content: "v[N] · [±W words] · [optional ★ name]"
row selected: --color-bg-canvas background + 2px --color-accent left-border
keyboard hints: 11px tertiary at bottom of rail "↑ ↓ to step  ·  PgUp PgDn for ×10  ·  ⌘F to search"
empty state: "No version history yet. Save the article to start a timeline." in --color-text-tertiary, italic Fraunces 14px
react-window virtualization: required if version count > 50
```

### DiffViewer overlay (modal-on-modal version comparison) — added 2026-04-22

Approved mockup: `~/.gstack/projects/PrintCMS/designs/diff-viewer-overlay-20260422/variant-C.png`.

Full-bleed Radix `Dialog.Root` overlay above EditArticleModal (per eng review #2 ER2-2). Map+Detail composition: 200px diff-heatmap rail on left, focused paragraph BEFORE/AFTER on the right.

```
backdrop: --color-bg-overlay (rgba(26,26,26,0.50))
container: full viewport, white surface, --shadow-window
header: 64px tall, white, --space-8 horizontal padding
  title: Fraunces 22px bold "Compare versions"
  version pills: two pill selectors "v[N] · [time]" → "v[N] · current" (segmented-control style)
  close: X icon top-right with kbd hint "ESC" below in 11px tertiary
sub-header: 40px strip, --color-bg-canvas (cream wash)
  left: change summary "N paragraphs changed · M added · K removed · ±W words" in Inter 13px charcoal-secondary
  right: nav arrows ↑/↓ + kbd hint "J/K to step" in Inter 11px tertiary
diff area: flex row, full remaining height
  LEFT RAIL (200px diff-map):
    label-caps "DIFF MAP" 11px at top
    paragraph rows: 16px tall, full-width tinted bars
      unchanged: --color-bg-canvas tint
      changed: --color-accent-muted (#E8C4B3)
      added: --color-accent (#C96E4E) + tiny "+" marker
      removed: --color-error (#B84545) + tiny "−" marker
    paragraph numbers: label-caps 10px on left
    row labels: Inter 11px caption clipped first 24 chars of paragraph plain-text
    focused row: 2px --color-accent outline (matches the paragraph in the main pane)
    react-window virtualization: required if paragraph count > 75
  MAIN PANE (~1080px or remaining width):
    title: label-caps "PARAGRAPH N · [CHANGED|ADDED|REMOVED]"
    side-by-side BEFORE/AFTER: two equal sub-columns, --space-10 gutter between
    sub-column header: label-caps "BEFORE v[N]" / "AFTER v[N]"
    paragraph body: Fraunces 16px serif (larger than typical diff because focused on one block)
    intra-block diff highlights:
      removed words (BEFORE col): single-line strikethrough in --color-error
      added words (AFTER col): underline in --color-accent
    bottom caption: "Use ↑ ↓ on map to step through changes · J/K stays focused on changes only"
footer: bottom-right, --space-8 padding
  primary: filled rust "Restore v[N]" (dynamically reflects whichever version is on the LEFT)
  secondary: outlined "Cancel"
focus restoration: closes return focus to the "Compare" trigger button in EditArticleModal
ESC handling: ESC closes diff only; EditArticleModal stays open. Tiptap floating UI must be pre-closed before opening DiffViewer (per eng review #2 ER2-7).
prefers-reduced-motion: overlay fade-in disabled; instant appearance
empty state: identical bodies show "Identical." in display-md italic charcoal-secondary, no diff highlights, no map markers
fallback: very large blocks (>75KB single paragraph) fall back to "block too large for character-level diff" notice; block-level diff still shown
```

### Empty-state card (any tab or screen)

Unified pattern so every empty state feels considered, not scaffolded.

```
card: 480px max-width, centered in content area (not full canvas)
contents:
  small-caps label in --color-accent (e.g., "START", "NEW HERE", "NO ITEMS YET")
  display-md/serif headline (welcoming, specific — "Let's put something on page 1.", not "No articles yet")
  body subline explaining the action (1-2 lines)
  primary action button (filled rust) + optional secondary action (ghost)
  optional tertiary link below ("Or try X (soon)") in italic muted gray if it's a future feature
```

Background canvas shows the empty surface (wireframe spread outlines at 25% opacity for Issue Board, skeleton list rows for Articles, etc.). The empty state card hovers on top, not replaces the surface.

### Split-pane layout (editor screens with live preview)

Used for Cover editor. Potentially Pretext-debug or future screens.

```
grid-template-columns: 40% 60% (or 50/50 for equal-weight editors)
left pane: form, scrollable, padding --space-8
right pane: sticky preview, padding --space-6, overflow hidden
separator: 1px border --color-border-default or none (rely on padding + bg)
preview content: centered, scaled-to-fit, trim + bleed guides visible where relevant
preview chrome: "Variant: X ▾" dropdown top-left, toggles/settings top-right
```

### Aspect-ratio-preserving thumbnail (ads tab, image library)

Critical: ad thumbnails must visually signal "this is a full-page ad" vs "this is a strip ad" by their SHAPE, not via labels.

```
container: CSS `aspect-ratio` property set to the print aspect
  Full page A4: aspect-ratio: 210/297 (portrait)
  DPS: aspect-ratio: 420/297 (wide landscape)
  Half page horizontal: aspect-ratio: 2/1
  Strip: aspect-ratio: 6/1
  Cover strip: aspect-ratio: 7/1 (or matches brief)
image: object-fit: cover within container
empty slot: dashed rust border + "No ad placed" text + "Place ad" ghost button centered
metadata below: filename · advertiser · "300 DPI ✓" · "COLOR" / "BW" in caption
```

### Status chip (filled / open / draft / archived)

Small pill inline with section headers or row titles.

```
padding: 2px 8px
radius: --radius-pill
font: label-caps (letter-spacing 0.08em, 11px)
variants:
  "Filled" / "Placed" / "Done": --color-accent-bg bg + --color-accent text
  "Open" / "Missing" / "Pending": --color-border-default bg + --color-text-secondary text
  "Draft": --color-warning-bg bg + --color-warning text
  "Deferred": cream bg + muted text
```

---

## 10. Motion

**Restrained.** No bouncy interactions, no page-flip animations, no parallax. Professional tool for professional work.

```
--duration-fast:     120ms   /* hover, focus, small state changes */
--duration-base:     200ms   /* modals, tooltips, toast */
--duration-slow:     320ms   /* page transitions, drawer slides */

--ease-standard:     cubic-bezier(0.2, 0.0, 0.0, 1.0)   /* most interactions */
--ease-decelerate:   cubic-bezier(0.0, 0.0, 0.2, 1.0)   /* elements entering */
--ease-accelerate:   cubic-bezier(0.4, 0.0, 1.0, 1.0)   /* elements leaving */
```

Drag operations (dnd-kit) use 120ms snap on release. No overshoot. Reordering spreads uses 200ms slide.

**Reduce-motion:** honor `@media (prefers-reduced-motion: reduce)` — all durations clamp to 0ms except focus ring fades (80ms for crispness).

---

## 11. Layout grids

### App window

- Minimum supported: 1280×800 (13" MacBook Air).
- Design target: 1440×900.
- Sidebar: 260px fixed (not collapsible for MVP — Pass 7 decision 7E).
- Main canvas: fluid remainder, min 900px.
- Canvas header: 64px tall, sticky on scroll.

### Issue Board spread grid

- Facing-page spreads shown as paired thumbnails.
- Grid auto-fits: minimum 280px per spread card, max 4 per row on 1440×900.
- 24px gap between spreads.
- Selected spread: rust halo as defined above.

### Responsive note

MVP targets 13"+ macOS displays. Tablet and mobile layouts are explicitly NOT in scope. If the window shrinks below 1280px wide, the app shows a fixed "Please resize your window to at least 1280×800" overlay. Not a layout target.

---

## 12. Accessibility floor

- **Contrast:** WCAG AA — body text `#1A1A1A` on cream `#F5EFE7` = 13.9:1 (AAA). Labels `#5C5853` on cream = 6.3:1 (AA). Rust `#C96E4E` on cream = 3.6:1 (AA for UI components ≥24px; for small text, use `#B85942` instead, which is 4.5:1).
- **Keyboard nav:** every action in the app keyboard-accessible. Standard shortcuts: Cmd-S save, Cmd-Z/Cmd-Shift-Z undo/redo, Cmd-E export, Cmd-I import article, Cmd-G jump to spread by number, Esc close modal, Tab through form fields.
- **Focus rings:** present, visible, rust-accent (see component section).
- **Touch targets:** not applicable for MVP (macOS trackpad/mouse only). Cursor targets: ≥32×32px hit area even when visible icon is smaller.
- **Screen reader:** all Radix primitives inherit proper ARIA. Custom components use `aria-label`/`aria-describedby` as needed.
- **No color-only signaling:** error messages always have text + icon, not just red borders. Drag-drop targets have text cue + dashed border, not just color change.

---

## 13. Voice and copy

- **Confident and quiet.** Avoid exclamation marks except in genuine celebration ("You're ready.").
- **Plain English.** Avoid jargon. The operator is non-technical.
- **Label specificity.** "Save to queue" not "Save"; "Export to PowerPoint" not "Export".
- **Error messages explain + suggest.** "We couldn't read that .docx. Try re-exporting from Word." Not "Error parsing file."
- **Reassurance in progress states.** "Setting up your fonts..." not "Loading..."
- **Hindi UI copy:** same voice, Devanagari in Mukta. No transliteration-only labels.

---

## 14. Don't list (AI-slop blacklist, specific to this product)

- No purple, violet, or indigo anywhere. Rust is THE accent.
- No 3-column feature grids (if you find yourself writing three cards in a row with an icon, stop).
- No centered everything. Left-align per editorial convention.
- No decorative floating blobs or wavy SVG dividers.
- No emoji in interface copy (emoji in user-generated content is fine).
- No colored left-borders on cards.
- No carousel with no narrative purpose.
- No cookie-cutter section rhythm.
- No SaaS-admin color palette (flat blue or gray chrome with blue accent).
- No Slack-style message bubbles anywhere.
- No gamified progress (streaks, badges, checkmarks with confetti).

If a new pattern you're designing feels like it would fit on a generic SaaS starter template, reject it and redesign.

---

## 15. How to extend this system

1. New component: check if existing primitives cover it. If yes, compose them.
2. New color: do not add to the accent slot. Semantic colors (success/warning/error/info) are already defined.
3. New font: do not add. Two typefaces (Fraunces + Inter) are the system.
4. New radius/spacing token: audit existing scale first. Only add if there's a concrete gap.
5. Before any new screen ships, generate a mockup via `/design-shotgun` or `/plan-design-review` for consistency.
6. If something "feels off" in the design, trace to a broken principle above. Taste is debuggable.
