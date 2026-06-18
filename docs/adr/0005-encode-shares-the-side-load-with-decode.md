# Encode shares the Side Load with Decode

rack.bar is bi-directional (CONTEXT.md): **Decode** maps a Target to a Side Load,
**Encode** maps a tapped-on Side Load back to its Total. RBAR-7 adds the Encode
direction and the mode toggle. The decision recorded here is *where the state lives*:
the **Side Load is a single value owned by the console**, and the mode chooses who
edits it -- not two parallel states that have to be kept in sync.

## The core: Encode is `totalKg`, plus two Side Load transforms

`encode(side, bar)` is the Total of a hand-built Side Load -- which is exactly
`totalKg(side, bar)` from `plates.ts` (Bar + 2 x Side Load, CONTEXT.md). So `encode`
is a thin, domain-named wrapper that mirrors `decode`, not new math; an empty Side
Load reads as the bare Bar. The genuinely new pure logic is the pair of Side Load
transforms the tap UI drives:

    addPlate(side, plate)    -> a new Side Load with `plate` inserted, heaviest-first
    removePlate(side, plate) -> a new Side Load with the first match of `plate` dropped

Both are pure (ADR-0001 core/shell split): they never mutate their input and always
return a fresh heaviest-first array, so the shell can treat the Side Load as an
immutable value it swaps wholesale. "Heaviest-first" is the load order CONTEXT.md
fixes for a Side Load, the same order the sleeve already draws. `removePlate` drops a
single match by value (kg + color); for the canonical Eleiko set two Plates of the
same kg are identical, so removing "a 25" is indistinguishable from removing "the
tapped 25" -- the transform stays defined by value, not by index.

## The shell: one shared Side Load, the mode picks the editor

The console owns the Side Load (and the Bar). The two modes are two editors over that
one value:

- **Decode**: the Target entry derives the Side Load via `decode()` (ADR-0003 still
  governs at-or-under + the over opt-in). The Side Load is computed, read-only.
- **Encode**: a Plate palette taps `addPlate` onto the Side Load; tapping a loaded
  disc on the sleeve taps `removePlate`. The Total is `encode(side, bar)`.

Switching modes **never clears the Side Load**. Decode 100 -> switch to Encode shows
the 25 + 15 already loaded, ready to tap a 5 on or pull the 25 off; build 110 in
Encode -> switch to Decode and the same 110 loadout is still on the Bar until a new
Target is typed. This is the "shared Bar + Side Load state persists across the switch"
requirement, and falls out for free *because* there is one state, not two.

The alternative -- a separate `decodeSide` and `encodeSide`, reconciled on toggle --
was rejected: it duplicates the source of truth and makes "persists across the switch"
a sync chore instead of an invariant. The cost of the chosen model is that Decode's
delta / over-target affordances (ADR-0003) are meaningful only when a Target has been
typed; after a bare mode-switch Decode shows the carried Side Load and its Total with
no delta note, which is correct (there is no Target to miss).

## New elements (ADR-0001: shell = thin custom elements over the pure core)

- **`<rack-palette>`** -- the Encode add-affordance: a row of tappable Plate buttons in
  the Eleiko colors (the `ELEIKO_KG` denominations), each emitting an `addplate` event
  with its Plate. Decode does not show it.
- **`<rack-sleeve>`** gains an `interactive` flag. When set (Encode), its discs are
  buttons that emit `removeplate` with the tapped Plate; unset (Decode), the discs are
  inert as before. The graphic is unchanged -- only the affordance differs.

Both stay presentational: they emit intent (`addplate` / `removeplate`) and the
console applies the pure transform and pushes the new Side Load back down. No plate
math leaves `lib/`.

## Out of scope (deferred, consistent with the roadmap)

Real diameter-based plate sizing (ADR-0004) is still RBAR-9; the sleeve here keeps the
skeleton's uniform discs. The hybrid steppers/keypad entry is RBAR-8. Bar selection and
finite Inventory remain parked (ROADMAP) -- `encode` already takes the Bar as a parameter
(ADR-0002) and the palette draws from the Inventory's denominations, so both stay
additive: new UI feeding existing parameters, not a core change.
