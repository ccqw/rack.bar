// The sleeve's sizing rules (ADR-0004, ADR-0013) as a pure core (ADR-0001). Extracted
// from <rack-sleeve> by RBAR-70 so the shared loadout picture (lib/shareimage.ts) draws
// its discs by the SAME rules as the on-screen Bar rather than a second sizing system:
// one px-per-mm scale for the whole row, height from a Plate's diameter, width from its
// thickness, a floor under each disc so a thin change Plate keeps a sliver, and a
// proportional overflow guard when even the floored row is too wide.
//
// Every px value here is a CSS px at the sleeve's own size. A larger drawing (the
// 1080px share image) multiplies them by one zoom factor and passes the zoomed cap and
// floor in; see `barLayout`'s `zoom` in lib/shareimage.ts.
import type { Plate } from './plates.ts';

/** A competition bumper's diameter -- the tallest Plate on either set (ADR-0004). */
export const BUMPER_MM = 450;
/** The prototype's full-zoom bumper height, in px (MAX_SCALE = 168 / 450). */
export const TARGET_BUMPER_PX = 168;
/** px per mm at full zoom: a normal load renders here; only a huge one zooms out. */
export const MAX_SCALE = TARGET_BUMPER_PX / BUMPER_MM;

// Bar chrome (handoff section 3): the fixed-px furniture framing the discs -- a sleeve
// shaft + inner collar on the loaded end, an end collar + cap on the far end. It does not
// scale with the Plates, so the fit reserves its width. Heights are the handoff's.
export const SHAFT_PX = 52;
export const SHAFT_H_PX = 9;
export const COLLAR_INNER_PX = 11;
export const COLLAR_INNER_H_PX = 34;
export const COLLAR_END_PX = 8;
export const COLLAR_END_H_PX = 20;
export const CAP_PX = 13;
export const CAP_H_PX = 11;
/** The chrome's total width: shaft + both collars + cap. */
export const CHROME_PX = SHAFT_PX + COLLAR_INNER_PX + COLLAR_END_PX + CAP_PX;
/** Between adjacent discs (the first sits flush to the inner collar). */
export const DISC_GAP_PX = 1.5;
/** Between the last disc (or the empty box) and the end collar. */
export const END_GAP_PX = 3;
/** The floor under each disc's width, so a thin change Plate keeps a visible sliver. */
export const MIN_DISC_PX = 9;
/** The bare-Bar box: 34px wide, 120px tall at full zoom (prototype L104), 5px inset. */
export const EMPTY_W_PX = 34;
export const EMPTY_INSET_PX = 5;
export const EMPTY_MM = 120 / MAX_SCALE;

/** The px-per-mm scale and overflow-guard shrink that fit a row of discs (ADR-0004). */
export interface RowFit {
  /** px per mm for every disc in the row. */
  readonly scale: number;
  /** 1 normally; below 1 shrinks every disc (both axes) when even the floor overflows. */
  readonly shrink: number;
}

/** The row's total disc width at `scale`, each disc floored at `minDisc` px. */
export function rowWidthAt(
  plates: readonly Plate[],
  scale: number,
  minDisc: number = MIN_DISC_PX,
): number {
  return plates.reduce((px, p) => px + Math.max(p.widthMm * scale, minDisc), 0);
}

/**
 * Fit a row of discs into `availPx` of width (ADR-0004): the largest scale up to `cap`
 * whose floored row fits, found by a short binary search (the row width is monotonic in
 * the scale). The floor puts a hard minimum under the row that no scale can shrink, so a
 * wall of floored thin Plates can still overflow; the guard then shrinks every disc
 * proportionally. `availPx` is the width left for the discs alone (chrome and gaps
 * already taken off); `minDisc` is the floor in the same px as `availPx`.
 */
export function fitRow(
  plates: readonly Plate[],
  availPx: number,
  cap: number,
  minDisc: number = MIN_DISC_PX,
): RowFit {
  let scale: number;
  if (rowWidthAt(plates, cap, minDisc) <= availPx) {
    scale = cap;
  } else {
    let lo = 0;
    let hi = cap;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (rowWidthAt(plates, mid, minDisc) <= availPx) lo = mid;
      else hi = mid;
    }
    scale = lo;
  }
  // row > 0 keeps a bare Bar (empty row) on an absurdly narrow host from a 0/0 NaN;
  // Math.max keeps the shrink non-negative when the chrome alone overflows the host.
  const row = rowWidthAt(plates, scale, minDisc);
  const shrink = row > availPx && row > 0 ? Math.max(0, availPx) / row : 1;
  return { scale, shrink };
}

/**
 * The engraved numeral's size bucket, by the disc's rendered width (handoff section 3).
 * Widths are sleeve px; a zoomed drawing divides by its zoom first.
 */
export function numeralPx(discW: number): number {
  return discW >= 16 ? 11 : discW >= 11 ? 9 : 8;
}

/** Whether a disc can seat its rotated numeral without stacked or clipped digits. */
export function numeralFits(discW: number, discH: number, text: string): boolean {
  const px = numeralPx(discW);
  return discW >= px - 1 && discH >= text.length * px * 0.6 + 4;
}

/**
 * The visible disc numeral. An iron Plate carries its stamped lb `label` ("45", "2.5");
 * a kg Eleiko Plate derives it from its kg, dropping the leading zero on the sub-1
 * change Plates (0.5 -> .5) because lifters read "point five".
 */
export function plateLabel(plate: Plate): string {
  if (plate.label !== undefined) return plate.label;
  return plate.kg < 1 ? String(plate.kg).replace(/^0/, '') : String(plate.kg);
}
