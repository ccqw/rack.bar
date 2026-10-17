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

**Amended 2026-07-06 (RBAR-38):** the 2026-07-01 live-vs-handoff audit found this
diverged from the prototype, whose `openCard` pushes the achieved on-Bar TOTAL in
BOTH modes (`pushRecent(f, totalKgVal)`, prototype L947). `openShare` now pushes
`encode(side, baselineKg())` unconditionally -- what you are about to share is
what you loaded. Consequences: an Encode card open records the hand-built Total,
a Decode open records the achieved (possibly rounded-up) Total rather than the
typed Target, and a bare-Bar open records the bare rig Total, exactly as the
prototype does. Dedupe/cap are unchanged (same pure-core `pushRecent`).

## Scope: built thin

The Copy button confirms with a transient "Copied" only on a successful clipboard
write -- a failed or unavailable clipboard leaves the label unchanged rather than
claiming a copy that did not happen. The entrance animation (the `rack-card` and
`rack-fade` keyframes, the handoff's `cardIn`) and the final colour/spacing
treatment fold from the RBAR-10 handoff; the structure ships thin here.

## Amended 2026-10-16 (RBAR-64): the shared text is an emoji Plate list, sent by Web Share

The summary text (still one pure function, `loadingSummary` in `lib/summary.ts`)
becomes the "D. Plate list" format Caitlin picked. Below, `.` stands for the middle
dot, `x` for the multiplication sign, and `[...]` for an emoji:

    rack.bar . 142 kg . per side
    [red square] 25 x 2
    [green square] 10 x 1
    [green circle] 1 x 1
    [lock] collars 2.5 kg        <- only when Collars are fitted
    https://rack.bar

- **One line per Plate group**, heaviest first, built from `groupSide` (whose groups
  now carry their `emoji`), so the text and the card chips cannot drift. Faces are
  the Plate's stamp: kg on Eleiko even under an lb Total, lb on iron.
- **One map.** `plateEmoji` reads a single `PLATE_EMOJI` table keyed by Plate colour:
  a coloured square for a bumper, the same colour as a circle for a change Plate
  (under 5 kg; the 5 kg white stays a square). Iron has no colour, so it is a black
  large square (45 / 35 / 25 lb) or a black medium-small square (10 / 5 / 2.5 lb).
  The source stays ASCII: every glyph, the middot and the multiplication sign are
  `\u{...}` escapes named in a comment.
- **Bare Bar:** a single `Bare bar` line in place of the Plate lines.
- **Collars** get their own lock line after the Plates (collar mass in kg, as the
  config caption writes it).
- **The Bar and plate set are no longer named** in the shared text (the old config
  line is gone): the Total includes the Bar, and the lines say what to load. The
  card caption still names both.
- **Closing link** `https://rack.bar`, so a paste advertises the app and links in
  every chat app (a bare `rack.bar` may not autolink on a newer TLD).
- The card's visible chips are unchanged.

**Sending it.** Where the Web Share API exists (`navigator.share`), the card's
primary button reads **Share** and opens the native share sheet with the text (the
sheet has its own Copy action, so there is no second button). A cancelled sheet
(`AbortError`) does nothing; any other share failure falls back to the clipboard.
Without Web Share the button reads **Copy summary** and writes the clipboard. The
"Copied" confirmation still flips only on a successful clipboard write; a completed
share shows no confirmation (the sheet is its own feedback). Both APIs need a secure
context (https or localhost).
A tap while a sheet is still open is ignored, and a share failure that lands after
the card closed writes nothing to the clipboard.

## Amended 2026-10-16 (RBAR-70): Share attaches a picture of the loadout

Link previews can't show a loadout (GitHub Pages serves one static `og:image` for
every URL, and a per-loadout preview would need a backend, against ADR-0001), so the
Share button attaches the picture itself.

- **The picture.** A 1080x1080 PNG drawn on a canvas on the phone: the `rack.bar`
  wordmark, the Total in the display Unit with the other Unit under it, the whole Bar
  with both Sides loaded in the handoff colours, a `PER SIDE` label over the format-D
  Plate lines (`plateLines`, the same function `loadingSummary` uses, so the picture
  and the text cannot drift), and the config caption (`configText`) at the foot.
  Square because chat apps crop previews to squares. Considered: the fullscreen
  card's landscape shape (crops badly in a chat bubble).
- **Fixed light theme.** The ground and ink are the `--rack-page-*` "device wallpaper"
  tokens, so the picture reads the same in light and dark chats; discs get an ink
  hairline so the white Plates hold their edge. Considered: the app's dark surface
  (matches the app, but sits heavy in a light chat), or following the phone's theme
  (the recipient's theme is unknown to the sender).
- **Same sizing rules as the sleeve.** The sleeve's sizing (ADR-0004: one px-per-mm
  scale, diameter to height, thickness to width, the disc floor, the overflow guard,
  the chrome and numeral buckets) moved to `lib/sleevefit.ts`; `<rack-sleeve>` and the
  picture both read it. The picture's layout (`lib/shareimage.ts`) is pure and tested;
  `elements/shareimage.ts` only paints it, reading colours and fonts from the live
  `--rack-*` tokens and waiting for `document.fonts.ready` first.
- **Always attached, one button.** The picture and the format-D text go in one share
  (`navigator.share({ files, text })`), guarded by `navigator.canShare`. Considered:
  separate "Share text" / "Share image" actions (a second button would cost the
  RBAR-67 one-screen budget and a choice the lifter doesn't need to make).
- **Drawn on open, shared on tap.** The card draws the picture when it opens (and
  again if the load or plate set changes while open), so the tap calls `share()`
  synchronously, inside its user activation; Safari rejects a `share()` that waited on
  a canvas encode. A tap before the picture is ready shares the text alone rather than
  waiting.
- **Fallback chain.** Picture + text, then text alone, then the clipboard (the
  RBAR-64 behaviour). Text alone is used directly when there is no picture yet, no
  `canShare`, or `canShare` refuses the file. A cancelled sheet (`AbortError`) stops
  the chain silently at every step; a failure after the card closed goes no further.
  Without Web Share at all the button still reads "Copy summary" and no picture is
  drawn.
