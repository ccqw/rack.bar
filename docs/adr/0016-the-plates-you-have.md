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

## Amendment 2026-10-17: Pairs of Plates on Hand (RBAR-72 slice 2)

Caitlin chose direction H of the joint RBAR-66 / RBAR-72 design pass. It settles the
UI, scopes and persistence questions below; Warm up under caps stays with slice 3.

1. **One setting, no scopes.** For each size of each Plate set: All (the default),
   1-4 pairs, or None. No "today" / "this gym" split and nothing expires, so the
   `withLimits` min-of-two-scopes composition is not used by the shell. Limits are per
   Plate set: a Training limit never touches Competition.
2. **Persistence:** one key, `rackbar.platesOnHand`, a JSON object of Plate set key to
   (size face -> pairs), e.g. `{"comp":{"15":2,"0.5":0}}`. Limits, not a have-list:
   a missing size is All, so a size a future set adds starts available. Validated on
   read per ADR-0007 (`parsePlatesOnHand`, lib/platesonhand.ts): unparseable or
   non-object storage is All plates, and each bad entry (an unknown set or face, a
   count that is not a whole 0..4) is dropped on its own, its size reading as All.
   Writes are best-effort. `inventoryOnHand` builds the capped Inventory from that
   already-validated value; a bad face or count reaching it is a bug and throws
   (withLimits), never a silent All.
3. **UI lives only in Setup**, a section titled "Pairs of Plates on Hand" with an
   "All plates" reset at the title's right, one tile per size in its Plate color
   reading "all", "N pair(s)" or "none" (dimmed, struck), and a None / 1 / 2 / 3 / 4
   / All row for the tapped size. No explanatory copy in the section. The sheet fits
   without scrolling at every phone viewport, a size's row open included (Caitlin,
   2026-10-17): on a short phone (548px tall) it tightens its spacing, every tap
   target staying 44px or taller, and fit-check fails on any inner scroll. The sheet
   keeps `overflow-y: auto` only as a guard for viewports below the supported ones;
   the page never scrolls (ADR-0013). Opening a
   size's row scrolls it into view and focuses its current count; Escape or a second
   tap on the tile closes it and returns focus to the tile.
4. **Any change re-solves at once** everything that draws from the Inventory: a
   standing Decode Target re-decodes (a chosen round-up is dropped; the lifter re-opts
   in), and a Warm up Ramp re-plans. A hand-built By Plates Side is the lifter's and is
   kept.
5. **By Plates dims a none size and badges a limited one ("x1".."x4"); it never blocks
   a tap.** The lifter may be loading Plates the app does not know about; only the
   Sleeve refuses (ADR-0005, ADR-0012).
6. **Warm up, pass-through only:** the console hands the capped Inventory to
   `planEasyRamp`, which now builds its size list from the sizes on hand (a none size is
   no size) and caps each size at its pairs, so no Ramp row ever needs a Plate the
   lifter does not have. Whether add-only Ramps keep their shape under caps, and how a
   drifted row says so, is slice 3.
7. **Share links do not carry limits** (a recipient's gym is theirs). Opening a link
   solves on the recipient's own limits; when that differs from the linked Plates, the
   existing ADR-0014 carry shows the linked Plates.
8. **No limits-active indicator** on the main screen (RBAR-77).
9. **"Bar at capacity" stays a Sleeve fact** (ADR-0012). With limits, a short load can
   lack a round-up because the plates on hand ran out, not because the Sleeve is full.
   That reads plain "N short" (ADR-0003). The capacity pill and caption show only when
   the full set, solved to the same ceiling, has no round-up either.

## Amendment 2026-10-17: Warm up under Plate limits (RBAR-72 slice 3)

Caitlin's call: under Plate limits, keep the Ramp's loading rule (the station rule,
ADR-0015 as amended), widen the warm-up tolerance only as far as needed, and say so
on the row when a set drifts from its percentage. The Working set stays exact or under.

1. **The station rule is unchanged under limits.** `planEasyRamp` plans with the sizes
   on hand (a none size is no size) and never puts more of a size on a Side than its
   pairs on hand. The 2-per-size station cap and its raise for a heavy Working set both
   stay within the pairs on hand. There is no separate "limited" ranking. Taking a big
   Plate off stays a cost (2 per Plate), not a ban: Caitlin's own 100 kg load with no
   more 10s is 15 / 15+10 / 15+20, which takes a 10 off. With one pair of 10s the
   planner does NOT reproduce that load: it plans 15 / 25 / 25+10, which is one Plate
   lighter on the Ramp under the station cost. This is a deliberate miss, like the two
   in ADR-0015's table, and is pinned in `lib/moves.test.ts`. On her six Targets, "1 pair
   of 25s, no 2.5s" plans the same Ramps as the full set except where a 2.5 was: it
   becomes 2+1, 2+1.5 or 1.5+1.
2. **The band widens only as far as the Plates force it.** Band excess still ranks
   first, so a Warm-up set leaves RAMP_BAND (5% of the Working Total) only when no
   Total it can climb to sits inside. When nothing loads inside, the row takes the
   nearest Totals on either side, as before.
3. **A drifted row says so.** A Warm-up set whose Total sits more than RAMP_BAND of the
   Working Total from pct x Working Total carries `drift: true` (`drifted` in
   lib/plan.ts; `planRamp` and `planEasyRamp` both set it). That is the same as its real
   percentage reading more than 5 points off the step's. The bare-Bar and Working rows
   never drift. The threshold is RAMP_BAND alone, without the planner's one-grid-step
   floor, so a row that drifts because the plates on hand coarsen the grid (no change
   Plates: 5 kg per Side) is still labelled.

   **A Warm-up set on the bare rig never drifts** (review of PR #123). The Bar cannot be
   lighter, so a tilde there tells the lifter nothing. Labelling the floor made stairs
   with the same 20 kg read differently. On a full Comp set:
   - 27 kg read "~74%" next to "70%";
   - 22 kg read "~91%", "~91%", "90%";
   - any Working set at or under the Bar read "~100%" three times.

   Those stairs now keep their step names. They already show the floor through the Bar's
   height and `sameAsPrevious`. This is the default until Caitlin answers whether a tilde
   should ever show with no limits set. Removing the one bare-rig check in `drifted`
   reverses it. On the full sets, no Working Total of 40 kg or more drifts, in kg or lb.
4. **The label** is the stair's name. A drifted stair reads its real percentage with a
   tilde, "~83%", in place of "90%". The Next button named it the same way
   ("Next: ~83% - 50 kg") until RBAR-95, which made the button read just "Next" (see the
   amendment below). The status pill already reads the real percentage ("83% of 60 kg").
   Screen readers hear "90 percent planned, about 83 percent loaded". No other copy.
5. **The Working set** is the capped Decode as read, exact or under (ADR-0003). When the
   pairs on hand cannot reach the Target it reads "N kg short", from slice 2's
   `sleeveBinds` rule ("Bar at capacity" only when the Sleeve is full).

Tests:
- **Examples.** `lib/moves.test.ts` ("under Plate limits") and `lib/warmup.test.ts`
  cover a drifted row, the bare rig (Comp 22 / 27 / 30 kg, Training 60 lb), and the
  exact 5% edge. On the edge, Comp's 5 kg Bar at 8 kg puts its 70% set at 6 kg, which
  only `drifted`'s float tolerance keeps undrifted.
- **Properties.** The "under Plate limits" properties in `lib/properties.test.ts` run
  over named limit shapes (all none, only big Plates limited, only change Plates
  limited or none, one size none) plus a random mix. They check:
  - every row is buildable from the pairs on hand;
  - the Working row is the capped Decode;
  - `drift` holds exactly when a row's load, rebuilt from its Side, sits past the band
    off the bare rig;
  - the station rule's stacks and moves hold;
  - a row leaves the planner's band, and a drifted row leaves RAMP_BAND itself, only
    when forced;
  - the planner's cost equals `stationRampOracle`, which now honours `maxPerSide`, on
    small limited Inventories.
- **Not checked.** Limited full Comp sets take the pruned (beam) search. They get the
  structural checks above but are not compared with the oracle, which is the same as
  for unlimited full sets.
- **Shell.** `elements/onhand.properties.test.ts` drives Setup's tiles into Warm up in
  kg and lb. It checks each stair's name, its spoken label, and that the pill reads
  "short" exactly when the Working set is short. (It checked the Next label too, until
  RBAR-95 took the label off the button.)
- **Phone fit.** `scripts/fit-check.js` adds a drifted-stair state. It fits at all four
  viewports with no name clipped. This is a manual check, not CI.

## Amendment 2026-10-17: the Next button just says "Next" (RBAR-95)

Caitlin's phone check found the Warm up Next button carried too much text: the next
set's name ("Next: ~83% - 50 kg") and a "+X per side" / "same plates" line. The button
now reads "Next" and nothing else, and on the Working set it stays "Next", disabled (it
replaces "Working set loaded"). The tilde of decision 4 still shows on the stair, the
status pill still reads the real percentage, and the add caption beside "per side"
still says what to load. Screen readers hear the moves too: after a Next the
announcement reads the row's Total, its pill, and the spoken moves ("70 kilograms, 50% -
exact, add 25 kilograms per side"). `elements/warmup.test.ts` pins that announcement.

## Pending Caitlin's decision (not in this slice)

Resolved by the 2026-10-17 amendments above, Warm up under caps included (slice 3).

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
