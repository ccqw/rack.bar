# rack.bar

A mobile-first, touch-friendly tool for loading a barbell to a target weight in
the gym. Lives at **rack.bar**. Kilogram-based for v1 (Eleiko competition color
scheme). Two directions:
**decode** a target into the plates to load, and **encode** a tapped-on set of
plates back into a total. The **Loadout quiz** (game.html) drills reading a loaded
Side: it shows one, the lifter types the Total.

## Language

**Bar**:
The barbell being loaded; contributes its own weight to the Total. The lifter
selects the Bar from the Plate set's offer -- Competition 20 / 15 / 5 kg (default
20 kg), Training 45 lb or 20 kg (default 45 lb) -- or one of the **custom Bars** the
lifter adds, offered on every Plate set, at most three per set (ADR-0017). A Bar is named in the
unit it is stamped in; a custom Bar is stored and named by its **stamp**, the number
and unit written on it, exactly as typed ("35 lb").
_Avoid_: barbell, rod; "user bar", "my bar" (it is a custom Bar).

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

**Way**:
One Side Load that makes a given Total. A Total usually has several: 140 kg on a
20 kg Bar is 25 + 25 + 10, or 25 + 20 + 15, or 20 + 20 + 20 per Side. Decode loads
the first way (fewest Plates, then heaviest-first, ADR-0003); the others are offered
in that same order, at most five, all fitting the Sleeve and the Plate limits, never
a different Total (RBAR-66). The UI says **"Another way"**; tapping the Bar steps to
the next way.
_Avoid_: alternate loadout, alternative (the round-up is ADR-0003's "alternative"),
option, variant, permutation.

**Target**:
The total weight the lifter _wants_ on the Bar (Bar + all Plates).
_Avoid_: goal, working weight.

**Total**:
The weight _actually_ on the Bar = Bar weight + 2 x Side Load. May differ from
the Target when the Target is not exactly achievable.
_Avoid_: sum, result.

**Inventory**:
The Plates available to draw from when decoding a Target: the Plate set's sizes with
the lifter's Plate limits applied (ADR-0016). Defaults to an unlimited standard Eleiko
set. The lifter sets it in Setup as **Pairs of Plates on Hand** (RBAR-72); that is the
UI name, Inventory the code and docs name.
_Avoid_: stock, supply; "plates you have", "gym plates", "plate inventory" (as terms).

**Pairs of Plates on Hand**:
The Setup section where the lifter sets a Plate limit for each size of the active
Plate set: All, 1-4 pairs, or None. One setting per Plate set, saved, never expiring
(no "today" vs "this gym" split); a share link never carries it. Stored as limits, not
a have-list, so a size with no entry is All.
_Avoid_: plates at this gym, plates here, today's plates, exclusions.

**Plate limit**:
How many pairs of one size the lifter has: all (unlimited, the default), N pairs,
or none. Counted in pairs because loading is symmetric (one per Side), so N pairs
is at most N of that Plate on a Side. Decode never loads past a Plate limit and
picks among the loads the limits allow by the usual rule (ADR-0003). The UI says
"all", "1 pair", "N pairs" and "none" (Setup tiles), and By Plates badges a limited
size "x1".."x4" and dims a none size, never blocking a tap (ADR-0012).
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
the Target: one number shared by By Weight and Warm up (RBAR-87), so the weight set in
By Weight, or the Total of a load built in By Plates, is what the Ramp builds to.
Its Total is Decode's at-or-under answer (ADR-0003) when that reads as the Target;
when it reads short, Warm up rounds the Working set up to the least loadable Total
above the Target (RBAR-87). That Total is the Ramp's 100%. The Target itself stays as
typed, and By Weight still decodes it at or under. The UI may label its Target "working weight"
(plain-language copy), but in code and docs it is the Working set's Target.
_Avoid_: top set, work set, working weight (as a glossary term).

**Warm-up set**:
A lighter set before the Working set, specified as a percentage of the Working
set's Total (or as the bare Bar). Its Total is the nearest loadable Total to that
percentage, ties down (ADR-0015) -- unlike Decode, it may land slightly over. In
Warm up mode the station rule may move it within 5% of the Working Total of that
percentage, so the Ramp is easy to load. A Warm-up set that the Plates on hand push
further than that is a **drifted** set; its stair shows its real percentage, "~83%"
(ADR-0016 as amended). A set on the bare Bar never counts as drifted.
_Avoid_: ramp-up set, light set, feeder set.

**Max**:
A lifter's saved one-rep max for a named lift ("Squat 140 kg"), kept on the device, at
most six. It keeps the number and Unit it was typed in. A Target can be entered as a
percentage of one ("80% Squat" is 112 kg); Decode then lands at or under it as usual
(ADR-0020). The UI says "Maxes" and "Add a lift".
_Avoid_: PR, 1RM (as terms), personal best, record.

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
  That Side Load is the first **Way** to that Total; the lifter may load another.
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
