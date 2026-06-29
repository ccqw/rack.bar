# The share card is console-owned; the summary is a pure function

RBAR-19 adds a **share card**: a centered modal showing the current load as a
clean summary -- wordmark, big Total, secondary unit, the per-Side Plates as
wrapped colour chips (or a bare-bar state), a config caption -- plus a **Copy
summary** button that writes a short plain-text version to the clipboard, and a
Close button. Two questions this ADR settles: **who owns the card**, and **where
the summary text comes from**.

## Decision: the console owns the share card

The card shows the *current load* -- the Total, the per-Side Side Load, and the
display Unit. That is exactly the state `<rack-console>` already owns: the shared
Side Load (ADR-0005), the effective Bar baseline it threads (ADR-0008), and the
Target-display Unit (ADR-0010). The Bar and Collar are app-owned rig config
(ADR-0007), but the app already pushes them down to the console (`barKg`,
`collarKg`), so the console holds *every* value the card needs.

Mounting the card in `<rack-app>` (the header's natural home for a share icon)
would force the load snapshot back *up* through two shadow boundaries -- the same
cost ADR-0009 rejected for recents. So the console owns the card: it renders the
Share control, snapshots its own load, and feeds `<rack-share>`. This extends
ADR-0009's principle -- *state lives with whichever shell element is its home* --
to the load readout. A later slice (RBAR-18 fullscreen, RBAR-21 help) may add
header icons; that does not change where the *load* snapshot is built.

`<rack-share>` is a controlled, stateless shell like `<rack-setup>` /
`<rack-recents>` (ADR-0001): one property down (`load`, the snapshot), one event
up (`close`). It owns no calculator state.

## Decision: the plain-text summary is a pure core function

The ticket asks for tests on "the summary text content and the bare-bar case."
That belongs in the pure core (ADR-0001), not in a DOM element: `lib/summary.ts`
exposes `groupSide` (the heaviest-first Side Load folded into `N x face` colour
groups) and `loadingSummary` (the ~3-line plain text). Both the card's visible
chips and the clipboard text derive from the same tested function, so they can
never drift. Plate faces stay the Plate's own stamp (`label ?? kg`) -- kg on the
Eleiko set even when the Unit is lb, the same kg-face-under-an-lb-readout
convention the sleeve and palette already use; the Total and config lines carry
the Unit via `format`.

## Closes the RBAR-20 deferred seam

ADR-0009 parked "push-on-share-card-open" for this slice. The console remembers
the shown Target through its existing `rememberTarget` path when the card opens
in By-Weight (Decode) mode with a committed Target -- the third push site the
handoff names (keypad-close, chip-apply, share-open). By-Plates (Encode) has no
Target, so opening the card there pushes nothing.

## Scope: built thin

The Copy button confirms with a transient "Copied" only on a successful clipboard
write -- a failed or unavailable clipboard leaves the label unchanged rather than
claiming a copy that did not happen. The `cardIn` entrance animation and the
final colour/spacing treatment fold from the RBAR-10 handoff; the structure ships
thin here.
