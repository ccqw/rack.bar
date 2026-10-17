// The fullscreen rack card's frame (RBAR-18, handoff section 8) as pure numbers, so the
// card's CSS (elements/fullscreen.ts) and the share picture that reproduces it (RBAR-70,
// elements/shareimage.ts) read one source and cannot drift. All values are CSS px
// unless named otherwise.
//
// The card is a column: padding, then the head (wordmark, huge Total with a small unit
// suffix, the other-Unit line, the uppercase config caption), then a stage that fills the
// rest and centres the Bar. The Bar is the inline <rack-sleeve> at its standalone block
// height, laid out `rotWidth` wide, then rotated 90deg (shaft at the top, cap at the
// bottom) and blown up by BLOW_UP.

export const FULLSCREEN = {
  /** Overlay padding, prototype L314 (safe-area insets add to top and bottom on a device). */
  padTop: 60,
  padX: 24,
  padBottom: 36,
  /** Wordmark: Hanken 800, tracked -.025em. */
  wordmarkPx: 19,
  wordmarkTrackEm: -0.025,
  /** The huge Total: Hanken 800, line-height 1, tracked -.03em, clamp(40, 16vw, 58). */
  totalMarginTop: 12,
  totalMinPx: 40,
  totalVw: 16,
  totalMaxPx: 58,
  totalTrackEm: -0.03,
  /** The Total's unit suffix: 22px / 600, text-dim. */
  unitPx: 22,
  unitWeight: 600,
  /** The other-Unit line: Hanken 500. */
  secondaryMarginTop: 8,
  secondaryPx: 14,
  /** The config caption: mono 600, tracked .12em, uppercase. */
  captionMarginTop: 16,
  captionPx: 11,
  captionTrackEm: 0.12,
  /** The rotated Bar: laid out min(360px, 62vh) wide, then rotate(90deg) scale(1.5). */
  rotMaxPx: 360,
  rotVh: 62,
  blowUp: 1.5,
} as const;

/** The huge Total's font size at a viewport `vw` px wide: clamp(40px, 16vw, 58px). */
export function fullscreenTotalPx(vw: number): number {
  const f = FULLSCREEN;
  return Math.min(f.totalMaxPx, Math.max(f.totalMinPx, (f.totalVw / 100) * vw));
}

/** The rotated Bar's layout width at a viewport `vh` px tall: min(360px, 62vh). */
export function fullscreenRotWidth(vh: number): number {
  const f = FULLSCREEN;
  return Math.min(f.rotMaxPx, (f.rotVh / 100) * vh);
}
