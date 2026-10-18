# Saved maxes are app-owned, and a Target links to one

RBAR-84 lets a lifter enter a Target as a percentage of a saved max ("80% Squat"), the
most common gym request. Caitlin picked the design on 2026-10-17: direction **A, a lift
row** in the keypad, and for setting maxes variant 3, **one sheet, two doors**. This ADR
records where the maxes live, how a Target remembers the lift it came from, and what the
core owns.

## Decision

- **Core (`lib/maxes.ts`).** A max is `{ name, value, unit }`: the number and the Unit it
  was typed in. A max keeps that Unit (185 lb stays 185 lb, read as 83.9 kg), so switching
  the Primary unit never drifts it. The registry holds at most six lifts with distinct
  names (case-insensitive). `percentOfMax(max, pct)` is the Target: the share kept to two
  decimals in the max's own Unit, then converted exactly to kg. Percents above 0 and up to
  150 are taken; anything else makes no Target. Add, retype, remove and restore (Undo) are
  pure list transforms, and `parseMaxes` reads any stored value as a valid registry
  (ADR-0007 validate at the boundary).
- **Storage.** `rackbar.maxes`, one key per concern (ADR-0007), through the existing
  `readPersisted` / `writePersisted` helpers. RBAR-88's typed storage registry folds it in
  with the rest (`MAXES_KEY`, `loadMaxes`, `saveMaxes` in `elements/maxes.ts`).
- **Owner: `<rack-app>`.** Maxes are lifter state edited from Setup and from the keypad,
  and used by both Target entries, so the app owns, persists and feeds them, like the rig:
  one property down (`maxes`) to `<rack-setup>` (its Maxes row), `<rack-maxes>` (the
  sheet) and `<rack-console>` (which hands them to both `<rack-entry>`s).
- **One sheet, two doors.** `<rack-maxes>` is the only place maxes are edited. Setup's
  Maxes row opens its list; the keypad's "+" ("+ Add a lift" when there are none) and a
  long-press on a lift chip open its add or edit form directly. From the keypad, Save
  returns with that lift picked; Remove returns with an Undo chip in the lift's slot. The
  sheet emits intents (`maxadd`, `maxset`, `maxremove`, `maxrestore`) and the app applies
  them with the core. A pending Undo lasts until its sheet or keypad closes.
- **The link lives in the entry.** Picking a lift in the keypad makes the digits type a
  percent; a percent the keypad takes sets the Target and a link `{ name, pct }`. Any other
  edit (a typed weight, a stepper, a Recent, a mode switch) drops the link. A new max for
  the linked lift re-emits the same percent of it, so the Target follows a PR. Removing the
  linked lift keeps the Target's number and drops the link; Undo restores both. The
  console reads the link for its chip: a quiet solid "80% Squat" on an exact load, dashed
  "82.5% Squat = 115.5 kg" on a miss, in the "You asked" chip's slot (RBAR-58).
- **Decode is unchanged.** A percent Target is a Target: Decode lands at or under it
  (ADR-0003).

## Fit (ADR-0013)

The lift row adds 41px to the keypad sheet, which is fixed and fits every viewport. The
Setup sheet's Maxes row is the prototype's 40px (44px tap target) and gives way while a
size's None..All row is open, so Setup keeps zero inner scroll at 375x548. fit-check now
walks the keypad on a percent, the miss chip, the add form and the Maxes list.

## Not decided here

- Estimating a max from weight x reps (Epley) is parked until Caitlin says yes.
- Warm up's working-weight keypad has the same lift row, but the link is not shown in Warm
  up's readout and is not persisted: entering Warm up re-seeds the field from the saved
  Working set, which drops it.
