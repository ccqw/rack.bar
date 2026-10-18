---
name: rack.bar
description: A sharp, physical, gym-native barbell-loading instrument -- not a generic calculator.
colors:
  accent: "#f5c518"
  accent-ink: "#0d0e10"
  surface: "#0d0e10"
  sunken: "#101216"
  raised: "#15171a"
  overlay: "#16191d"
  active: "#1b1f24"
  selected: "#272b30"
  border: "#20242a"
  border-strong: "#23272c"
  border-muted: "#2a2f35"
  border-active: "#3a4047"
  divider: "#1b1e22"
  text: "#f4f4f5"
  text-secondary: "#aab0b7"
  text-muted: "#9aa1a9"
  text-dim: "#8b929a"
  text-disabled: "#41464c"
  danger: "#e0263a"
  success: "#4caf6a"
  page-bg: "#e7e5df"
  page-ink: "#15181c"
  page-faint: "#9b958b"
  plate-red: "#e0263a"
  plate-blue: "#2563c9"
  plate-yellow: "#f5c518"
  plate-green: "#25a45a"
  plate-white: "#eef0f2"
  plate-iron: "#34383e"
  sleeve-shaft: "#4e545b"
  sleeve-collar: "#8b9199"
  sleeve-end: "#5c636b" # the Collar's 1px edge (RBAR-96; was the end collar)
  sleeve-empty: "#2f343a"
typography:
  display:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "54px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    fontFeature: "tnum"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.14em"
rounded:
  pill: "999px"
  card: "14px"
  sheet-control: "13px"
  tile: "11px"
  sheet: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
  pill-setup:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  segment-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
  segment-inactive:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.pill}"
  chip-recent:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "7px 13px"
  tile-selector-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
    rounded: "{rounded.tile}"
  tile-selector:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.tile}"
---

# Design System: rack.bar

## Overview

**Creative North Star: "The Platform Instrument"**

rack.bar looks like a precision instrument that lives on the competition
platform. The venue supplies the world: black rubber underfoot, chrome sleeve
under arena light, and the only real color in the room is the plates
themselves. The instrument supplies the character: engineered, glanceable,
chalk-proof -- monospaced numerals that never jitter, one yellow that means
"act here," and controls big enough to hit between sets with taped thumbs.

The voice is sharp, physical, gym-native. The anti-reference is the generic
calculator app: no gradient-happy dashboards, no floating cards, no colors
that mean nothing. Every hue on screen is either the near-monochrome chrome of
the instrument or the domain-true color of a plate a lifter would name out
loud ("throw a red on").

**Key Characteristics:**
- Near-black tonal surfaces; saturated color is reserved for plates and the
  single accent.
- Monospaced, tabular numerals everywhere a weight is displayed.
- Pill geometry for controls; discs and sheets are the only large shapes.
- Flat at rest; shadow means a physically real thing (a disc's rim, an
  overlay hovering above the app).
- One accent (Plate Yellow) marking the active segment and the primary action.

## Colors

A near-monochrome dark instrument panel where the plates carry all the
vibrancy; every value below is normative in the frontmatter and lives in
`tokens.css` as `--rack-*` custom properties.

### Primary
- **Plate Yellow** (#f5c518): the single accent. It is literally the 15 kg
  bumper's hex doing double duty: active segment fill, primary action
  (Done / Copy summary), the wordmark's dot, the "N over" status pill.
  **Platform Black ink** (#0d0e10) sits on it -- never white.

### Neutral
- **Platform Black** (#0d0e10): the app surface; also the ink placed on
  accent fills.
- **Surface ladder, deepest to most raised:** sunken #101216 (keypad sheet),
  raised #15171a (inset controls like the mode track), overlay #16191d
  (sheets and modals), active #1b1f24 (a selected row), selected #272b30
  (active tile fill).
- **Borders, faint to prominent:** divider #1b1e22 (hairlines between stacked
  rows), border #20242a, border-strong #23272c, border-muted #2a2f35,
  border-active #3a4047 (the ring on a selected control).
- **Text on dark, brightest to faintest:** text #f4f4f5, secondary #aab0b7,
  muted #9aa1a9, dim #8b929a (section labels, unit suffixes), disabled
  #41464c.
- **Shell wallpaper** (reserved): page-bg #e7e5df, page-ink #15181c,
  page-faint #9b958b -- the light "device wallpaper" for a future framed
  desktop layout; unused by the dark app surface today.

### Semantic
- **Red-Plate Danger** (#e0263a): Clear actions and over-capacity warnings.
  Deliberately shares the 25 kg plate's hex -- red already means "stop and
  look" in this world.
- **Exact-Hit Green** (#4caf6a): the "Exact" status dot only.

### Plate Palette (domain data, not UI tokens)
The IWF/Eleiko scheme; lifters name plates by these colors, so they are
semantic vocabulary, never decoration and never restyled: red #e0263a
(25 / 2.5), blue #2563c9 (20 / 2.0), yellow #f5c518 (15 / 1.5), green
#25a45a (10 / 1.0), white #eef0f2 (5 / 0.5), iron #34383e (the lb training
set -- one dark finish, distinguished by stamped label, needs light ink).
Sleeve chrome greys render the bar itself: shaft #4e545b (the shaft and the
bare sleeve end), collar #8b9199 (the inner collar and the Collar's fill), end
#5c636b (the Collar's 1px edge), empty-state #2f343a. The Collar's latch
borrows plate red.

### Named Rules
**The Plates Own the Color Rule.** UI chrome stays near-monochrome; saturated
color belongs to the plates and to the one accent that borrows a plate's hex.
Never introduce a new saturated color for interface purposes.

**The Domain Color Rule.** Plate hexes are physical facts (CONTEXT.md). Color
is never the sole channel: a numeral or shape always disambiguates alongside
it.

## Typography

**Display Font:** Hanken Grotesk (variable 400-800, self-hosted; system-ui
fallback)
**Label/Mono Font:** JetBrains Mono (variable 400-800, self-hosted;
ui-monospace fallback)

**Character:** A grotesk with real weight range for the human words and the
big readouts; a mono for everything machine-flavored -- section labels, plate
numerals, unit toggles. The pairing reads instrument-panel, not editorial.

### Hierarchy
- **Display** (800, 54px, -0.025em, `tnum`): the achieved Total readout. The
  fullscreen rack card blows the same role up to 58px.
- **Headline** (700, 30px, `tnum`): the tappable Target value.
- **Title** (800, 17px): sheet titles (Setup) and the wordmark.
- **Body** (500-600, 12-14px): running copy, control labels, captions.
- **Label** (mono, 600, 11px, 0.14em, uppercase): section labels (Target,
  Recent, On the bar), unit toggles, plate numerals.

### Named Rules
**The Tabular Digits Rule.** Every weight readout uses tabular/monospaced
numerals (`tnum` or the mono face) so digits never jitter as values change.

**The Engraved Numeral Rule.** A disc's weight is stamped on it: rotated
-90 degrees, JetBrains Mono 800, ink chosen for contrast against the plate
color (dark on white/yellow, white otherwise).

## Layout

A single phone column, 384px design-frame content width, safe-area-inset
padding, no horizontal page scroll ever. The screen is one fixed composition:
header (wordmark + Setup pill), the always-visible bar visualizer
(204px block), then the mode-dependent lower half that the segmented toggle
swaps (Enter weight: readout + target + recents; Add plates: loaded chips +
palette grid). Overflow happens only inside horizontally-scrolling chip rows,
which signal it with gradient nudge arrows at the clipped edge.

Sheets and modals overlay rather than navigate: bottom sheets (keypad, Setup)
slide up full-width with 24px top corners; the share card is a centered modal
capped at 300px; the fullscreen rack card rotates the bar 90 degrees into
landscape. Spacing rhythm is compact and even -- 12-18px gaps and paddings,
4px inset padding inside the mode track -- tuned for one-thumb reach on a
phone, with 44px minimum touch targets throughout.

## Elevation & Depth

Flat at rest. Resting UI expresses depth purely tonally, through the six-step
surface ladder (surface -> sunken -> raised -> overlay -> active -> selected)
and the border tiers -- no shadows on resting controls, cards, or rows.
Shadows are reserved for things that are physically real: a plate disc's rim
catching light, and overlays that literally sit above the app.

### Shadow Vocabulary
- **disc** (`inset 0 0 0 1px rgba(255,255,255,.1), 0 2px 6px rgba(0,0,0,.25)`):
  rims and lifts a plate-colored disc, chip, or palette key.
- **sheet** (`0 -18px 44px -18px rgba(0,0,0,.7)`): lifts a rising bottom
  sheet off the surface.
- **modal** (`0 30px 60px -20px rgba(0,0,0,.7)`): lifts the centered share
  card.

### Named Rules
**The Physical Lift Rule.** Shadow means physicality, never decoration: a
disc has a rim because a plate does; a sheet casts a shadow because it hovers
above the app. Nothing else gets one.

## Shapes

Pill geometry is the control language: buttons, segments, chips, status
pills, and the Setup trigger are all fully rounded (999px), with 44px
circular icon buttons and 52px circular steppers (44px minimum). Rectangular forms step down a tight
radius scale by role: sheet top corners 24px, cards 14px (share card 26px,
its one spec'd exception), sheet controls 13px, selector tiles 11px.

The signature silhouette is the disc: plate-colored, height and width
proportional to the real plate's diameter and width (ADR-0004). A
plate-colored surface is never a flat fill -- it wears the shared top-lit
gradient recipe (`DISC_FILL`, elements/discfill.ts):
`linear-gradient(180deg, color-mix(in srgb, var(--disc) 95%, #fff), var(--disc))`
paired with the disc shadow. The share card's counted chips are the one
deliberate exception (flat fill + inset ring). The empty bar states its
emptiness as a dashed #2f343a outline box with a + glyph.

## Components

Tactile and confident: controls feel like physical buttons -- big, grabbable,
with a real press. Every interactive element presses down (transform scale to
.955, .09s) and transitions color in .16s. Display numbers roll up on change
(`numRoll`, .26s ease-out); sheets rise with `cubic-bezier(.2, .85, .25, 1)`.

### Buttons
- **Shape:** full pill (999px); icon buttons and steppers are 44px circles.
- **Primary:** Plate Yellow fill, Platform Black ink, weight 700 (Done, Copy
  summary, the round-up affordance).
- **Ghost:** transparent with 1px border (#20242a), secondary text; hover
  brightens. Clear hovers to danger red.
- **Press:** scale .955 on :active, .09s; color transitions .16s.

### Mode Toggle (segmented)
- **Track:** full-width pill, raised fill (#15171a), 1px border (#20242a),
  4px inner padding.
- **Active segment:** solid Plate Yellow, Platform Black ink, weight 700.
- **Inactive:** transparent, dim text (#8b929a), weight 600.

### Chips
- **Loaded chips** (On the bar): plate-colored via DISC_FILL + disc shadow,
  mono numeral label, horizontally scrolling with gradient nudge arrows.
- **Recent chips:** outline pills -- transparent, 1px border, primary text.
- **Share-card chips:** flat plate fill + inset ring (the deliberate
  non-gradient exception), with pair counts (`2x 25`).

### Selector Tiles (Setup sheet)
- **Active:** selected fill (#272b30), 1px border-active ring (#3a4047),
  11px radius, check mark.
- **Inactive:** transparent, 1px border (#20242a).

### Inputs
There are no text fields. The Target value itself is a button -- Hanken 700
30px `tabular-nums` over a 2px underline that focuses to accent -- flanked
by 52px circle steppers that snap to a 1 kg / 5 lb grid. Tapping it opens
the keypad bottom sheet: sunken fill (#101216), 1px top border, 24px top
corners, sheet-class lift, fixed to the viewport bottom (max 520px) so
opening it never displaces the bar above.

The keypad is **deliberately scrimless** -- the one overlay without a dim
scrim, so the bar stays bright and interactive above the pad and the lifter
watches the plates resolve live while typing. It dismisses only via Done or
re-tapping the value, never an outside tap. Because the field behind it is
covered, the sheet carries its own readout: a live value (Hanken 800, 46px,
-.02em, `tnum`, rolling on change), a dim unit suffix (18px/700), a
secondary line in the other unit (mono 13px), and an accent "On the bar"
load line fed by the solver.

Keys sit in a 3-column grid (8px gap): 56px minimum height, mono 22px/600,
hairline borders, **card radius (14px), not pill** -- the keypad is the pill
language's one squared-off zone, footer included (ghost Clear + accent Done,
48px tall). The first keypress after opening replaces the shown value;
closing the pad is the commit that feeds Recents. Disabled palette keys drop
to 30% opacity with `not-allowed`.

### Status Pill
- **Exact:** green dot + text. **N over:** solid accent pill. **N short:**
  outline pill. **Bar at capacity:** the sleeve-full warning.

### Bar Visualizer (signature component)
The centerpiece: a side-on bar rendered from tokens -- chrome sleeve greys,
discs heaviest-to-lightest from the inside out, engraved vertical numerals,
real-diameter proportions scaled to fit. Empty state is the dashed box. In
Add plates mode discs are tappable; fullscreen blows the same render up into
rotated landscape.

- **Sleeve end (RBAR-96):** past the outer disc (or the empty box) the sleeve
  runs out as a bare stub to a plain rounded end -- 30 x 11px, shaft grey,
  radius 0 5px 5px 0. No end collar and no cap: nothing after the plates
  looks like a stopper.
- **Collar (RBAR-96, "look 2 flat"):** drawn only when Setup's collars are on
  AND the Bar has plates; a bare Bar never gets one. It clamps the outer
  disc: 20px wide, 1px off the disc, 92 mm tall on the disc scale (it scales
  with the discs), radius 3px, a solid collar-grey fill with a 1px end-grey
  edge, and a flat 8x8 plate-red latch standing on its top edge. No gradient,
  no number -- the Total already counts the Collar.
- The console sleeve, the fullscreen card and the share picture all draw this
  end and Collar from one geometry (lib/sleevefit.ts).

## Do's and Don'ts

### Do:
- **Do** style every surface through `--rack-*` tokens in tokens.css -- one
  source of truth per value (ADR-0001); reach for the precise named tier
  (e.g. `--rack-border-strong`), never the legacy collapsed aliases
  (`--rack-bg`, `--rack-muted`, `--rack-line`) in new code.
- **Do** use the shared DISC_FILL gradient + disc shadow for any
  plate-colored surface, with per-color ink (dark on white/yellow, white
  otherwise).
- **Do** pair every color-coded element with a numeral or shape cue -- color
  is never the sole channel.
- **Do** keep touch targets at 44px minimum with the press-scale feedback;
  chalk-hands usability is a product commitment.
- **Do** use tabular/mono numerals for every weight readout, rolling on
  change (numRoll .26s).

### Don't:
- **Don't** introduce new saturated interface colors; the plates own the
  color (accent yellow is the 15 kg plate's hex, danger the 25 kg red).
- **Don't** restyle, lighten, or "theme" the plate palette -- the hexes are
  domain facts lifters navigate by.
- **Don't** add shadows to resting UI; depth at rest is tonal (the surface
  ladder). Shadow is reserved for discs and overlays (the Physical Lift
  Rule).
- **Don't** gradient the share card's chips -- flat fill + inset ring is the
  spec'd, deliberate exception.
- **Don't** add a scrim behind the keypad or an outside-tap dismissal -- its
  scrimless brightness is a deliberate fidelity call so the bar stays live
  while typing.
- **Don't** diverge from the design handoff's look (docs/design-handoff/)
  in build slices; aesthetic changes route through a design pass.
