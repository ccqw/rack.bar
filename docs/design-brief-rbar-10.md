# rack.bar - Claude Design handoff (RBAR-10)

A standing brief for the look-and-feel + interaction-feel pass on the working
prototype, run with Claude Design (Anthropic's in-browser design-in-code tool,
Opus). Claude Design points directly at this repo and reads the code itself, so
this doc is the framing and the fence -- what to read, what you own, what is
frozen -- not a code dump.

**Repo:** github.com/ccqw/rack.bar, branch `main`. Live at rack.bar. Run it with
`npm run dev`.

## What rack.bar is

A mobile-first, touch-first barbell-loading calculator (kg, Eleiko competition
colors). You enter a Target weight and it shows the plates to load on one Side of
the bar (Decode), or you tap plates on and it tells you the Total (Encode). One
toggle, shared state. No backend; static site on GitHub Pages.

## Your job

A look-and-feel + interaction-feel pass on the working prototype. Visual identity,
plate/sleeve rendering aesthetics, the entry control's feel, typography, motion,
spacing, and the Decode/Encode toggle treatment. Make it feel like a sharp,
physical, gym-native tool -- not a generic calculator.

## Read first

- `CONTEXT.md` -- the domain language (Bar, Plate, Side Load, Target vs Total,
  Decode/Encode). Controlled vocabulary with per-term Avoid lists.
- `tokens.css` -- the design system: `--rack-*` tokens for type, surface, the
  plate palette, radius, accent.
- `docs/adr/0004-realistic-side-on-plate-sizing.md` -- how plates are dimensioned.
- `elements/sleeve.ts` -- the visual centerpiece (the loaded Side, drawn as
  colored discs).
- `AGENTS.md` -- the architecture invariants.

## The design surface (what you own)

- **`tokens.css`** -- the primary lever. Editing a `--rack-*` value restyles the
  whole app at once (these properties cross the Shadow DOM boundary). Palette
  shades, type stack, radius, accent, surface colors all live here. Add tokens
  freely (motion durations, spacing scale, shadows) -- just keep them `--rack-*`.
- **Per-element Shadow DOM `<style>` blocks** -- in `elements/sleeve.ts`,
  `console.ts`, `entry.ts`, `palette.ts`. Component-local look: disc treatment,
  label, the +/- steppers and keypad, the palette, the toggle. Style *through*
  tokens, not hard-coded values, wherever a token fits.
- **`index.html` `<style>`** -- the page shell (body, the centered `<main>`).
- Typography, motion/transitions, layout proportion, hierarchy, and the toggle's
  visual language are all yours.

## Hard constraints (do not touch)

- **`lib/` is frozen.** `decode.ts`, `encode.ts`, `plates.ts` are the pure, tested
  functional core. No logic changes -- elements only wire DOM to them (core/shell
  split, ADR-0001). The test suite must stay green.
- **Plate color is domain vocabulary, not decoration.** red = 25 / 2.5,
  blue = 20 / 2.0, yellow = 15 / 1.5, green = 10 / 1.0, white = 5 / 0.5 (the change
  plate mirrors its 10x bumper's color). You may retune the *hex shades* for
  screen, but each plate must stay instantly recognizable by its lifter color, and
  the bumper / change-plate color pairing must hold.
- **ADR-0004 dimensional encoding stays.** A disc's *height* tracks the real plate
  diameter and its *width* tracks real thickness, all under one fit-to-width scale.
  You can restyle the disc (radius, edge, shadow, the on-plate kg label) but not
  what its size *means*.
- **Keep it a static MPA.** No backend, no framework, no heavy deps -- it ships to
  GitHub Pages. Web Components + Shadow DOM stay.
- **Respect the glossary.** Any user-facing copy uses CONTEXT.md's vocabulary.
  (Note: the toggle reads "By Weight" / "By Plates" on purpose -- plain language
  over the internal Decode/Encode.)

## Settled baseline you can revisit (RBAR-9, HITL)

It was deliberate, so know what you are changing. The kg label sits **on** the
plate, horizontal on the wide bumpers; on plates thinner than ~30 mm the digits
stack one-per-line (2.5 -> 2 / . / 5, upright, never rotated); sub-1 plates drop
the leading zero (.5). These were chosen over rotated-vertical, captions-below,
and widening thin plates. Treat as the baseline; improve on it if you have
something sharper.

## Open directions to explore

- A stronger visual identity than the current "dark surface, system font"
  placeholder -- a real type choice, a refined dark palette that lets the plate
  colors carry the screen, motion when plates load / unload.
- The entry control (`<rack-entry>`): the value + `-` / `+` steppers and the
  tap-to-type keypad -- make the primary number feel like the hero.
- The Decode/Encode toggle: right now it is functional; give it a real treatment.

## Unit conversion (kg / lb) -- new chrome to design (RBAR-14)

rack.bar now needs a pounds option, tracked as RBAR-14 and co-designed in this
pass. It is a **display + entry layer only** -- the plates on screen are ALWAYS the
kg Eleiko set (colors/sizing unchanged). Pounds is just how the numbers are read and
typed. Full spec:
`docs/adr/0006-pounds-is-a-display-unit-not-a-plate-set.md` and the Unit / Primary
unit / Secondary unit terms in `CONTEXT.md`.

Two new things to design:

1. **A Primary unit toggle (kg | lb).** A *second* toggle, alongside the existing
   By Weight / By Plates toggle. The real problem is two toggles on one small screen
   without clutter -- they control different axes (kg/lb = what unit; By Weight /
   By Plates = which direction). Make the relationship obvious; don't let them read
   as one 4-way control.
2. **A Secondary readout.** The Target and the Total each show the *other* unit small
   alongside the primary number, e.g.:

   ```
   Target            Total
   315 lb            314 lb
   (142.9 kg)        (142.5 kg)
   ```

   Plus an affordance to hide the Secondary, so a lifter can read in just one Unit
   (a setting, a tap on the readout -- whatever reads cleanest).

Behavior to respect (fixed -- do not design around these):

- Entry and the +/- steppers are always in the Primary unit; you flip the toggle to
  enter/read in the other. No unit switch on the keypad.
- lb shows as whole pounds; kg as-is. Steppers nudge 5 lb in lb, 1 kg in kg.
- The entry caption ("Target (kg)") and the Total label reflect the Primary unit.
- The "exact / under target / round up" affordances appear only when the numbers the
  lifter *reads* actually differ -- so in lb the under/over note is usually absent.
  Design the under-note + round-up button to be comfortable being absent.

## How it folds back

Output returns via `--rack-*` tokens and element Shadow DOM styles, keeping the
core/shell split intact. If any change touches vocabulary or structure (not just
pixels), capture it as a short ADR or a `CONTEXT.md` update. Verify with
`npm run dev` (happy-dom can't see rendering, so visual changes need a real
eyeball), and keep `npm test` and `npm run typecheck` green.
