# Warm-up sets round to the nearest loadable Total

RBAR-65 adds a warm-up planner: the lifter enters the Working set's Target and gets a
Ramp of Warm-up sets building to it (Caitlin's deadlift ramp: Bar x7, 50% x7, 70%,
90%, then the Working set). A percentage rarely lands on the plate grid, so each
Warm-up set has to be rounded onto a loadable Total. ADR-0003 says Decode never
overshoots; this record says why a Warm-up set may, and fixes the rest of the Ramp's
arithmetic. Decided with Caitlin on 2026-10-17 (the RBAR-65 "Open questions" Q1-Q7).

The core is `lib/plan.ts`: `planRamp(workingTarget, steps, rig, options)`, pure and
unit-free like Decode (ADR-0001, ADR-0010).

## Decision

1. **The Working set is Decode, unchanged.** Its Side and Total are the at-or-under
   solve of ADR-0003, as read in the active unit (`decodeWithin` with the
   `displayCeilingKg` ceiling, RBAR-60), on the effective Bar (ADR-0008) and within
   the Sleeve (ADR-0012). It never overshoots, and its round-up `over` is returned
   untouched so the shell can still offer it.

2. **Percentages are of the achieved Working Total** (Q1) -- Bar, Collars and Plates
   after that solve, not the typed Target. That is the standard convention (a
   percentage of the whole bar), and it keeps the 100% row reading exactly 100%, even
   when the Sleeve caps the Working set or a pound reading lands between grid points.

3. **A Warm-up set rounds to the NEAREST loadable Total, ties going down** (Q2). Its
   raw target is pct / 100 x the Working Total. The candidates are the greatest
   loadable Total at or under it and the least one above it -- the same exact search
   Decode uses (`sideAtOrUnder` / `sideAbove`, RBAR-69) -- and the closer wins; an
   exact tie (225 lb x 50% = 112.5 lb on the 5 lb iron grid) takes the lighter. The
   Side is the canonical stack for that Total: fewest Plates, then heaviest-first.

4. **The floor, the ceiling, and the monotone rule** (Q4). Every row is at or above
   the bare Bar; each Warm-up set is at or above the previous row (and at or above
   the Bar plus Collars when Collars are on), and at or under the Working Total. The
   nearest-Total rule (3) is applied inside that window. No row is ever dropped: a
   Warm-up that lands on the previous row's Total is kept and flagged
   `sameAsPrevious` (a 30 kg Working set's 50% is 15 kg, under the Bar, so it repeats
   the bare-Bar row). The lifter's reps still count as sets.

5. **Collars** (Q5, Caitlin). The bare-Bar row never carries Collars: its Total is the
   Bar alone. Every other row -- Warm-up sets and the Working set -- carries them
   exactly when the rig has them (Setup's Collar is not None), through the effective
   Bar of ADR-0008. There is no per-row toggle.

6. **Steps** (Q6). A template step is `{ kind: 'bar', reps? }` or
   `{ kind: 'pct', pct, reps? }`, `pct` in (0, 100], `reps` an optional positive
   integer. The bare Bar is a first-class step, not "0%". Bare-Bar steps lead the
   template. The Working set is not a step: it is the fixed, implicit last row at
   100%, with optional reps. `planRamp` throws a RangeError for a malformed template;
   the shell validates a persisted one at its boundary first (ADR-0007, slice 3).

7. **Units** (Q7). The arithmetic is kg-canonical on the active Plate set's Inventory
   and Bar; "nearest" is judged in kg. The shell judges what a Total *reads* (exact,
   short) the way the status pill does, from the displayed numbers.

## Why nearest, not at-or-under, for warm-ups

ADR-0003's never-overshoot rule exists because an unannounced heavier bar is a
dangerous surprise at the lifter's chosen weight. A warm-up is not that: it is a
rehearsal at a fraction of the Working set, the lifter did not type its Target, and
a kilogram over 70% is harmless. At-or-under would land a warm-up up to a whole grid
step light (a 5 lb step on iron), always in the same direction, and the real
percentages would drift under the template. Nearest keeps them honest. Ties go down
because, all else equal, ADR-0003's caution still applies.

## Scope note on ADR-0003

ADR-0003 governs Decode and the Working set and is unchanged. This record is a
carve-out for Warm-up sets only; an amendment note is added to ADR-0003.

## Consequences and what comes next

- Rows carry the nominal step (`kind`, `pct`, `reps`), the raw `targetKg`, the chosen
  `side`, whether it is `collars`-ed, the achieved `total`, its `realPct` of the
  Working Total, and `sameAsPrevious`. The nominal step and the loadout are separate
  fields so a later pass can swap a Warm-up's Side for a nearby one.
- Add-only / fewest-moves loading (RBAR-65 slice 4) is that later pass. It may move a
  Warm-up set off its nearest Total within a tolerance; when it lands it amends this
  record.
- Tests: example tests in `lib/plan.test.ts`; rule-wide properties in
  `lib/properties.test.ts` against `rampTotalsOracle` in `lib/properties.oracle.ts`,
  which brute-forces every achievable Total and never calls the planner.

## 2026-10-17 -- fewest Plate moves (RBAR-65 slice 4)

Caitlin wanted the Ramp easy to load before using it at the gym, so slice 4 lands
right after slice 1. Strict add-only (each Side a prefix of the next) was too strict.
What costs time at the rack is Plate moves: swapping off one outside Plate is fine,
but swapping a 10 for a 15 when adding a 5 would do is a pain, and stripping the Bar
to change an inside Plate is the worst. `lib/moves.ts` `planEasyRamp` (same
arguments as `planRamp`) re-picks the Ramp for the fewest weighted Plate moves.

1. **The stack model.** A Side is a stack, inside to outside, heaviest inside (the
   sideloads.ts order). Going from one set to the next takes off every Plate outside
   the longest common inside run, then puts on the rest of the new Side. Strict
   add-only is the case with nothing taken off. Each row carries its `moves`
   (`off`, outermost first; `on`, innermost first; and a weighted `cost`) so the UI
   can caption "+10 per Side" or "swap 2.5 -> 5".
2. **Change Plates are cheap.** A change Plate (at most `CHANGE_PLATE_MAX_KG` =
   2.5 kg: Competition 2.5 / 2 / 1.5 / 1 / 0.5 kg, iron 5 / 2.5 lb) goes on last and
   gets swapped bit by bit (Caitlin's bench and press habit). Each of its moves
   costs `CHANGE_PLATE_MOVE_COST` = 0.5; every other Plate costs 1.
3. **Tolerance.** A Warm-up set may sit within `RAMP_TOLERANCE` (2.5%) of the
   Working Total from its raw target. The tolerance is never less than one
   Plate-grid step, which is half the Total grid, so the 5 lb iron grid can always
   meet it. The floor, non-decreasing and ceiling rules above still hold. The
   nearest Total from decision 3 is always a candidate, so a row that the floor
   pushes out of tolerance (50% of a 30 kg Working set) keeps a legal answer.
4. **The Working set** (decided by default, flagged for Caitlin): its Total is
   exactly the at-or-under Total of decision 1, never over and never lighter, but
   its Side may be any equal-Total stack if that saves moves. For 140 kg that means
   25+15+10+10 after a 25+15+10+2.5 warm-up, instead of Decode's 25+25+10.
   `working` still returns Decode's own result, so the round-up offer is unchanged.
   If Caitlin prefers the Working set to always show Decode's canonical stack, the
   change is to give that row a single candidate.
5. **The search.** This is an exact dynamic programme over the rows. A candidate is
   one (Total, Side) pair: every Total within tolerance (plus the nearest Total),
   times each sideloads.ts stack for it with at most `EXTRA_PLATES` (2) Plates past
   the fewest. Candidates are ranked lexicographically by:
   - how far rows sit outside the tolerance;
   - then weighted moves from the bare Bar through the Working set;
   - then the summed distance from each percentage;
   - then the Plates loaded.

   Moves between a bare-Bar row and a collared row ignore the Collars, which is a
   constant cost. A typical Ramp solves in under 10 ms. A Sleeve-capped 7-step Ramp
   is the worst case, at about 80 ms. `EXTRA_PLATES` = 1 would be about 8x faster
   but loses the optimum on some Ramps.

Caitlin's 140 kg Ramp becomes 20 / 70 (25) / 100 (25+15) / 125 (25+15+10+2.5) /
140 (25+15+10+10): 5 weighted moves, with nothing taken off until the last set. The
nearest-Total Ramp takes 98 kg to 126 kg by stripping its 10 and change Plates.

Tests: `lib/moves.test.ts`, plus the "Fewest Plate moves" properties in
`lib/properties.test.ts`. They check against `easyRampOracle`, which brute-forces
every Ramp over every Side of small Inventories without calling sideloads.ts or the
planner.

## 2026-10-17 (later) -- Caitlin's station rule (RBAR-65 slice 4b)

This replaces the lexicographic fewest-moves rule above (decisions 1-5 of the earlier
2026-10-17 amendment: the heaviest-inside stack, half-cost change Plates, the 2.5%
tolerance and the moves-first ranking). That rule loaded a 75 kg Working set as
20+2.5+2.5+2.5. Caitlin wrote down how she really loads six Ramps by hand (Linear
RBAR-65, 2026-10-17 05:56), and this rule is fitted to them.

Her words: "I've gathered a few plates at my station that I thought would be
useful... I'll be willing to load on a large diameter plate that's heavier than the
innermost one as I go up in weight, but I wouldn't put a little plate on the inside
with a big plate outside it. I probably don't have more than 4 of most things. I'm
willing to be a little off and inexact in warmups but not in working weight. I'd
prefer to make fewer swaps and use fewer plates at my station than more, but it's not
to the point of messing up my ramp up completely."

`lib/moves.ts` `planEasyRamp` keeps its signature and row shapes.

1. **The stack.** A big Plate is full diameter (`BIG_PLATE_DIAMETER_MM` = 450:
   Eleiko 25-10 kg, the iron 45 lb). It is derived from the diameter, not a kg list.
   Big Plates go on in any order, so a heavier one may sit outside a lighter one.
   Every other Plate sits outside all the big ones, heaviest-first. A Side is
   therefore an ordered stack that is not always heaviest-first. The sleeve and the
   share text draw the order given and never re-sort it.
2. **The Plate limit.** At most `PLATES_PER_SIZE` (2) of each size per Side, her
   "4 of most things". This is the default until RBAR-72 brings a real Inventory.
   When 2 of each cannot load the Working Total (iron past about 535 lb, Competition
   past about 350 kg), each size may go up to the count Decode's own Side uses for
   that Total, and no further.
3. **The Working set** stays exactly Decode's at-or-under Total (ADR-0003). Its Side
   may be any legal stack.
4. **Warm-up sets.** Each one sits within `RAMP_BAND` (5%) of the Working Total of
   pct x Working Total. The band is never narrower than one Plate-grid step. Totals
   stay at or above the bare rig and at or under the Working Total, and never
   decrease. A row may repeat the row before (`sameAsPrevious`, the 30 kg case), but
   each repeat counts against the Ramp, so Totals rise strictly wherever the band
   allows. A row with nothing loadable in its band falls back to the nearest loadable
   Totals either side of it. These rank first, in this order: band excess, then
   repeated Totals.

   **Percentages must not fall.** `planRamp` throws a RangeError for a percentage
   step below the one before it. This replaces decision 4's "forced non-decreasing"
   handling of an out-of-order template. A falling template would force a lighter set
   to repeat a heavier one, and the band could not stay exact. The template editor
   (slice 3) saves percentages ascending. Equal percentages are allowed.
5. **The cost** is a weighted sum over the whole Ramp (`RAMP_COST`), minimised:
   - 1 per kg of Total from the percentage, x 1.5 when over;
   - 1 per Plate on each Warm-up set;
   - 2 per big Plate taken off;
   - 0.2 per Plate moved (on or off);
   - 0.2 per Plate at the **station**: for each size, the most of it the Ramp ever
     needs on one Side, summed.

   Ties go to fewer moves, then closeness, then fewer Plates. The Working set's own
   Plate count is not charged. Charging it (her simulation did not) breaks her 100 kg
   Ramp, since it pulls the 70% set to 25.
6. **The search.** It is a dynamic programme over rows. A state is (this row's Side,
   the station so far). A state is dropped only when another beats it for every
   possible future. The station term is not local, and this dominance test keeps the
   DP exact over its candidates. On a small Inventory, the candidates are every legal
   Side in every order, so the plan is exact. "Small" (`EXHAUSTIVE_LIMIT`) means at
   most 256 ordered Sides: every capped multiset, counted once per distinct order of
   its big Plates. A bumpers-only set has few multisets but many orders, so it takes
   the pruned path. On a full set, the candidates are pruned to:
   - the 30 multisets cheapest on their own;
   - each of those in all big-Plate orders, up to 6 orders;
   - every Side that keeps the previous row's stack, or its big Plates, and adds up
     to 2 Plates.

   Only the best 60 states go on to the next row.

   Timing on an M-series laptop, warm, DEFAULT_RAMP, every whole-kg Working Total from
   20 to 300 kg:

   | Set | Mean | Worst |
   |---|---|---|
   | Competition | about 2 ms | about 6 ms |
   | Training (iron) | under 0.5 ms | about 1 ms |

   Sleeve-capped Ramps up to 500 kg take about 4 ms. A cold first call takes about
   5 ms. The pruned search was checked against a search about 10x wider on 1124
   Ramps. It found the same cost on 1086 of them. The worst gap was 1.6 cost units,
   about one extra Plate move or kg.
7. **No Plates to load.** With an empty Inventory, or when planRamp loads nothing on
   any row, every row is planRamp's bare-rig row. In that case the planner never
   asks for a Plate grid.
8. **Degraded.** If beam pruning ever leaves a row with no state it can climb from,
   the planner does not throw and does not quietly repeat a row. It returns planRamp's
   own Ramp (nearest Totals, Decode's Working Side), which is always valid, and sets
   `degraded: true`. The property suite asserts that this never happens.
9. **What a caption says.** Each row's `moves` describes the Plate moves the cost
   charges:
   - `off`: everything outside the longest common inside run, outermost first;
   - `on`: the rest of the new Side, inside to outside.

   The Warm up captions (RBAR-65 slice 2) read `moves` directly, not a set difference
   of the two Sides. Following a caption literally, taking `off` from the outside and
   then putting `on` on, rebuilds the next Side exactly. On Caitlin's 75 kg Ramp,
   15+1 -> 15+5+2.5+1 is "off 1, then on 5, 2.5 and 1". A set difference would say
   "+5 +2.5", and following that literally gives the illegal stack 15+1+5+2.5.

Bumpers-only timing (Eleiko 25-10 kg, 20 kg Bar, warm, 20-420 kg): about 0.4 ms mean
and about 1 ms worst, including 350 kg.

Her loads against the planner (Competition, 20 kg Bar, per Side, 50 / 70 / 90%):

| Working | Hers | Planner |
|---|---|---|
| 60 | 5 / 10+1 / 10+5+2 | same |
| 75 | 5+2.5+1 / 15+1 / 15+5+2.5+1 | same |
| 80 | 10 / 10+5+2.5 / 10+15+1 | same |
| 100 | 15 / 15+10 / 15+10+10 | same |
| 120 | 20 / 20+10+2 / 20+20+2.5 | 20 / 20+10+2 / **20+10+15** |
| 140 | 25 / 25+15 / 25+15+15 | 25 / 25+15 / **25+15+10+2.5** |

That is 16 of 18 sets. The planner misses two. At 120 kg and 90%, it prefers 110 kg
(2 kg over, two small moves) to her 105 kg (3 kg under, with a 10 taken off). At
140 kg and 90%, it prefers 125 kg (1 kg under, four Plates) to her 130 kg (4 kg over,
three Plates). Both misses are
`it.todo` in `lib/moves.test.ts`.

Tests:
- `lib/moves.test.ts` has her table, the stack and cost examples, and the timing test.
- The "Station rule" properties in `lib/properties.test.ts` check the rule against
  `stationRampOracle`. That oracle enumerates every legal Side of a small Inventory by
  plain recursion and runs an unpruned DP over (Side, station) states. It never calls
  sideloads.ts or the planner.

## 2026-10-17 -- one Target for By Weight and Warm up (RBAR-87)

Caitlin, 2026-10-17: "If I'm on any of the other screens, like By Weight or By Plates,
and I set some weight and then I go to Warm up, it would be awesome if Warm up used
whatever weight I set in the other screens as the working target." Until now Warm up
kept its own working weight: a second `<rack-entry variant="working">`, the
`rackbar.working` key, and a rule that seeded it from the By Weight Target only on the
first open. All three are gone. The Working set's Target is the Target.

1. **One Target, kept across mode switches both ways.** The console holds one Target
   (canonical kg) and one `<rack-entry>`. In By Weight the entry is headless under the
   hero (RBAR-58); in Warm up the console flips it to `variant="working"`, the same
   "Working weight" row as before; in By Plates it is hidden. Editing the working
   weight in Warm up changes the Target By Weight shows, and the other way round.
   Entering By Weight from Warm up decodes the Target. It no longer carries the
   selected warm-up row, because that row is not the weight the lifter asked for. The
   By Weight round-up choice and the loaded way start over on that decode. A keypad
   left open across the switch stays open on the same Target.
2. **By Plates carries into Warm up as it does into By Weight (ADR-0005).** Leaving By
   Plates with a load built there, the Side stays on the Bar and its Total becomes the
   Target. A bare Bar means no Target. A visit that left the Side exactly as it found
   it built nothing, whatever mode it came from, so the Target is kept. Otherwise
   Warm up -> By Plates -> Warm up would quietly turn a 140 kg Target into the 70 kg
   row, and a By Weight peek would rewrite 141.3 as the 141 load. Back in By Weight
   after such a visit:
   - from By Weight, By Weight's own load stays on the Bar (the ADR-0005 carry, a
     chosen round-up included, with no live decode until the lifter acts), and the
     Target is still the typed one;
   - from Warm up, the Target is decoded.

   A set switch in Setup while in By Plates empties the Bar. That is a rig reset, not
   a built load: the visit is re-based on the empty Bar, the Target is kept, and By
   Weight decodes it on the new set. An opened By Plates link counts as built, even
   when its Plates match the Side the visit began with.

   Whether a round-up chosen in By Weight should become Warm up's working weight is
   open with Caitlin. As built, it does not, by either path.
3. **Persistence: `rackbar.target`.** The Target survives a reload under its own key.
   It is console-owned, like the Target display state (ADR-0009). It is stored at full
   precision (`String(kg)`), so a reload reads back the same number, and it is read
   through `parseTarget` (`lib/recents.ts`, ADR-0007). `parseTarget` accepts only a
   plain decimal (no sign, exponent or hex) up to `MAX_TARGET_KG`, the share link's
   1000 kg cap. A reload opens By Weight on the stored Target, decoded.
   - A non-positive Target (a typed 0), an emptied field, or a Target that
     `parseTarget` would not read back removes the key. By Weight still shows its own
     reading of a typed 0, but Warm up plans no Ramp from it, and a reload reads it
     back as no Target.
   - A failed write also removes the key, so a stale Target cannot come back on
     reload.
   - A Target typed finer than the readout (52.5 lb) reloads as its readout (53 lb).
     The kg, and so the load, is unchanged.
   - An opened share link's Target is the lifter's Target, like its Recents chip
     (ADR-0014 as amended). The link still writes no rig key.
4. **Migrating `rackbar.working`, once.** On connect, a valid legacy value becomes the
   Target only when no valid Target is stored, so an explicit Target always wins. The
   choice is the pure `restoreTarget` (`lib/recents.ts`): both keys go through the same
   `parseTarget` check (a positive plain decimal up to `MAX_TARGET_KG`), so a corrupt or
   out-of-range value in either (-5, 0, 1e9, "140abc") reads as no Target. The
   legacy key is then removed either way: valid, cleared (`''`) or corrupt. The
   migration runs once only if that removal succeeds. Storage that reads but cannot
   remove would offer the legacy value again on a later reload with no Target stored.
   That is accepted under best-effort persistence (ADR-0009): in practice storage
   fails as a whole.
5. **No "You asked" chip in Warm up.** RBAR-58's chip stays By Weight's. Warm up's
   working-weight row already shows the Target as typed.
6. **Recents are unchanged (ADR-0009).** A keypad commit of the Target pushes it in
   either mode, as the separate working-weight commit did. Warm-up rows, Next, Share
   and the unit toggle in Warm up never push.
7. **Share links are unchanged (RBAR-78, ADR-0014).** A Warm up share still opens in By
   Weight on the selected row's load.
8. **Fit (ADR-0013).** Nothing visible changed. The working-weight row keeps its
   styling and its slot. In By Weight the headless entry now sits in the
   column at that slot, out of flow (`position: absolute`), so it takes no flex slot
   and no gap. It took no room before either, outside the column, so removing the
   second entry frees no room. The fit check stores `rackbar.target` where it stored
   `rackbar.working`.
9. **One source.** Everything that means the Target reads the one Target: the share
   link's `t`, the Recents highlight, the status pill and the unit toggle. None of them
   re-derives it from the decode (`total - delta`). A live decode with no Target is a
   broken invariant and throws.

The Next button and its `warmupselect` event are untouched.

Tests: in `elements/warmup.properties.test.ts`, "the Target is identical across mode
switches and reloads" and "a By Plates load's Total becomes the Warm up working
weight". In `elements/warmup.test.ts`: the one-time migration; the By Plates rule (a
set switch, a By Weight peek, an opened link); `parseTarget` on stored hex, exponent
and over-cap values; and a failed write. `lib/recents.test.ts` covers `parseTarget`
itself.

## 2026-10-18 -- Warm up rounds a short Working set UP (RBAR-87, PR #132)

The owner's call on PR #132: when the working weight cannot be loaded exactly (in
the owner's words, "141 -> 142"; on the default Competition set, 140.3 kg loads 141),
the Working set rounds UP to the loadable Total, instead of holding Decode's
at-or-under load under the typed value. "Work" then shows what is really on
the Bar. This amends decision 1 ("The Working set is Decode, unchanged") and decision 3
of the station-rule amendment, for Warm up only.

**This is a Warm up rule, not a Decode change.** Decode, and so By Weight, still never
overshoots by default (ADR-0003, unchanged). The shared Target stays exactly what the
lifter typed: switching to By Weight decodes that typed Target at or under, with the
round-up offered as before.

1. **The rule.** `lib/plan.ts` `workingLoad(decoded, floorKg)`, a pure function of
   Decode's own result (`decodeWithin`, as read in the display unit). When Decode's
   at-or-under `primary` reads as the Target or above, it is the Working set, as before.
   When it reads short, the Working set is Decode's round-up `over`: the least loadable
   Total above the Target's reading. So the Working Total is loadable, at or above the
   Target, and no loadable Total lies between the Target and it.
2. **"Reads short" is judged on the display reading** (ADR-0010). `floorKg` is the
   bottom of the Target's reading, `displayFloorKg` in `lib/units.ts`, the mirror of
   `displayCeilingKg`. A load that reads as the Target is exact, even a hair under the
   typed kg: 146 lb on Competition is 66.22 kg, and 66 kg reads 146 lb, so it stays.
   Judged on the raw kg it would round up to 67 kg, which reads 148 lb. Callers that
   pass no floor (kg-only) use the Target itself.
3. **The fallback.** When nothing loads above the Target (the Sleeve is full, ADR-0012,
   or the pairs on hand ran out, ADR-0016), there is no round-up, and the Working set is
   the at-or-under load, short, as before. Its pill reads Decode's "N short" (or the
   capacity reading).
4. **The Ramp reads off the rounded-up Total.** The "Work" stair, its Total, the sleeve
   and readout, the "On the bar" line and the pill all show the Working row's Total.
   A rounded-up Working set is not exact, so its pill is the By Weight pill for that
   Total: "1 kg over". The percentages (decision 2: of the achieved Working Total) are of
   it, so the Warm-up sets ramp to what is really loaded. The station rule's Plate caps
   use the round-up's own Side where it uses Decode's.
5. **`Ramp.working` is still Decode's full result**, untouched, as By Weight would
   solve the Target. The shell reads the Working row, never `working.primary`, for what
   is on the Bar.
6. **Unit toggle.** The RBAR-60 carry in Warm up (an Exact Working set becomes the
   Target in the new unit) reads the Working row. A rounded-up Working set never reads
   Exact, so the toggle keeps the typed Target and re-plans on its new reading. That
   can step Work DOWN: 140.3 kg rounds up to 141 kg in kg, but the Target reads 309 lb
   and 140 kg also reads 309 lb, so in lb the at-or-under load is exact and Work is 140
   kg. This is the rule applied to the reading on screen, not a lost load, so it is
   accepted; the old "a load never moves down on a toggle" property now holds only for
   a Working set that was not rounded up (a rounded-up one is checked against the
   oracle on the new reading), and `elements/warmup.test.ts` pins the 140.3 kg case.

Worked example (Training iron, 45 lb Bar, typed 137 lb): By Weight decodes 135 lb, "2 lb
short", with 140 lb offered. Warm up's Working set is 140 lb, "3 lb over", and the
station-rule Ramp is 45 / 70 / 95 / 125 / 140 lb (50% of 140 = 70, 70% = 98 -> 95, 90%
= 126 -> 125). The field still reads 137, and By Weight still shows 135.

Tests:
- `lib/properties.test.ts`: "Warm up's Working Total rounds up to the least loadable
  Total at or above the Target (RBAR-87, ADR-0015 as amended)" checks, against the
  oracle's achievable Totals, that the Working Total is loadable, at or above the
  Target, with no loadable Total in between, and that it falls back to at or under when
  nothing is above. The existing Working-set properties now compare with
  `warmWorkingOracle` / `cappedWorkingOracle` (`lib/properties.oracle.ts`), which apply
  the same rule by brute force, and still check `working` is Decode's own solve.
- `elements/warmup.properties.test.ts`: "Warm up's Working set rounds up to the least
  loadable Total at or above the Target; By Weight still decodes the typed Target at or
  under", through the working-weight keypad, judged from the stair, the sleeve, the
  readout and the pill. `elements/onhand.properties.test.ts` checks the same under
  Plate limits against the bounded-knapsack oracle.
- Examples: `lib/plan.test.ts` (137 lb iron, the 146 lb floor, past the Sleeve),
  `lib/moves.test.ts` (75 kg with no change Plates loads 80; past every pair on hand
  stays at or under), `elements/warmup.test.ts` (140.3 kg reads "0.7 kg over" in Warm up
  and "0.3 kg short" in By Weight), `lib/units.test.ts` (`displayFloorKg`).
- Each new test fails with `workingLoad` returning the primary unconditionally.

