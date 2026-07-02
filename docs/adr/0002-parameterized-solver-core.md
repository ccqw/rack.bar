# Parameterized solver core; defer the Bar and Inventory UI

The pure solver is shaped as `solve(target, bar, inventory)` from day one, even
though v1 hardcodes `bar = 20 kg` and `inventory = the unlimited standard Eleiko
set`. Bar weight and Inventory are first-class inputs in the core with sensible
defaults; only their editing UI is deferred.

This costs a little generality the v1 UI doesn't use, but it makes the parked
features (women's/technique Bars, finite home-gym Inventory, eventually pounds)
purely additive — new UI feeding existing parameters — instead of a core refactor.
A future reader seeing a fixed-20 kg interface over a fully parameterized core
should know the generality is deliberate, not accidental. The same principle
governs the whole project: model the real inputs in the core, defer the UI.

## 2026-06-16 -- naming: the Decode direction ships as `decode()`

This ADR sketched the core as `solve(target, bar, inventory)`. The two directions
later got first-class names in CONTEXT.md and the RBAR tickets: **Decode** (a Target
maps to a Side Load) and **Encode** (a tapped Side Load maps to its Total). So the
parameterized core lands as `decode(target, bar, inventory)` (RBAR-2 walking
skeleton, deepened in RBAR-6); Encode is a separate pair of Side Load transforms
(`addPlate`/`removePlate`, RBAR-7), not a second arg to `solve`. The decision this
ADR records -- a parameterized core with deferred Bar/Inventory UI -- is unchanged;
only the name `solve` is superseded by `decode` for the Decode direction.

## 2026-07-02 -- "unlimited" now means counts, not length (RBAR-31)

The unlimited Inventory contract narrowed: pair COUNTS stay unlimited, but the
solver now stops at the Bar's loadable sleeve length (`decode`/`addPlate` gained an
optional trailing `sleeveMm` parameter, default `SLEEVE_MM`). See ADR-0012.
