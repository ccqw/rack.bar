# Custom Bars are stored as their stamp, offered on every set

RBAR-76 (2026-10-17). Gyms have odd Bars: a 15 lb technique bar, a 25 kg squat bar, a
35 lb women's bar, a 7 kg aluminium trainer, a trap bar marked "60 lb". Setup only
offered each Plate set's fixed Bars (ADR-0010, RBAR-63). The lifter can now add their
own. This extends ADR-0010 ("a Plate set carries its own Bars") with a second source of
Bars that belongs to the lifter, not the set.

## Decision

1. **A custom Bar is its stamp.** The lifter types the weight as written on the Bar,
   with a kg | lb choice, because the gym chose the stamp, not the lifter. The app
   stores the stamp as typed -- `{ value, unit }` -- and derives the kg (`lbToKg` for
   lb, exact factor, ADR-0006). The label is the stamp ("35 lb"), never a conversion:
   35 lb is 15.87573295 kg, and a label rebuilt from kg would read "15.88 kg" or a
   rounded lb. `Bar` gains an optional `stamp` for this; a set's own Bars keep naming
   themselves by kg in their stamped Unit (RBAR-63). Core: `lib/custombars.ts`.

2. **Custom Bars show on every Plate set**, after the set's own Bars, in the order
   added. A Bar is a Bar; the set's Unit only names its Plates. A custom Bar that
   weighs exactly what one of the set's Bars weighs is not shown twice on that set --
   the built-in tile stands for it (a custom "45 lb" is hidden on Training, shown on
   Competition).

3. **Limits** (for Caitlin to confirm): a stamp is above 0 and at most **50 kg /
   110 lb**, at up to **2 decimals** (some Bars are stamped "15.9 kg"); at most **3**
   custom Bars. When the list is full the "+" tile is not offered. Adding a weight the
   active set already offers selects that Bar; adding a weight a custom Bar already has
   selects it; neither is stored twice.

4. **Persistence** (ADR-0007): the list lives in the app shell under
   `rackbar.customBars` as JSON `[{"value":35,"unit":"lb"}]`, validated on read. A
   missing or corrupt value means no custom Bars, never a crash; bad entries are dropped
   and the rest go through the same add rules (valid, distinct, capped). The chosen Bar
   stays `rackbar.barKg` (the bare kg); it now validates against the set's Bars plus the
   custom Bars, so no migration. A set switch still lands on the set's default Bar.

5. **Removal** reuses the RBAR-73 Recents gesture: a long-press (or right-click / the
   context-menu key) on a custom tile opens Remove, Delete on a focused tile removes at
   once, and an Undo tile holds the slot for 5 s. Built-in Bars cannot be removed. **If
   the chosen Bar is removed, the Bar falls back to the set's default**; Undo restores
   the Bar at its place and re-selects it if it was chosen.

6. **The "+" entry replaces the Bar row** with one row of the same height (weight field,
   kg | lb, Add, cancel); its range hint sits on the Bar label row. The Bar row scrolls
   sideways inside the sheet when the custom Bars overflow it. Nothing adds height, so
   the sheet fits as before (ADR-0013; `scripts/fit-check.js` now walks the Setup
   states too).

7. **Share links are unchanged** (ADR-0014). The `b` key carries only stamps the set
   offers, and `serializeLink` already returns null for a Bar the set does not offer,
   so a load on a custom Bar produces no link rather than a lossy one (a custom 20.4 kg
   Bar would otherwise round onto `45lb`). An additive custom-Bar key (e.g. `b=35lb`
   accepted when it parses as a valid stamp, applied transiently) is a follow-up.

## Consequences

- The solver core is untouched: a custom Bar reaches `decode`/`encode` only as its kg
  (ADR-0002), folded with the Collars into the baseline (ADR-0008). The Total on a
  custom Bar is its kg + 2 x Side Load + 2 x Collar, checked against the oracle in
  `lib/properties.test.ts` and through the real Setup entry in
  `elements/app.properties.test.ts`.
- The Warm up Ramp (ADR-0015) works unchanged; its bare-Bar row is the custom Bar.
- Sharing from a custom Bar has no link until the follow-up lands.
