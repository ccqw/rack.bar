# Recent Targets persist shell-side, owned by the console

RBAR-20 adds a **Recent** row: the lifter's recent Targets as tappable chips in
By-Weight (Decode) mode, so a working weight is one tap away. The history is
deduped, most-recent-first, capped at 6, and persisted across reloads. Two
questions this ADR settles: **who owns the history**, and **how thin does this
slice ship** given the unit layer and the share card are not built yet.

## Decision: the console owns the recents, not the app shell

ADR-0007 made `<rack-app>` the config host and put persistence there, one
`rackbar.*` key per concern (the Bar, the Collar). Recents are *not* rig
configuration -- they are **Target history**, generated entirely from the Target
lifecycle that lives in `<rack-console>`: a Target is committed when the entry's
keypad closes, and re-applied when a chip is tapped. Routing every commit up to
`<rack-app>` and feeding the list back down would thread two events through two
shadow boundaries for state the console already holds. So `<rack-console>` owns
the `recents` array, persists it, and feeds the row.

This does not contradict ADR-0007's principle ("configuration persists shell-side,
never in the core") -- it extends it: *any* persisted lifter state is shell-side,
under its own `rackbar.*` key, owned by whichever shell element is that state's
home. For rig config that is `<rack-app>`; for Target history it is the console.
The core (`lib/recents.ts`) stays pure: dedupe, cap, and parse are value
transforms with no storage or DOM.

`<rack-recents>` is a controlled, stateless shell like `<rack-setup>` (ADR-0001):
one property down (`targets`), one event up (`recentapply`). The console pushes on
the entry's new `keypadclose` event (the deliberate commit -- distinct from
`target`, which fires on every keystroke, so mid-entry digits never enter the
history) and on a chip re-apply (which moves that Target back to the front).

## The shared persistence helper (RBAR-16 debt)

Recents is the third `rackbar.*` key (`rackbar.recents`, after `rackbar.barKg`
and `rackbar.collarKg`). The RBAR-16 audit flagged the duplicated best-effort
load/save boilerplate to extract once a third key landed. It lands here:
`elements/persist.ts` exposes `readPersisted` / `writePersisted` -- the single
place that touches `localStorage` and the single place the best-effort contract
(swallow a blocked/quota/private-mode failure, never throw into the caller) is
expressed. `<rack-app>` (Bar, Collar) and `<rack-console>` (recents) both use it;
validation and (de)serialization stay with each concern (`isOfferedBar`,
`parseRecents`).

## Scope: built thin, two AC clauses deferred to their owning slices

Two ticket acceptance criteria reference machinery that does not exist yet, so
they are deferred to the slices that build it -- the store is shaped so each is a
later addition, not a rewrite:

- **"Chips render in the current Primary unit (kg|lb)."** There is no Primary unit
  yet -- RBAR-14 was folded into RBAR-17 (Backlog). The history is stored
  canonically in kg (which the ticket mandates regardless), and the chips render
  in kg. Rendering in lb is then a pure view transform over the same kg store, and
  `<rack-recents>` is where it hooks when RBAR-17's unit layer lands.
- **"Pushed on share-card open."** The share card (RBAR-19) is not built. The push
  is exposed as the console's `rememberTarget` path (driven by `keypadclose` and
  `recentapply` today); RBAR-19 commits the shown Target through the same path when
  the card opens.

Overflow nudge gradients are CSS edge fades on the scroll viewport (a thin
affordance); scroll-position-aware fades are deferred polish, folded with the
RBAR-10 visual treatment.
