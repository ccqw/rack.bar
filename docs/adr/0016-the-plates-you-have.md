# The plates you have: Plate limits on the Inventory

RBAR-72 ("Don't have it") began as "exclude one Plate size". Caitlin's input on
2026-10-17 widened it: "a lot of times it's not that I don't have a plate, it's that
I only have 2 of them, not 4+". The common case is a LIMITED COUNT of a size, not
zero. So the model is a finite Inventory in pairs from the start, and "don't have it"
is just a count of 0. The joint RBAR-66 / RBAR-72 design pass ("the plates you have")
proposes the UI. This record fixes the CORE part only. The UI, the scopes and
persistence wait on Caitlin's answers to that pass's open questions.

## Decision (core, RBAR-72 slice 1)

1. **Inventory entries carry a Plate limit** (amends ADR-0002). An entry is a Plate
   plus an optional `maxPerSide`: the pairs on hand, so the most of that size one
   Side can take (2 plates = 1 per Side; an odd plate is useless). Undefined or
   Infinity means unlimited, the v1 default. 0 means none. Any other value must be a
   whole count; anything else is a RangeError, like a bad Plate mass. The type is
   `InventoryEntry` in `lib/plates.ts`. A bare `Plate` is an unlimited entry, so every
   existing `readonly Plate[]` Inventory and caller is unchanged.

2. **`withLimits(inventory, limits)`** applies limits keyed by a size's face: its
   stamped label, else its kg ("25", "0.5", "45"). That is the key the design pass
   proposes for storage. A size with no key keeps its entry (the very same object).
   A limited size gets the TIGHTER of its current cap and the new one, so applying a
   "today" limit over a "this gym" Inventory can only narrow it, and the effective cap
   is the min of the two scopes, as designed. A face that is not in the Inventory, or
   a limit that is not a whole count, is a RangeError: the shell validates storage on
   read (ADR-0007) before calling.

3. **The exact search honours the caps.** `sideLoads`, `canonicalSide`,
   `sideAtOrUnder`, `sideAbove` and so `decode` / `decodeWithin` take entries. The
   walk counts the run of each size and skips it once the run reaches its cap. The
   bounds tighten to match: the fill bound, the Plate count, and the heaviest Side
   (now the lesser of the Sleeve bound and every pair on hand). A size limited to 0
   is dropped before the search, including from the grid (Eleiko with no change
   Plates steps by 5 kg per Side). The ranking is ADR-0003 as amended by RBAR-69,
   unchanged: Sleeve fit, then the greatest Total, then the fewest Plates, then
   heaviest-first. Caps only remove candidate stacks. No greedy fill anywhere.

4. **Unreachable Targets fall back per ADR-0003.** A Target the limits cannot make
   exactly gets the greatest loadable Total at or under it, plus the opt-in round-up
   when one exists. Past every pair on hand there is no round-up, just as past the
   Sleeve (ADR-0012). With every size limited to none, the result is the bare Bar.

5. **With no limits, nothing moves.** With every size unlimited, explicitly or by a
   cap too large to bind, the output is identical to the uncapped search. That was
   checked against main on every rig at every 0.25 kg from the bare rig to 450 kg
   above it (36,009 Targets), and is locked in `lib/properties.test.ts`.

## Checks

- `lib/fewest.oracle.ts` `cappedFewestOracle`: an independent bounded-knapsack DP
  (minimum Plate count per Side sum, the narrowest stack per count, and a size-by-size
  heaviest-first read-off). `lib/fewest.test.ts` sweeps every loadable Side sum on
  both sets with each size capped at 0, 1, 2 or 3 pairs, plus whole-set home-gym
  counts. The bounded oracle with no caps agrees with the RBAR-69 one.
- `lib/properties.test.ts`, "Plate limit properties": no cap is ever exceeded, a
  'none' size never appears, tightening caps never raises the at-or-under Total,
  all-unlimited is identical to the uncapped output, and the capped Decode equals the
  oracle's best.
- The runtime budget gains a capped run: under a millisecond per decode on average.

## Pending Caitlin's decision (not in this slice)

- **Scopes:** "today" (session) and "this gym" (saved), with the effective cap the min
  of the two (`withLimits` already composes that way). The lifetime of "today" is an
  open question (until the tab closes, 4 h idle, or midnight).
- **Persistence:** the proposed `rackbar.gymPlates` / `rackbar.todayPlates` keys.
  No storage key is added yet.
- **UI:** the entry point (tap the Bar, one sheet, or this-lift / this-gym), the
  pair counts offered (0..4 plus All), By Plates behaviour (dim and badge, never
  block), and how a limit is shown and restored.
- **Warm up under caps** (RBAR-65): `RampRig.inventory` takes `InventoryEntry`s, and
  `planRamp` reaches Side Loads only through `lib/sideloads.ts`, so each row respects
  the caps; an all-none Inventory gives bare-rig rows (property-locked). The guard for
  "nothing to load with" is `hasUsablePlates` (sideloads.ts), never `length > 0`,
  which an all-none Inventory passes. `planEasyRamp` (lib/moves.ts) still guards by
  length and so throws from `plateGridKg` on an all-none Inventory; it switches to
  `hasUsablePlates` with the RBAR-65 slice 4b rewrite. Whether add-only Ramps keep
  their shape under caps is open question 8.
- **Share links** (ADR-0014): the proposal is that links carry the load, not the
  lifter's limits. Not touched here.
