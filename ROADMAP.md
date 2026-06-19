# Roadmap

What v1 deliberately is, and what we've parked for later. The product is **rack.bar**.
v1 is the **Decode/Encode calculator** in kilograms; the game mode and everything
below are intentionally deferred.

## v1 (calculator)

- Kilogram plate set, Eleiko color scheme — the Plates are always kg.
- Pounds option: a kg/lb switch converts entry and the readouts (a Primary unit
  with a Secondary readout alongside). A display + entry layer only — no lb plates
  (RBAR-14, ADR-0006).
- Fixed 20 kg Bar (modeled as swappable, UI deferred).
- Unlimited standard Inventory (modeled as finite-ready, UI deferred).
- Decode (Target -> Side Load) primary; Encode (tap plates -> Total) secondary.
- One unified screen, obvious mode toggle, shared interface.
- Hybrid weight entry: value + steppers, tap-to-type exact.
- Nearest at-or-under Target by default; closer over-Target offered as an opt-in.
- One-sleeve side-view bar graphic, plates sized by real diameter.

## Later (parked, in rough priority order)

- **Game / quiz mode** — the original second half: progressively harder drills on
  the Decode/Encode skill, built on the calculator's components.
- **Pounds plate set** — a real lb Inventory (45/35/25/10/5/2.5 lb) + lb bar, so the
  shown Plates match a US gym's rack and the solver runs natively in lb. (The lb/kg
  _display + entry_ switch is a separate, narrower feature — a converting layer over
  kg, see ADR-0006 — not this parked item. This parked item is only the physical lb
  plate set.)
- **Bar selection** — women's 15 kg, technique/training bars, custom. The Bar is
  already a first-class solver input; this is the UI to choose it.
- **Finite Inventory** — enter how many pairs of each plate you own (home gym);
  solver already takes Inventory as input.
- **Math on entry** — percentage-of-working-weight for warm-up ramps
  ("what's 70% of 140?"), and possibly arithmetic in the entry field.
