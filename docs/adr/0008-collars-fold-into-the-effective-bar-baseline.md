# Collars fold into the effective Bar baseline

A Collar is an optional clamp on each Side -- None, or a Standard 2.5 kg
competition collar -- and a loaded collar counts toward the Total like the Bar
does (CONTEXT.md). So the Total is:

    Total = Bar + 2 x Collar + 2 x Side Load

RBAR-16 surfaces the Collars choice in the Setup sheet and has to make the
achievable grid and both directions (Decode and Encode) account for it. The
question this ADR settles: **how does the collar enter the model?**

## Decision: fold the collar into the effective Bar, not a new solver parameter

The collar is weight on the Bar *before any Plate* -- exactly what the Bar
parameter already is. So it folds into the **effective Bar baseline** the
parameterized core already takes (ADR-0002):

    effectiveBar = Bar + 2 x Collar

The solver loads from `effectiveBar` instead of the bare Bar, and **nothing else
changes**: `decode(target, bar, inventory)` and `encode(side, bar)` keep their
signatures, and the greedy loader is untouched -- it just fills against a
`(target - effectiveBar) / 2` per-Side remainder and floors at `effectiveBar`
(the bare rig: Bar plus collars, no Plates). The baseline is expressed as one
named helper in the core, `barWithCollars(barKg, collarKg)`, so the formula lives
in one place and is unit-testable as a collar concept rather than inlined
arithmetic.

## Why not an explicit `collarKg` solver parameter

The landed handoff engine (`docs/design-handoff/engine.js`) models the collar as
a separate argument: `total(side, barKg, collarKg)` and
`decode(target, barKg, collarKg, plates)`. Per the engine decision we import and
extend engine.js *reviewing for fit, not blind-copying* -- and the fit here is
that our Bar input is already a free parameter (engine.js's bars are a fixed
enum). Threading a third `collarKg` through `totalKg`/`decode`/`encode` would:

- add a parameter three signatures wide that is always `Bar + 2 x collar`
  arithmetic the shell can do once, and
- force inserting an argument mid-signature (engine.js puts `collarKg` between
  `barKg` and `plates`), which would reinterpret every existing
  `decode(target, bar, inventory)` call site and its tests.

Folding into the baseline gets the identical math (`Bar + 2 x Collar + 2 x Side
Load`) with zero core-signature churn and an unchanged greedy loader. The collar
math engine.js carries is therefore honored, just expressed through the bar
parameter ADR-0002 already provides.

## Configuration persists shell-side, default None (ADR-0007)

The chosen collar follows the same shape RBAR-15 set for the Bar (ADR-0007): the
Setup sheet emits one event up (`collarchange`) and reflects one property down
(`collarKg`); `<rack-app>` owns the value, persists it under its own
`localStorage["rackbar.collarKg"]` key, and feeds it to the console and the sheet.
It defaults to **None (0 kg)** and is validated on read and on the event against
the offered set (`COLLAR_OPTIONS` / `isOfferedCollar`), so a corrupt or legacy key
can never strand the lifter on a collar no tile matches. The core stays pure: the
collar reaches it only as part of the effective-Bar number.

This is the second `rackbar.*` config key (after `rackbar.barKg`), exactly the
per-concern, shell-side persistence ADR-0007 generalized.
