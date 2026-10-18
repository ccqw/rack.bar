# The Rest timer runs on timestamps, and its dock takes Bar pixels

RBAR-94 (2026-10-17). Caitlin asked for a rest timer between sets and picked the design
from two prototype rounds: direction B, a bottom dock, and the "Ring" timer screen with
the Big-numerals preset toggle (Linear RBAR-94 comments; prototype "Rest timer screen",
the Picked phones). This records the architectural calls the build made.

## Decision

1. **A pure state machine in `lib/rest.ts`.** A Rest is `idle`, `run` (an end time),
   `pause` (time left) or `done` (an end time in the past); the reading at any instant
   is `readRest(state, now)`: m:ss counting down, `+m:ss` overtime past zero, and the
   share of the Rest still to go for the ring. Presets 1:30 / 2:00 / 3:00 / 5:00 and
   -15 / +15 are transitions on it. The chosen length is remembered (`last`), and a
   restart, the stopwatch on an idle timer and Warm up's Next all start it again.
   - -15 past zero finishes the Rest now (overtime starts at +0:00, never in the past).
   - +15 past the Rest's length grows the ring's full sweep, so it never overfills.
   - A finished Rest ignores -15 / +15 (the screen disables them).
   - The time left is capped at an hour; an overtime older than 30 minutes clears, and
     so does a pause older than 30 minutes (a pause stores when it began), so a Rest
     paused and forgotten on a bench lets the screen sleep again.

2. **Time comes from timestamps, never from counting ticks.** Every transition takes
   `now`; a running Rest stores its end time. The shell uses `Date.now()` (epoch ms)
   rather than `performance.now()`, because the end time is persisted and
   `performance.now()` restarts at every page load. A throttled background tab, a locked
   phone or a reload loses nothing: the next tick reads the true time. The shell's
   250 ms interval is only the redraw cadence. Properties pin it: any number of ticks
   reads the same as none; a pause keeps the time left until it goes stale; a stored
   Rest reads back exactly. On load the shell drops a stored time this app could not
   have written (a clock set back, an edited key): a run ending more than an hour out,
   a finish or a pause in the future.

3. **The shell is three elements and a controller.** `RestClock`
   (`elements/restclock.ts`) holds the state and settings, persists them
   (`rackbar.rest`, `rackbar.restSettings`, ADR-0007), ticks, holds the screen wake lock
   (the RBAR-80 `ScreenWake`) while a Rest runs or is paused (not in overtime, and not
   past a stale pause), and raises the alert on the run -> done edge. `<rack-rest-dock>` and `<rack-rest-screen>` are dumb views over
   it; `<rack-rest>` composes them with the zero flash. `<rack-app>` mounts it outside
   the console.

4. **The console keeps two small hooks only** (RBAR-87 / RBAR-89 refactor it next): the
   stopwatch button in its head icon row (first, per the prototype), which says
   `resttimer`, and two CSS rules keyed on a `resting` host attribute the app sets (the
   lit stopwatch, the docked floor below). Warm up's Next says `warmupnext` (bubbling,
   composed); a stair tap does not, so only Next starts a Rest.

5. **The dock takes Bar pixels, not the column's content (amends ADR-0013).** The
   prototype drew the dock over spare space below the column, but the real column has
   none: in Warm up and By Plates the bar block already flexes to fill the screen, and
   Next sits on the viewport's bottom edge at every size. Overlaying would cover Next
   (and the palette). So while the dock shows, `<rack-app>` pads its own bottom by the
   dock's height (60px; 54px below `SHORT_SCREEN`), the column shrinks, and the bar
   block flexes -- ADR-0013's rule that a new block costs Bar pixels, not a scrollbar.
   The dock never covers any block of the column, and the page never scrolls.
   - That needs a lower floor while docked: `SLEEVE_DOCKED_MIN_PX` (40px) instead of
     `SLEEVE_MIN_PX` (84px). Measured (fit-check, worst case per state): Warm up's sleeve
     goes 135 -> 75px at 393x659, 102 -> 48px at 375x548, 99 -> 45px at 320x548; By
     Plates 162 -> 102px, 107 -> 53px, 104 -> 50px; By Weight keeps the full 178px at
     393x659 and 430x739 and drops to about 130px on the 548px-tall phones. The floor
     returns the moment the dock goes.
   - The small Bar is the cost. In Warm up on the 548px-tall phones the host is 45-48px,
     so a 450 mm bumper stands 37-40px (host minus `SLEEVE_PAD_PX`); at the 40px floor
     itself it would stand 32px. Their numerals still fit in the screenshots, and a disc
     too small for its numeral drops it (the existing `numeralFits` rule), keeping its
     color and size. The inner collar, a fixed 34px, is capped at the drawn bumper
     height so it never outgrows the biggest Plate. It is the cheapest lever:
     everything else in the column is a control or a number the lifter acts on.

6. **At zero**: the screen edge flashes yellow (four half-second pulses; held still under
   reduced motion), `navigator.vibrate` buzzes where it exists (Android; not iOS), and the
   dock turns yellow and counts the overtime. Its tap restarts the last Rest; its x
   clears it. The alert is for a zero the lifter could have watched: it fires only when
   the zero is noticed within a minute of it (`ALERT_GRACE_MS`; a minute still covers
   Android's once-a-minute background timer). A Rest that ended while the app was
   closed, or while the tab was in the background (iOS suspends its timers), shows its
   overtime with no flash, buzz or chime.

7. **The chime is opt-in.** "Chime at zero" (off by default) plays one two-note sine
   chime, about 0.6 s, once (`elements/chime.ts`). While it is on, Web Audio is unlocked
   by the first tap in the timer or on the stopwatch; turning it on (or the preview)
   unlocks it too, and a lifter who never turns it on never gets an AudioContext. The
   context is resumed from any state but running (iOS leaves it `interrupted` after the
   app goes to the background). Synthesis is untested; the clock takes a `Chime`, so
   tests pass a fake. "Start after Next" is on by default.

8. **Stacking.** The dock (z 40) sits under every sheet (keypad, Setup, Another way: 50)
   and the share card (60); the timer screen (75) sits over the fullscreen card (70); the
   zero flash (90) is over everything and lets taps through.

## Consequences

- `scripts/fit-check.js` walks the dock states at all four viewports (By Weight, By
  Plates, three Warm up rows, a finished dock, the timer screen running, finished and with
  its settings open). It fails the run if any visible block of the column runs under
  the dock's top (DOCK COVERS <block>), or if the screen clips: its content past its
  box, its controls past the viewport, or the ring outside its cell between the top bar
  and the presets (SCREEN CLIPS). The head row now holds three icons.
- iOS caveats, not detectable from the page: Safari cannot vibrate; sound plays only
  while the page is open and the silent switch can mute it; a Home Screen app may still
  dim despite the wake lock (WebKit bug 254545, see RBAR-80).
- If the small docked Bar on short phones reads badly at the rack, the options are a
  slimmer dock below `SHORT_SCREEN`, or folding the dock into Warm up's Next row. Either
  is a design pass, not a build call.
