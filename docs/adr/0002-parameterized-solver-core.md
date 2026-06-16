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
