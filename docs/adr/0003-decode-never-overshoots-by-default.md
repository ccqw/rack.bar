# Decode never overshoots the Target by default

When a Target is not exactly achievable, Decode's primary suggestion is always the
nearest achievable Total **at or under** the Target — never a heavier bar than the
lifter typed. When a closer Total exists *above* the Target, it is offered as an
explicit opt-in alternative, never auto-selected.

The naive rule is "snap to the genuinely nearest Total," but for a lifting tool an
unannounced heavier bar is the dangerous surprise, so we bias downward on purpose
and make any overshoot a deliberate choice. This asymmetry (closest-below by
default, closest-above on request) is non-obvious from the code alone, hence this
record. Among loadouts reaching the same Total, the canonical pick is the fewest
plates, loaded biggest-first.

## 2026-06-17 -- decode()'s result shape (RBAR-6)

The walking skeleton (RBAR-2) returned `Plate[] | null` -- the exact Side Load, or
`null` when the Target was off-grid or below the Bar. RBAR-6 deepens Decode into the
real at-or-under direction, so the return widens to a result object:

    Loadout  = { side: Plate[]; total: number; delta: number }
    Decoded  = { primary: Loadout }

`decode()` now **never returns null**: every Target resolves to a `primary` Loadout
(the greatest achievable Total at or under the Target, fewest Plates biggest-first).
`delta` is `total - target`: `0` when exact, negative when the achievable grid lands
a few kg short. `primary` is named (not the bare Loadout) on purpose -- RBAR-11 adds
the opt-in over-target `alternative` alongside it without changing this contract.

**The Bar is the floor.** The never-overshoot invariant (`total <= target`) holds for
every Target at or above the bare Bar. A Target *below* the Bar (e.g. 10 on a 20 kg
Bar) can't go under the Bar's own weight, so it resolves to the empty Side Load at
`total = bar`, and `delta` is positive there -- the one case delta exceeds 0, telling
the lifter their Target is lighter than the unloaded Bar.

**Grid note.** The achievable Total grid is whole kilograms (smallest Plate 0.5 kg x
2 Sides = 1 kg), so integer Targets on the default set are exact; only fractional
Targets (e.g. 100.5, 142.5) round down to the nearest achievable Total with a
negative delta. (The RBAR-6 ticket's "101, 102 -> 100" example predated this and
assumed a 5 kg grid; corrected here to match the real Inventory.)

## 2026-06-17 -- the over-target `alternative` (RBAR-11)

RBAR-11 adds the opt-in over-target option this ADR promised. The result shape widens:

    Decoded = { primary: Loadout; over?: Loadout }

`over` is the **least achievable Total strictly above the Target** -- one grid step up
from `primary` -- as the fewest Plates biggest-first. Its `delta` is positive (the
overshoot). It is never auto-selected: the console offers it as an explicit choice
beside `primary`, so the never-overshoot default is preserved.

**When `over` is present (decided RBAR-11).** Whenever `primary` lands *strictly under*
the Target (`primary.delta < 0`) and the Inventory can build a higher Total. This is
the "always offer the round-up when the Target isn't exactly achievable" rule, chosen
over the narrower "only when the over option is numerically closer than `primary`"
reading of this ADR's opening prose. Rationale: `over` is a deliberate opt-in, not an
auto-pick, so the lifter should always have the round-up available when their Target is
off-grid -- not only on the half of off-grid Targets where the overshoot happens to be
the smaller miss. `over` is therefore **absent** exactly when there is nothing to offer:
an exactly-achievable Target (`delta == 0`), a sub-Bar Target (`primary` already sits
above the Target at the bare Bar, `delta > 0`), and -- by the guard's actual test, a
non-empty Inventory -- an *empty* Inventory (no denomination to step up by). For the
unlimited v1 set a non-empty Inventory can always exceed the Target, so `over` appears
for every off-grid Target. A finite Inventory that is non-empty yet still cannot exceed
the Target is not specially handled here (a finite-Inventory concern deferred past v1).

## 2026-07-01 -- the sleeve caps "achievable" (RBAR-31)

"Greatest achievable Total" now means buildable from the Inventory AND physically
fitting the sleeve; the never-overshoot invariant is unchanged. `over` is present
only when a PHYSICAL round-up exists: the over step is re-filled under the same
sleeve cap and included only if it still lands strictly above the Target -- so a
sleeve-full shortfall carries no `over`, in the core rather than hidden by the view
(which is how RBAR-28 handled it over the uncapped core). So the RBAR-11 "always
offer the round-up when under" rule reads: always offer it when one physically
exists. See ADR-0012.
