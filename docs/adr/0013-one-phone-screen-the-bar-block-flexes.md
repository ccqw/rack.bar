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
  head row + gap + `SLEEVE_MIN_PX` (84) at the bottom and head row + gap +
  `SLEEVE_BLOCK_PX` (204, the handoff's block) at the top.
- `<rack-sleeve>` fits its discs to its host's **height** as well as its width:
  `fit()` caps the px-per-mm scale so a 450 mm bumper stands `SLEEVE_PAD_PX` shorter
  than the host. A tall host never zooms past the handoff's 168px bumper. The ADR-0004
  proportions are unchanged; the whole row just scales down together.
- A short phone gets a shorter Bar picture, and a tall one gets the full handoff
  block. Spare height falls below the column. It does not go into a bigger Bar.
- Below a visible height of 600px (`SHORT_SCREEN`, elements/fit.ts; an iPhone SE in
  Safari is 375x548) each element tightens its **spacing only**: paddings, margins and
  gaps. Controls keep their size and 44px touch targets.

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
