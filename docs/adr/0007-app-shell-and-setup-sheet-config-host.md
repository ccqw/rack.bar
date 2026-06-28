# App shell composition root and the Setup sheet as config host

Until now the calculator (`<rack-console>`) mounted bare in `<main>`: it was the
whole app. Surfacing the Bar as a user choice (RBAR-15) needs somewhere above the
console to hold rig configuration -- the chosen Bar, and later collars (RBAR-16) and
the plate set (RBAR-17). Rather than grow the console into a God component (the
handoff explicitly warns against that), we stand up a thin shell.

`<rack-app>` is the composition root. It renders the header (wordmark + a **Setup**
pill), the `<rack-console>`, and the `<rack-setup>` sheet; it owns the configuration
state and feeds it down. The console stays focused on the calculator -- the single
shared Side Load and the Decode/Encode directions (ADR-0005) -- and gains one input,
a `barKg` property, that it threads into the already-parameterized core
(`decode`/`encode`, ADR-0002). Nothing in the core changes: the Bar was a solver
parameter from day one, and this is the UI ADR-0002 deferred.

## The Setup sheet is the config host

`<rack-setup>` is a bottom sheet (scrim + panel) opened from the header Setup pill
and dismissed via Done or a scrim tap. RBAR-15 fills only its **Bar** section --
three tiles (20 / 15 / 5 kg, each with its whole-pound equivalent as a subtitle).
Collars (RBAR-16) and the plate set (RBAR-17) are later sections in the same sheet;
they are blocked by this slice precisely because it builds their host.

The sheet is a controlled, near-stateless shell (ADR-0001): it holds no canonical
configuration of its own. It reflects the current `barKg` for active-tile styling and
emits a `barchange` event when a tile is tapped; `<rack-app>` owns the value, applies
it, and feeds it back. A later section behaves the same way -- one event up, one
property down -- so adding collars or the plate set does not change this contract.

## Configuration persists shell-side, one key per concern

The chosen Bar survives a reload via `localStorage["rackbar.barKg"]`, read on init and
written on every change. It defaults to 20 kg (`DEFAULT_BAR_KG`) when absent, unparseable,
or not one of the offered Bars -- the read is validated against the same `BAR_OPTIONS`
set the tiles render (the shell's `isOfferedBar`), so a corrupt or legacy key can never
strand the lifter on a Bar no tile matches. The chosen-Bar event path is validated the
same way. Persistence lives entirely in the shell (`<rack-app>`); the core stays pure
(ADR-0001), and the Bar reaches the core only as a function argument.

This generalizes the persistence pattern ADR-0006 sketched for the unit preference:
each independent piece of lifter configuration gets its own `rackbar.*` key, owned by
the shell. ADR-0006's "only persisted state in the app" was written before any config
UI existed; read it as the principle (config persistence is shell-side, never the
core), not a literal count -- `rackbar.barKg` is the first such key to actually ship,
and the unit preference and recents will join it as the matching slices land.
