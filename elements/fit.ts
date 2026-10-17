// The short-screen tier (RBAR-67). The column is spaced to the handoff (12px gaps, the
// prototype's paddings) and its bar block flexes to fit the rest -- enough for every
// phone down to the Must size, an iPhone 15/16 in Safari (393x659 visible). A shorter
// visible viewport (an iPhone SE in Safari shows 375x548) cannot hold the handoff's
// spacing AND a readable Bar, so below this height each element tightens its spacing --
// paddings, margins, gaps; never a control's size or a touch target -- in its own
// `@media ${SHORT_SCREEN}` block. One query string so the tier can't drift per element.
export const SHORT_SCREEN = '(max-height: 600px)';
