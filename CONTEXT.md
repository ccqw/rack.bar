# rack.bar

A mobile-first, touch-friendly tool for loading a barbell to a target weight in
the gym. Lives at **rack.bar**. Kilogram-based for v1 (Eleiko competition color
scheme). Two directions:
**decode** a target into the plates to load, and **encode** a tapped-on set of
plates back into a total. A future game mode will quiz this same skill.

## Language

**Bar**:
The barbell being loaded; contributes its own weight to the Total. The lifter
selects the Bar from the Plate set's offer -- Competition 20 / 15 / 5 kg (default
20 kg), Training 45 lb or 20 kg (default 45 lb). A Bar is named in the unit it is
stamped in.
_Avoid_: barbell, rod.

**Collar**:
A clamp on the Side that secures the Plates. Competition collars weigh 2.5 kg each
and count toward the Total like the Bar; lighter clips weigh effectively nothing.
Optional -- the lifter chooses None or a Standard collar.
_Avoid_: clamp, clip (when the 2.5 kg competition collar is meant).

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

**Sleeve**:
The loadable length of one Side of the Bar -- the room the Plates actually have.
A Side Load that would run past the Sleeve cannot be racked, no matter how many
Plates the Inventory holds; the solver never proposes one (ADR-0012). One length
for every Bar in v1 (415 mm, the design handoff's model).
_Avoid_: shaft, loadable zone.

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
standard Eleiko set. Each size may carry a Plate limit (ADR-0016), which makes it a
finite Inventory.
_Avoid_: stock, supply.

**Plate limit**:
How many pairs of one size the lifter has: all (unlimited, the default), N pairs,
or none. Counted in pairs because loading is symmetric (one per Side), so N pairs
is at most N of that Plate on a Side. Decode never loads past a Plate limit and
picks among the loads the limits allow by the usual rule (ADR-0003). The UI may say
"pairs" and "none here".
_Avoid_: stock, missing, excluded, out, unavailable.

**Plate set**:
The family of Plates (with its matching Bar and native Unit) the lifter is loading:
the **Competition** set (Eleiko, color-coded, kilograms) or the **Training** set
(plain iron, pounds). Choosing a set fixes the Inventory and the native Unit (the Unit its Plates and Bars are stamped in); the Primary unit stays the lifter's choice.
Defaults to Competition / kg.
_Avoid_: plate type, kit.

**Unit**:
A system of weight measure the lifter reads and enters weights in: **kilograms**
(kg) or **pounds** (lb). A Unit is how a weight is _shown_, not a different weight.
On the **Competition** Plate set the Plates are always named by their kilogram
weight and color (the Eleiko set is metric), and pounds is a conversion applied to
entry and the readouts only (ADR-0006). The **Training** Plate set is natively
pounds -- see Plate set and ADR-0006's 2026-06-28 amendment.
_Avoid_: measurement, system.

**Primary unit**:
The Unit the lifter has chosen for entry and the prominent readout. Every typed
Target, and the steppers, work in the Primary unit.
_Avoid_: main unit, default unit.

**Secondary unit**:
The other Unit, shown small alongside the Primary for reference. The lifter may
hide it to read in just one Unit.
_Avoid_: alternate unit.

**Working set**:
The top set of a session -- the heaviest load the lifter trains at. Its Target is
the one the lifter enters for a Ramp; its Total is Decode's at-or-under answer
(ADR-0003) and is the Ramp's 100%. The UI may label its Target "working weight"
(plain-language copy), but in code and docs it is the Working set's Target.
_Avoid_: top set, work set, working weight (as a glossary term).

**Warm-up set**:
A lighter set before the Working set, specified as a percentage of the Working
set's Total (or as the bare Bar). Its Total is the nearest loadable Total to that
percentage, ties down (ADR-0015) -- unlike Decode, it may land slightly over. In
Warm up mode the station rule may move it within 5% of the Working Total of that
percentage, so the Ramp is easy to load.
_Avoid_: ramp-up set, light set, feeder set.

**Ramp**:
The ordered list of Warm-up sets that builds to a Working set, with the Working set
as its last row. Totals never decrease down a Ramp. The default is Caitlin's
deadlift ramp: Bar x7, 50% x7, 70%, 90%, then the Working set. The mode that shows
it is labelled **"Warm up"** in the UI.
_Avoid_: plan, pyramid, progression, warm-up ladder.

**Plate move**:
Taking one Plate off a Side or putting one on, between two sets of a Ramp. A Side is
a stack, inside to outside, so changing an inside Plate costs every Plate outside it.
Taking off a **big Plate** (full diameter, 450 mm: Competition 25-10 kg, the iron
45 lb) costs most. Big Plates may go on in any order; every other Plate goes outside
them, heaviest-first (ADR-0015, the station rule).
_Avoid_: swap, step, change (alone).

**Station**:
The Plates a lifter gathers beside the rack for one Ramp: for each size, the most of
it any one set needs on a Side. The station rule plans a Ramp to need a small one
(ADR-0015).
_Avoid_: pile, stash, plate tree.

## Relationships

- A **Bar** plus a symmetric **Side Load** on each **Side** produces a **Total**.
- A **Side Load** is built from **Plates** drawn from the **Inventory**.
- **Decode**: a **Target** maps to a **Side Load** (and the **Total** it achieves).
- **Encode**: a tapped-on **Side Load** maps to its **Total**.
- A **Ramp** is **Warm-up sets** then a **Working set**; each Warm-up set's Total is
  a percentage of the Working set's Total, rounded to a loadable one.
- A **Target** and a **Total** are weights; each can be read in either **Unit**, but
  the **Plates** that build them are always kilograms.

## Example dialogue

> **Dev:** "When the lifter enters a **Target** of 100, what do we show?"
> **Domain expert:** "The **Side Load** — 20 + 15 + 2.5 per **Side** — and the
> **Total** it actually reaches. If 100 isn't buildable from the **Inventory**,
> the **Total** is the nearest we can get, and we say so."

## Flagged ambiguities

- **Target vs Total**: the desired weight vs the achieved weight. Kept distinct
  on purpose — they diverge whenever a Target can't be built exactly.
