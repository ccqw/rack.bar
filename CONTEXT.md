# rack.bar

A mobile-first, touch-friendly tool for loading a barbell to a target weight in
the gym. Lives at **rack.bar**. Kilogram-based for v1 (Eleiko competition color
scheme). Two directions:
**decode** a target into the plates to load, and **encode** a tapped-on set of
plates back into a total. A future game mode will quiz this same skill.

## Language

**Bar**:
The barbell being loaded; contributes its own fixed weight to the total.
_Avoid_: barbell, rod.

**Plate**:
A weight disc loaded onto the Bar. Always added in symmetric **pairs** — one per
Side — so the lifter only ever reasons about one Side. Lifters often name a Plate
by its **color** ("throw a red on"), so color is domain vocabulary, not decoration.
The v1 set (Eleiko, kg) and its colors:

| Plate | Color | | Plate | Color |
|------:|-------|-|------:|-------|
| 25 | red    | | 2.5 | red    |
| 20 | blue   | | 2.0 | blue   |
| 15 | yellow | | 1.5 | yellow |
| 10 | green  | | 1.0 | green  |
|  5 | white  | | 0.5 | white  |

_Avoid_: weight, disc.

**Side**:
One end of the Bar. The lifter physically loads a single Side; the other is its
mirror image.
_Avoid_: end.

**Side Load**:
The total Plate weight on one Side (not counting the Bar).
_Avoid_: per-side weight (descriptive, not canonical).

**Target**:
The total weight the lifter _wants_ on the Bar (Bar + all Plates).
_Avoid_: goal, working weight.

**Total**:
The weight _actually_ on the Bar = Bar weight + 2 x Side Load. May differ from
the Target when the Target is not exactly achievable.
_Avoid_: sum, result.

**Inventory**:
The Plates available to draw from when decoding a Target. Defaults to an unlimited
standard Eleiko set; will later support finite pair-counts for a home gym.
_Avoid_: stock, supply.

## Relationships

- A **Bar** plus a symmetric **Side Load** on each **Side** produces a **Total**.
- A **Side Load** is built from **Plates** drawn from the **Inventory**.
- **Decode**: a **Target** maps to a **Side Load** (and the **Total** it achieves).
- **Encode**: a tapped-on **Side Load** maps to its **Total**.

## Example dialogue

> **Dev:** "When the lifter enters a **Target** of 100, what do we show?"
> **Domain expert:** "The **Side Load** — 20 + 15 + 2.5 per **Side** — and the
> **Total** it actually reaches. If 100 isn't buildable from the **Inventory**,
> the **Total** is the nearest we can get, and we say so."

## Flagged ambiguities

- **Target vs Total**: the desired weight vs the achieved weight. Kept distinct
  on purpose — they diverge whenever a Target can't be built exactly.
