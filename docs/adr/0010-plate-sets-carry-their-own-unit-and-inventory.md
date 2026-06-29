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
| Training    | plain iron, lb    | lb          | 45 lb                |

kg is therefore **no longer the sole canonical Unit** (ADR-0006 relaxed). Instead:

- The **solver core stays kilograms internally.** Every Plate carries its true
  **kg** mass, including the iron Plates (45 lb = 20.41166 kg). `decode`/`encode`
  run in kg exactly as before. "The Training solver runs natively in lb" means the
  iron masses are round-lb values, so the lb readouts come out exact -- not that a
  second solver exists. The Unit is a property of how a set is *shown and entered*,
  resolved at the shell boundary; the core never sees a Unit.
- The greedy loader is **unchanged**, and ADR-0003's at-or-under correctness still
  holds for the iron set: greedy heaviest-first equals the true greatest-achievable
  total at or under target was verified exhaustively for {45,35,25,10,5,2.5} lb
  across the whole reachable per-Side range (a regression test ships with this
  slice). The iron set is canonical, like Eleiko -- no search needed.

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
  derives the forced-vs-free Unit rule from it.

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
