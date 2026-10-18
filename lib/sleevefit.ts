// The sleeve's sizing rules (ADR-0004, ADR-0013) as a pure core (ADR-0001). Extracted
// from <rack-sleeve> by RBAR-70 so the shared loadout picture (lib/shareimage.ts) draws
// its discs by the SAME rules as the on-screen Bar rather than a second sizing system:
// one px-per-mm scale for the whole row, height from a Plate's diameter, width from its
// thickness, a floor under each disc so a thin change Plate keeps a sliver, and a
// proportional overflow guard when even the floored row is too wide.
//
// Every px value here is a CSS px at the sleeve's own size. The share picture draws
// `sleeveLayout` in those px and lets the canvas transform rotate, blow up and scale it
// to device pixels, exactly as the fullscreen card's CSS transform does.
import type { Plate } from './plates.ts';

/** A competition bumper's diameter -- the tallest Plate on either set (ADR-0004). */
export const BUMPER_MM = 450;
/** The prototype's full-zoom bumper height, in px (MAX_SCALE = 168 / 450). */
export const TARGET_BUMPER_PX = 168;
/** px per mm at full zoom: a normal load renders here; only a huge one zooms out. */
export const MAX_SCALE = TARGET_BUMPER_PX / BUMPER_MM;

// Bar chrome (handoff section 3, end redrawn by RBAR-96): the fixed-px furniture framing
// the discs -- a sleeve shaft + inner collar on the loaded end, then a bare sleeve stub to a
// plain rounded end past the outer disc. No end collar and no cap: nothing after the plates
// looks like a stopper. It does not scale with the Plates, so the fit reserves its width.
export const SHAFT_PX = 52;
export const SHAFT_H_PX = 9;
export const COLLAR_INNER_PX = 11;
export const COLLAR_INNER_H_PX = 34;
/** The bare sleeve stub past the outer disc (prototype `.bare`): 30 x 11, a rounded end. */
export const BARE_END_PX = 30;
export const BARE_END_H_PX = 11;
/** The chrome's total width: shaft + inner collar + the bare end. */
export const CHROME_PX = SHAFT_PX + COLLAR_INNER_PX + BARE_END_PX;
/** Between adjacent discs (the first sits flush to the inner collar). */
export const DISC_GAP_PX = 1.5;
// The Collar clamped on the outer disc when Setup's collars are on (RBAR-96, prototype
// `.ccol2`, "look 2 flat"): 20px wide, 1px off the outer disc, 92 mm tall on the disc
// scale, with an 8x8 flat latch standing 8px above it, 5px in from its inner edge.
export const COLLAR_PX = 20;
export const COLLAR_GAP_PX = 1;
export const COLLAR_MM = 92;
export const LATCH_PX = 8;
export const LATCH_LEFT_PX = 5;
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

// The visualizer block's heights (RBAR-67, ADR-0013). SLEEVE_BLOCK_PX is the handoff's
// fixed 204px block -- the standalone default (the fullscreen card); the console flexes
// the sleeve between SLEEVE_MIN_PX and it. SLEEVE_PAD_PX is the breathing room the fit
// keeps between a bumper and the host's top and bottom edges.
export const SLEEVE_BLOCK_PX = 204;
export const SLEEVE_MIN_PX = 84;
export const SLEEVE_PAD_PX = 8;

/**
 * The disc numeral's ink and engrave (handoff section 3): dark ink with a light lip on
 * the light Plates (white, yellow), light ink with a dark seat on the rest. One source
 * for the sleeve's CSS and the share picture's canvas (RBAR-70).
 */
export const DISC_INK = {
  dark: '#0d0e10', // the accent ink (prototype plateInk L416; RBAR-74)
  darkEngrave: '0 1px 0 rgba(255,255,255,.3)',
  light: '#fff',
  lightEngrave: '0 1px 1px rgba(0,0,0,.4)',
} as const;

/** Whether a Plate colour takes the dark numeral ink (the light Plates). */
export function darkInk(color: Plate['color']): boolean {
  return color === 'white' || color === 'yellow';
}

/**
 * The sleeve's fit for a host of `hostW` x `hostH` px (ADR-0004, ADR-0013): the zoom cap
 * is MAX_SCALE, lowered so a bumper stands SLEEVE_PAD_PX shorter than the host (an
 * unmeasured height, 0, leaves it at MAX_SCALE); the discs get the width left after the
 * chrome, the drawn Collar (if any) and the gaps between discs. `<rack-sleeve>` and the
 * share picture both fit through this.
 */
export function sleeveFit(
  plates: readonly Plate[],
  hostW: number,
  hostH: number,
  collars = false,
): RowFit {
  const cap =
    hostH > 0 ? Math.min(MAX_SCALE, Math.max(0, hostH - SLEEVE_PAD_PX) / BUMPER_MM) : MAX_SCALE;
  const discGaps = DISC_GAP_PX * Math.max(0, plates.length - 1);
  const collar = collarDrawn(plates, collars) ? COLLAR_GAP_PX + COLLAR_PX : 0;
  return fitRow(plates, hostW - CHROME_PX - collar - discGaps, cap);
}

/**
 * Whether the sleeve draws a Collar (RBAR-96): only when Setup's collars are on AND the
 * Bar has Plates. A bare Bar never gets one -- there is no outer disc to clamp.
 */
export function collarDrawn(plates: readonly Plate[], collars: boolean): boolean {
  return collars && plates.length > 0;
}

/** The pieces of one sleeve, in their left-to-right order. */
export type SleevePartKind = 'shaft' | 'collar-inner' | 'disc' | 'empty' | 'collar' | 'bare-end';

/** One piece of the sleeve, in host px. Discs carry their Plate and numeral. */
export interface SleevePart {
  readonly kind: SleevePartKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The Plate a disc draws (discs only). */
  readonly plate?: Plate;
  /** The disc's engraved numeral (sleeve px), or null when it would not fit (discs only). */
  readonly numeral?: { readonly px: number; readonly text: string } | null;
}

/**
 * Where `<rack-sleeve>` puts each piece in a `hostW` x `hostH` host (RBAR-70): the same
 * flex row the element's CSS lays out -- shaft, inner collar, the discs heaviest-first
 * (or the dashed empty box on a bare Bar), the Collar when `collarDrawn`, the bare end --
 * centred on both axes, at the `sleeveFit` scale. The share picture draws from this; the
 * element keeps its CSS, and both read the same constants. The Collar's latch is not a
 * part: it rides on the Collar (LATCH_* above), standing above its box.
 */
export function sleeveLayout(
  plates: readonly Plate[],
  hostW: number,
  hostH: number,
  collars = false,
): readonly SleevePart[] {
  const { scale, shrink } = sleeveFit(plates, hostW, hostH, collars);
  const collar = collarDrawn(plates, collars);
  const discW = (p: Plate) => Math.max(p.widthMm * scale, MIN_DISC_PX) * shrink;
  const discH = (p: Plate) => p.diameterMm * scale * shrink;
  const rowW =
    plates.length > 0
      ? plates.reduce((w, p) => w + discW(p), 0) + DISC_GAP_PX * (plates.length - 1)
      : EMPTY_INSET_PX + EMPTY_W_PX;
  const contentW = CHROME_PX + rowW + (collar ? COLLAR_GAP_PX + COLLAR_PX : 0);
  const cy = hostH / 2;
  let x = (hostW - contentW) / 2;
  const parts: SleevePart[] = [];
  const piece = (kind: SleevePartKind, w: number, h: number, extra: Partial<SleevePart> = {}) => {
    parts.push({ kind, x, y: cy - h / 2, w, h, ...extra });
    x += w;
  };
  piece('shaft', SHAFT_PX, SHAFT_H_PX);
  piece('collar-inner', COLLAR_INNER_PX, COLLAR_INNER_H_PX);
  if (plates.length === 0) {
    x += EMPTY_INSET_PX;
    piece('empty', EMPTY_W_PX, EMPTY_MM * scale);
  } else {
    plates.forEach((p, i) => {
      if (i > 0) x += DISC_GAP_PX;
      const w = discW(p);
      const h = discH(p);
      const text = plateLabel(p);
      const numeral = numeralFits(w, h, text) ? { px: numeralPx(w), text } : null;
      piece('disc', w, h, { plate: p, numeral });
    });
  }
  if (collar) {
    x += COLLAR_GAP_PX;
    piece('collar', COLLAR_PX, COLLAR_MM * scale * shrink);
  }
  piece('bare-end', BARE_END_PX, BARE_END_H_PX);
  return parts;
}
