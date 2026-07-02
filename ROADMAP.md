# Roadmap

What v1 deliberately is, and what we've parked for later. The product is **rack.bar**.
v1 is the **Decode/Encode calculator**; the game mode and the items under Later are
intentionally deferred.

Reconciled against the authoritative Claude Design handoff (`docs/design-handoff/`,
the RBAR-10 design pass output) on 2026-06-28. That pass pulled the pounds plate set
and bar selection forward into v1 and added the rig-configuration and sharing
features below. The handoff is the source of truth for v1 scope and look-and-feel.

## v1 (calculator)

- Eleiko kilogram plate set, color scheme -- the competition Plates are kg.
- **Pounds** ships as two distinct layers, both in v1 (both built under RBAR-17):
  - A kg/lb display + entry switch over the kg set -- a Primary unit with a
    Secondary readout alongside (ADR-0006). Display only; no lb plates.
  - A real **pounds plate set** -- a plain-iron lb Inventory + lb bar, chosen via a
    plate-set switch, so the shown Plates match a US gym's rack and the solver runs
    natively in lb. Pulled forward from Later by the design pass.
- **Bar selection** -- 20 / 15 / 5 kg, chosen in the Setup sheet (RBAR-15). The Bar
  is already a first-class solver input (ADR-0002); this surfaces the UI.
- **Collars** -- optional competition collars (None / 2.5 kg per Side) that count
  toward the Total, chosen in the Setup sheet (RBAR-16).
- Unlimited standard Inventory (modeled as finite-ready, finite UI deferred).
- **Sleeve-capped solver** -- the core never proposes a Side Load that outruns the
  Bar's loadable sleeve; a full sleeve reads "Bar at capacity" with no phantom
  round-up, and Encode refuses a Plate that will not fit (RBAR-31, ADR-0012).
  Pulled into v1 on 2026-07-01 -- goes beyond strict handoff parity, whose engine
  only flags capacity.
- Decode (Target -> Side Load) primary; Encode (tap plates -> Total) secondary.
- One unified screen, obvious mode toggle, shared interface.
- Hybrid weight entry: value + steppers, tap-to-type exact.
- Nearest at-or-under Target by default; closer over-Target offered as an opt-in.
- One-sleeve side-view bar graphic, plates sized by real diameter.
- **Fullscreen rack card** -- an immersive landscape blow-up of the loaded bar,
  glanceable from across the rack (RBAR-18).
- **Share / copy summary** -- a loading card with a plain-text summary copied to the
  clipboard (RBAR-19).
- **Recent targets** -- recent Targets persisted (deduped, most-recent-first, max 6)
  and re-applied from chips (RBAR-20).
- **Help** -- a how-it-works popover explaining the two modes (RBAR-21).

## Later (parked, in rough priority order)

- **Game / quiz mode** -- the original second half: progressively harder drills on
  the Decode/Encode skill, built on the calculator's components.
- **Finite Inventory** -- enter how many pairs of each plate you own (home gym);
  the solver already takes Inventory as input.
- **Math on entry** -- percentage-of-working-weight for warm-up ramps
  ("what's 70% of 140?"), and possibly arithmetic in the entry field.
