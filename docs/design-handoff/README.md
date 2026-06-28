# Handoff: rack.bar — barbell loading calculator

## Overview
**rack.bar** is a mobile (phone-width) tool that answers two questions for a lifter standing at a barbell:

1. **"I want to lift X — what plates do I put on?"** (*Enter weight* mode) — type a target total, the app computes the plates to load **per side**, and tells you whether that target is hit **exactly**, or the nearest **under / round-up** option.
2. **"I've loaded these plates — what's the total?"** (*Add plates* mode) — tap plates onto the bar and read the running total.

It supports kg/lb, three bar weights, optional competition collars, and two plate sets (Eleiko colour-coded competition plates in kg, plain-iron training plates in lb). It can render a full-screen "rack card" and copy/share a plain-text loading summary. Recent targets persist locally.

---

## About the design files
The files in this bundle are **design references created in HTML** — an interactive prototype showing the intended look and behaviour. **They are not production code to copy directly.** The prototype is authored in a bespoke single-file component format (you'll see `<x-dc>`, `sc-for`, `renderVals()` etc. — that's prototype plumbing, ignore it).

Your task is to **recreate this design in the target codebase's environment** (React, React Native, SwiftUI, Vue, vanilla — whatever the project uses), applying its established patterns and component libraries. If no environment exists yet, pick the most appropriate stack for a small, offline-capable mobile web/native app.

**Two things in this bundle DO transfer directly and should be reused as-is:**
- **`engine.js`** — the plate-loading math, lifted verbatim as a pure, framework-free ES module. Use it unchanged. `engine.test.js` documents its contract.
- **The design tokens** (below) — colours, type, radii. They already map 1:1 to CSS custom properties.

## Fidelity
**High-fidelity (hifi).** Final colours, typography, spacing, radii, and interactions are all specified. Recreate the UI pixel-accurately using your codebase's libraries; exact hex/px values are given below and in `Design system.dc.html`.

---

## Architecture guidance (read before you start)

The prototype is a single "God component" with one big view-model builder. **Do not reproduce that structure.** Recommended decomposition:

```
engine.js                  ← USE AS-IS (pure math + plate data)
state/loadingStore         ← target, mode, unit, side[], barKg, collarKg, plateSet, recents
components/
  ModeToggle               ← "Enter weight" / "Add plates" segmented control
  BarVisualizer            ← the rendered bar + discs (inline strip)
  FullscreenBar            ← landscape blow-up of BarVisualizer (uses fsLayout)
  TargetReadout            ← big total number + secondary unit + status pill
  TargetEntry              ← −/value/+ row, opens Keypad
  Keypad                   ← bottom-sheet numeric pad
  PaletteGrid              ← tappable plate buttons (Add plates mode)
  LoadedChips              ← horizontally-scrolling "on the bar" chips
  RecentChips              ← horizontally-scrolling recent-target chips
  ConfigSheet              ← Setup bottom sheet: bar / collars / plate set
  ShareCard                ← modal loading card + copy-to-clipboard
  HelpPopover              ← "how it works" popover
```

**Remove the `f`-field indirection.** The prototype threads a field key everywhere (`mk('a')`, `this.state.a`, `upd('a', …)`) as if there were multiple panels — there is only ever one (`'a'`). It's vestigial. Flatten it; don't faithfully reproduce it.

**Keep the engine pure.** All of `engine.js` is side-effect-free and UI-free. Derived display values (formatted strings, status pills, "round up →" copy) belong in your view layer, not the engine — the prototype's `vm()` shows what those derivations are.

---

## Screens / views

The app is a single phone screen (design frame **384px** wide content area; the prototype draws it inside a 788px-tall device mock). Modes swap the lower half; sheets/modals overlay.

### 1. Header
- **Layout:** flex row, space-between. Left: wordmark `rack.bar` (the `.` is accent yellow) + a circular **help** icon button. Right: **Setup** pill button (`{barKg} kg bar · Comp/Training` + chevron).
- **Help popover:** opens below-left, 248px wide, `#16191d` card, 1px `#262b31` border, 13px radius, numbered 2-step explainer. Animates in with `popIn` (.16s).

### 2. Mode toggle (segmented)
- Full-width pill track (`#15171a` fill, 1px `#20242a` border, 4px padding). Two segments: **Enter weight** | **Add plates**. Active segment = solid accent `#f5c518` fill, ink `#0d0e10`, weight 700; inactive = transparent, `#8b929a`, weight 600.

### 3. Bar visualizer (always visible, 204px tall block)
- Centered horizontal barbell: left collar stub + sleeve (`#4e545b` / `#8b9199` greys), then the loaded discs heaviest→lightest from the inside out, then end collar + cap.
- **Discs** are colour-coded (see palette), height ∝ plate diameter, width ∝ plate width, scaled to fit via `fitScale()`. Each disc shows its weight as a **vertical engraved numeral** (rotated −90°, JetBrains Mono 800, ink chosen for contrast).
- **Empty state:** dashed `#2f343a` outline box with a `+`.
- In *Add plates* mode discs are tappable (tap removes that plate). Top-right: a **fullscreen** icon button.
- Label above: `per side` / `Tap a plate to load` / `Enter a weight` depending on state.

### 4a. *Enter weight* mode (below the bar)
- **Total readout:** `Total` label + kg/lb unit segmented toggle. Big number (Hanken 800, **54px**, −.025em, `tnum`) = the achieved on-bar total, with small unit suffix (`#8b929a`). Secondary line = the same in the other unit.
- **Status pill** beside secondary line: `✓ Exact` (green dot) / `N over` (solid accent pill) / `N short` (outline pill). When the sleeve is full and still short → `● Bar at capacity`.
- **Round-up affordance:** when an exact hit isn't possible, a pill button `Round up → NNN kg` (toggles to `Use NNN kg`).
- **Target block:** `Target` label, then a row of `−` (44px circle) / tappable value (Hanken 700, 30px, opens keypad) / `+` (44px circle). Steppers move by 1 kg or 5 lb, snapping to grid.
- **Recent chips:** `Recent` label + horizontally-scrolling outline pills of recent targets, with left/right gradient nudge arrows when overflowing.

### 4b. *Add plates* mode (below the bar)
- **On the bar:** `On the bar` label + **Clear** pill (hover → danger red). Horizontally-scrolling **loaded chips** (`25×2`, `20`, …) coloured per plate, with overflow nudge arrows. Empty → `Tap to add a pair`.
- **Add palette:** `Add` label (+ `● Sleeve full` warning when applicable). Grid of plate buttons — **5 columns** for Eleiko, **3 columns** for iron — each a colour-coded 44px-tall button. Disabled (30% opacity, `not-allowed`) when the plate no longer fits the sleeve.

### 5. Keypad (bottom sheet)
- Slides up (`sheetIn` .2s) from bottom. `#101216` fill, top 1px `#20242a` border, 24px top radius. Big live entry number + secondary unit + optional delta/`✓ exact` line. 3-column grid: `1–9`, `.`, `0`, `⌫`. Footer: `Clear` (ghost) + `Done` (accent).

### 6. Setup sheet (bottom sheet)
- Dimmed scrim (`rgba(5,6,7,.55)`, `fadeIn`) + sheet (`#16191d`, `sheetIn` cubic-bezier). `Setup` title + accent `Done` button. Three sections:
  - **Bar** — 3 selector tiles (20/15/5 kg, with lb subtitle).
  - **Collars** — 2 tiles (None / Standard 2.5 kg).
  - **Plates** — 2 rows (Competition · Eleiko colour-coded · kg / Training · plain iron · lb), each with colour swatches + check.
- Selector tile active state: `#272b30` fill, 1px `#3a4047` border; inactive transparent, 1px `#20242a`.

### 7. Share card (centered modal)
- Scrim `rgba(5,6,7,.72)`. Card `#16191d`, 1px `#23272c`, **26px** radius, max 300px, `cardIn` .24s. Wordmark + `Loading card` label, big total, secondary unit, wrapped colour chips (`N× weight`) or `Bare bar — no plates`, config caption (`per side`), then **Copy summary** (accent, toggles to `Copied ✓` for 1.6s) + **Close**.

### 8. Fullscreen bar (immersive)
- Radial dark background. Wordmark + huge total (58px) + config caption. The bar rendered **rotated 90° (landscape)**, much larger, via `fsLayout()`. Tap anywhere or the close button to exit.

---

## Interactions & behaviour
- **Mode switch** preserves context: switching to *Enter weight* seeds the target from whatever is on the bar; switching keeps the loaded side.
- **Unit toggle** re-renders all numbers from the canonical kg `srcKg`; entry draft reformats.
- **Steppers** (`+`/`−`) snap to a 1 kg / 5 lb grid relative to the current value (or the bar weight if blank).
- **Keypad** edits a `draft` string; first keypress after opening replaces (pristine flag). Closing the keypad pushes the value to recents.
- **Recents:** deduped, most-recent-first, **capped at 6**. Pushed on keypad-close, chip apply, and opening the share card.
- **Sleeve cap:** both auto-decode and manual add refuse plates that would exceed `SLEEVE_MM` (415 mm) of width per side.
- **Round-up toggle** swaps the visualised side between `primary` and `over` candidates from `decode()`.
- **Copy summary** writes a 3-line plain-text summary to the clipboard.

### Animations (keyframes used)
- `numRoll` (.26s ease-out) — display numbers roll up on change.
- `sheetIn` (.2–.26s) — bottom sheets rise.
- `fadeIn` (.16s) — scrims.
- `popIn` (.16s) — help popover.
- `cardIn` (.24s) — share card.
- Buttons: `transform .09s` press-scale to .955 on `:active`; .16s colour transitions.

## State management
Canonical state (one store / reducer):

| field | meaning |
|---|---|
| `mode` | `'decode'` (Enter weight) / `'encode'` (Add plates) |
| `unit` | `'kg'` / `'lb'` (display only; kg is canonical) |
| `draft` | current text entry string |
| `srcKg` | canonical target in kg (parsed from draft) |
| `pristine` | true until first keypress after focus/open |
| `side` | array of plate objects on one side (descending kg) |
| `decoded` | last `decode()` result `{ primary, over? }` |
| `showingOver` | round-up candidate currently shown |
| `barKg`, `collarKg` | setup |
| `plateSet` | `'comp'` (Eleiko) / `'training'` (iron) — switching also forces unit kg/lb |
| `recents` | recent target kg values (≤6) |
| `keypad`, `cfgOpen`, `cardOpen`, `fullscreen`, `helpOpen` | overlay visibility |

**Persistence:** `localStorage["rackbar.recents"]` — JSON array of kg numbers, deduped, max 6. Read on init, written on every change. (This is the only persisted key.)

---

## Design tokens

Map 1:1 to CSS custom properties (`--rb-*`). Full visual reference: **`Design system.dc.html`** (open in a browser).

**Brand**
- accent `#f5c518` · accent-ink `#0d0e10`

**Surfaces** (deepest → most raised)
- surface `#0d0e10` (app bg) · sunken `#101216` (keypad) · raised `#15171a` (inset controls) · overlay `#16191d` (sheets/modals) · active `#1b1f24` (selected row) · selected `#272b30` (active segment/pill)

**Borders**
- border `#20242a` · strong `#23272c` · muted `#2a2f35` · active `#3a4047` · divider `#1b1e22`

**Text** (on dark)
- primary `#f4f4f5` · secondary `#aab0b7` · muted `#9aa1a9` · dim `#8b929a` · disabled `#41464c`

**Semantic**
- danger `#e0263a` · success `#4caf6a`

**Shell (the light "device wallpaper" around the app)**
- page bg `#e7e5df` · page ink `#15181c` · page faint `#9b958b`

**Typography**
- Sans: **Hanken Grotesk** (400/500/600/700/800) — UI text, numbers
- Mono: **JetBrains Mono** (400–800) — labels, plate numerals, unit toggles
- Key sizes: display number 54px/800/−.025em/`tnum`; title 17px/800; section label 11px/600 mono, .14em, uppercase; body 12–14px/500–600.

**Radii**
- pill `999px` · card `14px` · sheet-control `13px` · tile `11px`

**Shadows**
- disc: `inset 0 0 0 1px rgba(255,255,255,.1), 0 2px 6px rgba(0,0,0,.25)`
- sheet: `0 -18px 44px -18px rgba(0,0,0,.7)` · modal: `0 30px 60px -20px rgba(0,0,0,.7)`

**Plate palette (domain data, NOT UI tokens)**
- red `#e0263a` · blue `#2563c9` · yellow `#f5c518` · green `#25a45a` · white `#eef0f2` · iron `#34383e`
- Disc fill is a soft top-lit gradient: `linear-gradient(180deg, color-mix(in srgb, <hex> 95%, #fff), <hex>)`. Ink is dark on white/yellow, white otherwise.

---

## Assets
No external images, icons, or fonts beyond the two Google Fonts (Hanken Grotesk, JetBrains Mono). All icons are inline SVG (help, setup sliders, fullscreen, chevrons, share, close) — copy them from `rack.bar.dc.html` or swap for your icon library's equivalents. No brand assets requiring licensing.

## Files in this bundle
- **`engine.js`** — pure plate-loading engine + plate data. **Use as-is.**
- **`engine.test.js`** — runnable contract examples for the engine.
- **`rack.bar.dc.html`** — the full interactive prototype (open in a browser to click through every state).
- **`Design system.dc.html`** — token/type/component/palette reference board.
- **`screenshots/`** — visual reference for the three primary screens: `01-enter-weight.png`, `02-add-plates.png`, `03-fullscreen.png`. The overlay states (Setup sheet, Keypad, Share card, Help popover) are spec'd in full under **Screens / views** above; open `rack.bar.dc.html` in a browser to see them live.
- *(`support.js` — the prototype runtime; needed only to open the `.dc.html` files locally. Not part of the implementation.)*
