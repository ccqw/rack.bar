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
