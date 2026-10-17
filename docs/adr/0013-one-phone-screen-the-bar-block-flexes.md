# One phone screen: the bar block flexes

rack.bar is used one-handed between sets, so it has to fit the phone's **visible**
viewport with no vertical scroll -- Safari's toolbars take about 190px off an iPhone's
screen, so the budget is 393x659 on an iPhone 15/16, not the 393x852 screen. As of
RBAR-67 the page is a fixed-height column and the Bar picture is the part that gives.

## The rule

- `body` is exactly `100svh` (the small viewport, toolbars showing) and every level of
  the column -- `<rack-app>`, `main`, `<rack-console>`, `.stack` -- may shrink below its
  content (`min-height: 0`).
- In the console column, **only the bar block (`.viz`) flexes.** Every other block keeps
  its natural height (`flex: none`). The bar block takes the leftover height, clamped to
  label row + gap + `SLEEVE_MIN_PX` (84) at the bottom and `SLEEVE_BLOCK_PX` (204, the
  handoff's block, label row included) at the top (amended by RBAR-75, below).
- `<rack-sleeve>` fits its discs to its host's **height** as well as its width:
  `fit()` caps the px-per-mm scale so a 450 mm bumper stands `SLEEVE_PAD_PX` shorter
  than the host. A tall host never zooms past the handoff's 168px bumper. The ADR-0004
  proportions are unchanged; the whole row just scales down together.
- A short phone gets a shorter Bar picture, and a tall one gets the full handoff
  block. Spare height falls below the column. It does not go into a bigger Bar.
- Below a visible height of 600px (`SHORT_SCREEN`, elements/fit.ts; an iPhone SE in
  Safari is 375x548) each element tightens its **spacing only**: paddings, margins and
  gaps (for the mode toggle, the track's inset, not the segments). Controls keep their
  size and touch targets. The two head icon buttons are drawn at the handoff's 30px
  everywhere, with an invisible layer that makes each tap target 44px tall.

## Why

- **The sleeve is the robust lever.** Trimming gaps and paddings alone can't make a
  fixed 204px picture fit every phone. A flexing block absorbs the difference between
  phones and states, so a new row elsewhere costs Bar pixels, not a scrollbar.
- **The Bar is the one block that can shrink without losing information.** Every Plate
  keeps its proportions and color, and its numeral down to the smallest bucket.
  Shrinking the Total, the Target or the touch targets would lose legibility or
  reach.
- **The handoff frames were drawn at full phone height.** The 204px block and the
  spacing still hold wherever they fit (430x739 and up render at the handoff's size).
  Below that, the shrink is a deliberate divergence.

## Consequences

- The scroll budget is now a layout property that happy-dom can't see. The Vitest
  suite locks the CSS contract as text. `scripts/fit-check.js` (a Playwright snippet
  run against the dev server) measures the real `scrollHeight` against the viewport at
  393x659, 375x548, 430x739 and 320x548 in every default state.
- The Bar picture can change size when the column's other blocks change height: when
  the first Recent appears (one time) and, by a few pixels, between By Weight and
  By Plates. Within a mode, the round-up row and the loaded-chips slot keep their
  reserved heights (RBAR-47/52), so the picture doesn't move as a result comes and
  goes.
- A new block in the column must be budgeted against the 393x659 Must size. Run
  fit-check before shipping it.

## Amendment: the label row is inside the block, the icons overlap the sleeve (RBAR-75)

Decided by Caitlin on 2026-10-17 ("overlap = yes, try it; revert if we don't like it
on the phone"). The original rule put a 30px head row (label + icon buttons) ABOVE a
204px sleeve, so the full block was 244px. The handoff draws it differently (section 3,
"always visible, 204px tall block"; prototype L97-L101):

- **The 204px block holds everything.** The contextual label is in flow at the top of
  the block (5px down, one 15px line), and the sleeve sits 6px under it. The sleeve's
  own `SLEEVE_PAD_PX` adds the 4px that makes the prototype's 10px from the label to
  the discs. At full height the 450 mm bumper still renders at the handoff's 168px.
  Measured at 393 wide against the prototype, the label and the bumper land within
  0.7px of it.
- **The Share and fullscreen buttons are out of flow.** They sit absolutely at the
  block's top-right (`top: 0; right: 0; z-index: 2`), overlapping the top of the
  sleeve. They keep their 30px box, opaque raised fill and 44px-tall hit layer. When
  the sleeve is height-fitted, a bumper's top sits at least 4px below the sleeve's top,
  which is at most 0.5px above the drawn icon boxes. The icons' stacking order puts
  them over a tappable By-Plates disc. So every load stays legible and tappable on both
  plate sets, from a bare Bar to a full sleeve; on a full sleeve, a tap in the top few
  pixels of the outermost disc may reach the icon instead.
  `scripts/fit-check.js` hit-tests both icons in every state it walks.
- **The clamp is now** `5 + 15 + 6 + SLEEVE_MIN_PX` (110px) to `SLEEVE_BLOCK_PX`
  (204px). Dropping the 30px head row gives a short phone's Bar about 14px more. In By
  Weight the RBAR-75 Target label line (the prototype's 21px, up from 14.5px) takes
  back 6.5px.
- **The On the bar block is the handoff's fixed 60px** (prototype L180: `height:60px;
  margin-bottom:9px`, a centered column). That gives By Plates about 10px more for the
  Bar.

fit-check, worst case per state (sleeve height before -> after): at 393x659, By Weight
146 -> 153px and By Plates 138 -> 162px; at 375x548, 99 -> 107px and 87 -> 107px. Every
viewport still has `over 0`.

**Reverting.** RBAR-75 lands as one commit. Reverting it restores the head-row
geometry, the 14.5px Target line and the 67px On the bar block together.

## Amendment: the By Weight Target block goes (RBAR-58)

Caitlin's pick of option C, "split when different" (2026-10-17). The Total is By Weight's
one hero number and also the Target's editor: the steppers flank it, and a tap opens the
keypad on the Target. The Target splits off under it as a dashed "You asked" chip only
when the load misses it as read (ADR-0010); the chip quotes the Target exactly as typed
in the active unit ("You asked 142.3 lb"), while the pill reads the rounded miss (Caitlin,
2026-10-17). The bottom Target block (divider, label,
stepper row) is gone. The By Weight `<rack-entry>` is headless: it adds only its keypad
sheet and sits outside the column. In By Weight the status line under the hero reserves
the chip's 24px (it was 18px), and the hero carries a 6px underline box, so the chip
coming and going never moves the column. By Plates and Warm up keep the old metrics.

fit-check, worst case per state: By Weight now reaches the full 204px block (sleeve
178px) at all four viewports, in every state. Before, it was 153px at 393x659 and 107px
at 375x548. By Plates and Warm up are unchanged (By Plates 162px / 107px). Every viewport
still has `over 0`. At 320 wide, the status line closes up its gap and pill pads so the
longest miss ("You asked 1000 kg" beside "630 KG SHORT") stays inside the column.
fit-check now reports any overrun as LINE CLIPPED.
