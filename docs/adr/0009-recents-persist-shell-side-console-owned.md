# Recent Targets persist shell-side, owned by the console

RBAR-20 adds a **Recent** row: the lifter's recent Targets as tappable chips in
By-Weight (Decode) mode, so a recent Target is one tap away. The history is
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

## 2026-10-17 -- removing a Recent: a second event up, Undo in the chip's slot (RBAR-73)

Opening a shared link (RBAR-50) will add its Target to Recents, so a lifter needs to
remove a chip they don't want. An x on every chip would eat the rail's width, so the
removal is a long-press. Ownership does not change: the console still owns the list.

- **Core.** `lib/recents.ts` gains `removeRecent(list, target)` (drop that Target at
  stored precision, keep the rest in order) and `restoreRecent(list, target, index)`
  (its inverse for Undo: put it back at its old slot, clamped; never duplicate, never
  admit a non-loadable Target, still capped). Both are pure, like `pushRecent`.
- **Shell contract.** `<rack-recents>` keeps one property down (`targets`) and now
  has three events up: `recentapply` (as before), `recentremove` and `recentrestore`,
  each `{ target, index }`. The console applies them with the core and persists to
  `rackbar.recents` straight away, so a removal survives a reload even if the Undo is
  never used.
- **Gesture.** A still press of 500 ms (8 px slop on either axis) opens a one-item
  "Remove" popover over the chip. Moving past the slop, a `pointercancel` (the browser
  took the touch as a pan) or the rail scrolling drops the hold, so scrolling never
  removes. A short tap still loads the Target. The non-gesture routes are
  `contextmenu` (the context-menu key, Shift+F10, right-click) for the same popover,
  and Delete/Backspace on a focused chip, which removes it at once. Each chip carries
  an `aria-describedby` hint and `aria-keyshortcuts="Delete"`.
- **Undo.** A removal turns that chip's slot into its own Undo chip inside the rail.
  The Undo is locked to the removed chip's width, so it adds no row (ADR-0013) and no
  neighbour shifts. Several Undos can be pending at once. While any are pending, the
  rail is frozen into slots, and each slot's list index is the number of live slots
  before it. That is the index `recentremove` and `recentrestore` carry. Tapping an
  Undo restores that Target to its own slot. One shared timer of 5 s restarts on every
  removal. When it lapses, all the pending slots collapse together (width and opacity,
  200 ms ease-out; with reduced motion they disappear at once). That collapse is the
  only time chips move, and it comes after the lifter has stopped. A new history from
  anywhere else (a fresh commit or a chip re-apply) makes the pending removals final
  with the same collapse. The frozen slots are the only state the row keeps for
  itself, and they are UI state, not history. The console keeps the row visible while
  any Undo is pending, even when the list is empty.

  *Revised the same day, after Caitlin's phone check:* the first cut kept one Undo at
  a time, and each new removal collapsed the previous slot. During a quick cleanup of
  several chips, that moved the rail under her finger.

## 2026-10-17 -- `isOfferedBar` is gone (RBAR-86)

The Bar's validation above now lives in `<rack-app>`'s `offeredBars()` over the active
set's `offeredBarKgs` (ADR-0010; see the ADR-0007 note). `isOfferedBar` was removed as
unreferenced. The split this ADR records is unchanged.
