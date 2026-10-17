# Plate sets carry their own native Unit and Inventory

RBAR-17 ships pounds end-to-end: a kg|lb display layer over the Competition
(Eleiko, kg) set, AND a real plain-iron Training set whose Plates are stamped in
pounds. This supersedes the boundary ADR-0006 drew -- "pounds is a display unit,
not a plate set, and the lb plate set stays parked." Both ship now.

## What a Plate set is

A **Plate set** is not just an Inventory. It bundles three things that move
together:

- an **Inventory** (the Plates available to draw from),
- a **native Unit** (the Unit the set is stamped and reasoned in), and
- the **Bars** it offers (with a default).

The two v1 sets:

| set         | inventory         | native unit | bars (default first) |
| ----------- | ----------------- | ----------- | -------------------- |
| Competition | Eleiko, color, kg | kg          | 20, 15, 5 kg         |
| Training    | plain iron, lb    | lb          | 45 lb, 20 kg (RBAR-63) |

kg is therefore **no longer the sole canonical Unit** (ADR-0006 relaxed). Instead:

- The **solver core stays kilograms internally.** Every Plate carries its true
  **kg** mass, including the iron Plates (45 lb = 20.41166 kg). `decode`/`encode`
  run in kg exactly as before. "The Training solver runs natively in lb" means the
  iron masses are round-lb values, so the lb readouts come out exact -- not that a
  second solver exists. The Unit is a property of how a set is *shown and entered*,
  resolved at the shell boundary; the core never sees a Unit.
- The greedy loader is **unchanged**, and ADR-0003's at-or-under correctness still
  holds for the iron set: that greedy heaviest-first equals the true greatest-achievable
  total at or under target was verified against a DP oracle for {45,35,25,10,5,2.5} lb
  across every reachable total up to 405 lb (the regression test's bound; well past any
  real load). The iron set is canonical, like Eleiko -- no search needed.

So the core change is small: `decode` already takes an `inventory` parameter
(ADR-0002); the iron set is just a different array passed to it. The Plate model
gains an `'iron'` color and an optional face `label` (the number stamped on an iron
Plate, e.g. "45"); a Competition Plate keeps deriving its label from its kg.

## Display + entry layer (the kg|lb toggle, folded from RBAR-14)

A **Primary Unit** (kg or lb) drives entry, the steppers, and the prominent
readout; a **Secondary Unit** shows small alongside and can be hidden (CONTEXT.md).
Conversion uses the exact factor **1 lb = 0.45359237 kg** internally; the lb readout
rounds to **whole pounds** (the kg readout is unchanged: <= 2 dp, trailing zeros
stripped). Steppers nudge **5 lb** when Primary is lb, **1 kg** when kg. These pure
helpers live in a new `lib/units.ts` (drawn from the handoff engine's `LB` /
`draftToKg` / `toLbWhole` / `stepFor`, reviewed for fit); the existing inline
`KG_TO_LB` in `setup.ts` collapses onto it.

### Displayed-unit exactness (the one piece not in the engine)

The "under target" note and the over-target round-up opt-in (ADR-0003) key off the
**rounded numbers the lifter actually reads**, not the raw kg delta. If the
displayed Total equals the displayed Target in the Primary Unit, the Target is
treated as exact: both the note and the round-up control hide. Why: the achievable
grid is whole kilograms (~2.2 lb apart), so a target typed in pounds almost never
lands on the kg grid -- keying the note off the raw kg delta would fire it on nearly
every lb entry, including when the rounded lb Total already equals the target (enter
311 lb, get a "311 lb" bar that is 0.15 lb under). Comparing the displayed numbers
keeps "exact / under / over" honest to what is on screen, and it is a strict
generalization of the kg behavior (in kg the displayed numbers already match the
grid, so nothing changes there). This is view-layer logic and lives entirely in the
console (ADR-0001); the core stays the source of truth for *what* the loadout is,
the shell decides *whether a miss is worth showing*. (Carried over verbatim from
ADR-0006, which first reasoned it; it now also governs the iron set, where it is a
no-op because iron targets land on the lb grid.)

## Reconciling the plate-set switch with the unit toggle

Two controls could contradict (pick Training, then toggle to kg). The rule:

> **Superseded 2026-10-15 (RBAR-60):** the toggle is free on every set and a set
> switch keeps the lifter's unit -- see the amendment at the end. The two
> forced/remembered bullets below are the original v1 rule, kept for history.

- **Choosing a set forces its native Unit.** Training forces lb and **disables** the
  kg|lb toggle (an iron rack has no kg). Competition leaves the toggle **free**.
- The lifter's free choice on the Competition set is **remembered**: switching to
  Training (forced lb) and back restores their last Competition Unit, not a reset.
- **Switching set resets the Bar to that set's default** (Competition -> 20 kg,
  Training -> 45 lb). A Bar is meaningless across sets (there is no 15 kg iron bar
  here), so we do not try to carry it; the Setup Bar tiles re-render per active set.
- **Collars are unchanged** on both sets (None / Standard 2.5 kg). A competition
  collar is a real object a lifter might clamp on either rig; it folds into the
  effective baseline either way (ADR-0008), so it needs no per-set variant. (If a
  Training-specific collar is ever wanted, that is a later slice.)

## Ownership: rig config vs Target display

This slice draws a clean line that ADR-0006 could not (it predates the app/console
split that ADR-0007 and ADR-0009 introduced):

- **The app shell owns rig configuration** -- what is physically on the Bar: `barKg`,
  `collarKg`, and now **`plateSet`**. Each persists shell-side under its own
  `rackbar.*` key (ADR-0007), validated against its offered set on read so a corrupt
  or legacy key cannot strand the lifter. The Setup sheet hosts all three and emits
  one event up per concern; the app applies and feeds them back down.
- **The console owns Target display** -- how the Target and readout are *shown*: the
  Primary `unit` and `showSecondary`, persisted console-side under `rackbar.unit` /
  `rackbar.secondary`. This follows ADR-0009, which already moved the recents
  display state console-side for the same reason (it is the Target's home). The unit
  toggle renders in the console (beside the By Weight / By Plates toggle, per the
  handoff). The app pushes `plateSet` down to the console as a property; the console
  derives the forced-vs-free Unit rule from it (retired by RBAR-60: there is no
  forced Unit now).

This **supersedes ADR-0006's sketch** that the unit preference is "the app's only
persisted state, app-side." Read ADR-0006's persistence note as its principle
(config persists in the shell, never the core -- still true), not its literal
ownership or count: the unit preference is display state and lives with the console,
the rig config lives with the app, and each independent concern gets its own
`rackbar.*` key.

## Sizing (ADR-0004) needs no change

ADR-0004 already keys disc height off `diameterMm` and width off `widthMm`, carried
on the Plate model. The iron Plates carry their own mm dimensions (from the handoff
`IRON` table), so the sleeve sizes them under the same single fit-to-width scale with
no new logic. The only view additions are an `--rack-plate-iron` color token and
dark-plate ink for the iron discs and palette keys.

## Amendment (2026-10-15, RBAR-60): the unit toggle is free on every set

**The lock is retired.** "Training forces lb and disables the kg|lb toggle (an iron
rack has no kg)" was wrong for real use: the rack has no kg Plates, but the lifter's
programme can be in kg. A lifter who trains on Eleiko at a big gym and on iron at home
wants to type the same kg Targets on both. The handoff prototype agreed all along --
its `setUnit` works on either set; only its `setPlateSet` picks a unit at switch time.

- The kg|lb toggle is live on every set. `PlateSet.unitLocked` is removed; a set's
  `unit` now only names its stamped labels (Bar pill, Setup Bar tiles, iron faces).
- **Switching set keeps the lifter's unit** (Caitlin's call). This deliberately
  diverges from the prototype's switch-time reset (training -> lb, comp -> kg): one
  remembered `rackbar.unit` for both sets, so a kg lifter is never flipped to lb.
- kg readouts on iron use the same <= 2 dp rule as everywhere (the prototype's
  `toFixed(2)`); e.g. 135 lb reads 61.23 kg.

**Decode solves to the Target's reading, not its raw kg.** Freeing the toggle exposed a
gap in the displayed-unit exactness rule above: it judged *status* on the displayed
numbers but still *solved* at or under the raw kg. A reading that rounds down sits
just below the load it stands for -- "55 lb" is 24.95 kg, but the 25 kg load also
reads 55 lb -- so typing back a displayed Total landed a whole Plate step low (114
of the 231 achievable Competition Totals from 20 to 250 kg, read in lb, on main; 33 of
the 72 iron Totals from 45 to 400 lb, read in kg, once kg was allowed on iron). The rule now reaches the solve:

- `units.ts displayCeilingKg(kg, unit)` gives the top of the reading's rounding bucket
  (half a display step: 0.5 lb, or 0.005 kg). The console solves with
  `decode.ts decodeWithin(target, ceiling, ...)`, which decodes at or under the ceiling
  but reports every `delta` against the real Target, so `target = total - delta`
  still holds. The core stays unit-free: it only sees two kg numbers.
- This refines **ADR-0003**: "never overshoots" now means never overshoots the
  Target *as read*. The overshoot of the raw kg is under one displayed unit, so it
  can never show as over; the status pill, round-up offer and keypad line are unchanged.
- **A unit toggle never moves an Exact load, and never moves any load down**
  (Caitlin's call). If the load read Exact in the old unit, that load is what the
  lifter meant: the Target becomes the load, re-read in the new unit (type 55 lb =
  24.95 kg; toggling to kg shows the 25 kg load as 25 kg, Exact, rather than dropping
  a Plate step). A short load re-solves for the Target's reading in the new unit (the
  prototype's `setUnit` re-decodes too); that can only land heavier -- the new reading
  may admit a load the old one did not (27.2 kg on iron reads 60 lb, which 60 lb of
  iron meets exactly).
  A chosen round-up stays chosen only while the same load is still the round-up; when
  the new reading makes it the Exact primary (100.95 kg -> 223 lb, and 101 kg reads
  223 lb) it is shown as the primary, never as a stale "over" whose "use" button would
  step the lifter down to a short load.

## Amendment (2026-10-16, RBAR-63): Training offers a 20 kg Bar; each Bar carries its stamp

The Training row's Bars become **45 lb (default), 20 kg**. Many bars sold and talked
about as "45 lb" are really 20 kg (the IWF standard, Rogue's Ohio Bar); the 0.41 kg
gap is under cast-iron plate tolerance, but a kg lifter typing 20 kg on the 45 lb Bar
read "0.41 kg over". The fix is to let the lifter pick the Bar they own, not to round
one Bar into the other (Caitlin: no rounding fudges).

- **A Bar names itself in its own stamped Unit.** `PlateSet.bars` is now a list of
  `Bar { kg, unit }`; the Setup tile headline and the header pill use the Bar's unit
  (`platesets.ts barUnit`), the tile subtitle the other one. Before, a Bar borrowed
  the set's Unit, which would have called this Bar "44 lb". The set's `unit` now names
  only its Plate stamps (and is the fallback for an off-menu Bar).
- **No swap by display unit.** The kg|lb toggle never changes the Bar: a Bar weighs
  what it weighs. Only the Total/Target readouts follow the toggle.
- **A Bar choice still does not cross sets.** 20 kg is offered by both sets, but a set
  switch always lands on the new set's default, as before. `rackbar.barKg` keeps
  storing the bare kg number, validated against the active set's Bars, so no migration.
- The RBAR-60 read-back rule covers this Bar unchanged: its lb Totals are never whole
  (44.09 lb plus 5 lb steps), and every one types back Exact in both units (oracle in
  `console.test.ts`).


## 2026-10-16 -- "the iron set is canonical" held for the Total only (RBAR-69)

The DP check above proved greedy reaches the greatest Total at or under the Target on
iron. It never checked the Plate count, and for count the iron ladder is not canonical
(a 60 lb Side is 35 + 25, greedy loaded 45 + 10 + 5). Decode no longer relies on
greedy at all; see the ADR-0003 amendment of this date.
