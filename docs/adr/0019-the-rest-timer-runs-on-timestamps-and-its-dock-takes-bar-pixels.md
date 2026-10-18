# The Rest timer runs on timestamps, and its dock takes Bar pixels

RBAR-94 (2026-10-17). Caitlin asked for a rest timer between sets and picked the design
from two prototype rounds: direction B, a bottom dock, and the "Ring" timer screen with
the Big-numerals preset toggle (Linear RBAR-94 comments; prototype "Rest timer screen",
the Picked phones). This records the architectural calls the build made.

**Amended after the first phone test (RBAR-94, 2026-10-18).** Caitlin picked dock
option B, the floating pill, from the dock prototype ("Rest timer dock", A / B / C at
393x659 and 320x548), with its shared done state. The changes: the bottom bar became
a floating pill with pause on it (section 5), the timer screen closes by a tap outside
the ring or a swipe down (section 3), zero is calmer (section 6), "Start after Next" is
off by default (section 4), and the chime asks iOS for a mixing audio session
(section 7).

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
   past a stale pause), and raises the alert on the run -> done edge.
   `<rack-rest-dock>` (the pill) and `<rack-rest-screen>` are dumb views over it;
   `<rack-rest>` composes them with the zero flash. `<rack-app>` mounts it outside the
   console. Which controls the pill shows is the pure `pillControls(phase, expanded)`,
   and the screen's touch rules are the pure `tapClosesScreen` (a tap outside the
   ring plus 4px of slop) and `swipeClosesScreen` (a drag down past 90px), all in
   `lib/rest.ts`. The screen closes on its chevron, Escape, a tap on its background
   outside the ring (not while the settings card is up: the card's scrim takes that
   tap), or a swipe down; a grabber at the top hints at the swipe. A short drag
   springs back, and the click that ends a drag is never read as a tap.

4. **The console keeps two small hooks only** (RBAR-87 / RBAR-89 refactor it next): the
   stopwatch button in its head icon row (first, per the prototype), which says
   `resttimer`, and two CSS rules keyed on a `resting` host attribute the app sets (the
   lit stopwatch, the docked floor below). Warm up's Next says `warmupnext` (bubbling,
   composed); a stair tap does not, so only Next starts a Rest. Next starts (or
   restarts) a Rest only when "Start after Next" is on, and it is **off by default**:
   on the phone a Rest that restarted itself at every Next surprised the lifter. The
   setting is stored as `startAfterNext`; the preview's old on-by-default `autoStart`
   key is ignored, so every phone starts with it off.

5. **The dock is a floating pill, and it takes Bar pixels, not the column's content
   (amends ADR-0013).** The pill (option B) floats centered 10px above the bottom edge,
   52px tall: the mini ring (the only progress indicator; the first build's top track
   bar is gone) and the time, a tap on which opens the timer screen; pause / resume
   right on the pill; and a dots button that slides out -15 / +15 (before pause) and
   the x (after it), turning into a chevron that folds them. The expansion is view
   state only and folds when the Rest ends or clears. On the 320px phone the open pill
   drops its mini ring to fit its five buttons.
   The prototype drew the dock over spare space below the column, but the real column
   has none: in Warm up and By Plates the bar block already flexes to fill the screen,
   and Next sits on the viewport's bottom edge at every size. Overlaying would cover
   Next (and the palette). So while the pill shows, `<rack-app>` pads its own bottom by
   the pill's reserve (`DOCK_PX` 66px: the pill, its 10px gap and 4px of air;
   `DOCK_SHORT_PX` 54px below `SHORT_SCREEN`: a 48px pill 6px off the edge, no air),
   the column shrinks, and the bar block flexes -- ADR-0013's rule that a new block
   costs Bar pixels, not a scrollbar. The pill never covers any block of the column,
   and the page never scrolls. The short reserve is 6px under the prototype's 60px:
   at 60px the fit-check measured Warm up on the Training set at 375x548 covering
   Next by 5px with the Bar already at its floor.
   - That needs a lower floor while docked: `SLEEVE_DOCKED_MIN_PX` (36px; 40px in the
     first build) instead of `SLEEVE_MIN_PX` (84px). Measured (fit-check, worst case per
     state): Warm up's sleeve goes 135 -> 69px at 393x659, 91 -> 37px at 375x548,
     99 -> 45px at 320x548, 178 -> 148px at 430x739; By Plates 162 -> 96px, 96 -> 42px,
     104 -> 50px, 178 -> 174px; By Weight keeps the full 178px at 393x659 and 430x739
     and drops to 122-130px on the 548px-tall phones. The floor returns the moment the
     pill goes.
   - The small Bar is the cost. In Warm up at 375x548 the host is 37px, so a 450 mm
     bumper stands about 29px (host minus `SLEEVE_PAD_PX`); at the 36px floor itself
     it would stand 28px. A disc too small for its numeral drops it (the existing
     `numeralFits` rule), keeping its color and size. The inner collar, a fixed 34px,
     is capped at the drawn bumper height so it never outgrows the biggest Plate. It is
     the cheapest lever: everything else in the column is a control or a number the
     lifter acts on.

6. **At zero, calmly**: a thin (3px) yellow line at the screen edge blinks three
   times and fades to nothing over 2.4 s (one 1.6 s fade under reduced motion). It
   rests at opacity 0: the base rule is 0 and both animations end at 0 and hold it
   (`forwards`), so a lingering class can never leave the edge lit (the first build's
   `.flash.on { opacity: 1 }` resting state could). `navigator.vibrate` buzzes where
   it exists (Android; not iOS). The pill stays grey: a yellow check, the overtime in
   grey ("+0:12"), a restart and the x. The timer screen goes quiet too: one thin
   closed ring around a check and the overtime, small and grey, and in place of
   -15 / pause / +15 a round restart and a round done (clear the Rest and close). The alert is for a zero the lifter could have watched: it fires only when
   the zero is noticed within a minute of it (`ALERT_GRACE_MS`; a minute still covers
   Android's once-a-minute background timer). A Rest that ended while the app was
   closed, or while the tab was in the background (iOS suspends its timers), shows its
   overtime with no flash, buzz or chime.

7. **The chime is opt-in, short, and mixes with music.** "Chime at zero" (off by
   default) plays one two-note sine chime, about 0.6 s, once (`elements/chime.ts`).
   - **Unlock in the gesture.** While it is on, every tap in the timer, on the
     stopwatch or on Next unlocks Web Audio: the AudioContext is created (once) and
     resumed inside the tap, and a one-sample silent buffer is started there too
     (older iOS counts a context as unlocked only once a sound has started from a
     gesture). Turning the chime on, and the preview, unlock it as well; a lifter who
     never turns it on never gets an AudioContext. The context is resumed from any
     state but running (iOS leaves it `interrupted` after a call or the background).
   - **The silent switch (the tradeoff).** On iOS a page's audio defaults to WebKit's
     "ambient" category: it mixes with other apps' audio, and the ringer / silent
     switch mutes it. That is why the chime and its preview were silent on the test
     iPhone (in silent mode). Safari 17+ has `navigator.audioSession`, but WebKit maps
     its types to iOS categories with no extra options: `transient` and `ambient` ->
     Ambient (mixes, obeys the switch), `transient-solo` -> SoloAmbient (pauses other
     audio, obeys the switch), `playback` -> Playback (plays through the switch, but
     is not mixable, so it **pauses the lifter's music** at every zero). No type both
     mixes and plays through the silent switch. We choose mixing: the chime sets
     `transient` (a short sound over other audio) where the API exists and the page
     has not chosen a type, and on a phone in silent mode it stays silent, like any
     notification ding; the flash (and vibration on Android) still mark zero. If
     sound in silent mode matters more than the music, the switch to `playback` is one
     constant (`CHIME_SESSION_TYPE`), at the cost of interrupting music. Everything is
     feature-detected; without the API nothing changes.
   - Synthesis is untested (happy-dom has no audio); the clock takes a `Chime`, so
     tests pass a fake.

8. **Stacking.** The pill (z 40) sits under every sheet (keypad, Setup, Another way: 50)
   and the share card (60); the timer screen (75) sits over the fullscreen card (70); the
   zero flash (90) is over everything and lets taps through.

## Consequences

- `scripts/fit-check.js` walks the pill states at all four viewports (By Weight, By
  Plates, three Warm up rows, the pill expanded, a finished pill, the timer screen
  running, finished and with its settings open). It fails the run if any visible block
  of the column runs under the pill's top (DOCK COVERS <block>), if the pill runs past
  its own box or the screen (DOCK COVERS pill-overflow-<n>px), or if the screen clips:
  its content past its box, its controls past the viewport, or the ring outside its
  cell between the top bar and the presets (SCREEN CLIPS). The head row now holds
  three icons.
- iOS caveats, not detectable from the page: Safari cannot vibrate; sound plays only
  while the page is open, and the silent switch mutes it (section 7); a zero reached
  while Safari is in the background cannot resume a suspended AudioContext without a
  tap, so it stays quiet (the late-zero rule already keeps it quiet); a Home Screen
  app may still dim despite the wake lock (WebKit bug 254545, see RBAR-80).
- If the small docked Bar on short phones reads badly at the rack, the options are a
  slimmer pill below `SHORT_SCREEN`, or folding the pill into Warm up's Next row.
  Either is a design pass, not a build call.
