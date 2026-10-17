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
   When 2 of each cannot load the Working Total (iron past about 535 lb), the cap
   rises only as far as that Total needs.
3. **The Working set** stays exactly Decode's at-or-under Total (ADR-0003). Its Side
   may be any legal stack.
4. **Warm-up sets.** Each one sits within `RAMP_BAND` (5%) of the Working Total of
   pct x Working Total. The band is never narrower than one Plate-grid step. Totals
   stay at or above the bare rig, rise strictly, and stay under the Working Total. A
   row with nothing loadable in its band falls back to the nearest loadable Totals
   either side of it. When nothing can climb, it repeats the row before
   (`sameAsPrevious`, the 30 kg case). These rank first, in this order: band excess,
   then repeated Totals.
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
   DP exact over its candidates. On a small Inventory (`EXHAUSTIVE_LIMIT`, at most 256
   capped multisets), the candidates are every legal Side in every order, so the plan
   is exact. On a full set, the candidates are pruned to:
   - the 30 multisets cheapest on their own;
   - each of those in all big-Plate orders, up to 6 orders;
   - every Side that keeps the previous row's stack, or its big Plates, and adds up
     to 2 Plates.

   Only the best 60 states go on to the next row.

   Timing on an M-series laptop, warm, DEFAULT_RAMP, every whole-kg Working Total from
   20 to 300 kg:

   | Set | Mean | Worst |
   |---|---|---|
   | Competition | about 3 ms | about 10 ms |
   | Training (iron) | under 0.5 ms | under 2 ms |

   A cold first call is about 12 ms. The pruned search found the same cost as a 10x
   wider search on 1106 of 1124 Ramps. The worst gap was 1.15 cost units, at 295 kg.
7. **No Plates to load.** With an empty Inventory, or when planRamp loads nothing on
   any row, every row is planRamp's bare-rig row. In that case the planner never
   asks for a Plate grid.

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
