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
