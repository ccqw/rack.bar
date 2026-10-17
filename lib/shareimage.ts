// The shared loadout picture's layout (RBAR-70) -- a pure core (ADR-0001). The share
// button attaches a square PNG of the loadout to the format-D text; elements/
// shareimage.ts draws it on a canvas, and everything here is the geometry it draws:
// where the whole Bar sits and how each piece and disc is sized, and how the Plate lines
// wrap. No DOM, no canvas.
//
// The Bar is drawn by the SAME sizing rules as the on-screen sleeve (lib/sleevefit.ts,
// ADR-0004): one px-per-mm scale for every disc, height from diameter, width from
// thickness, the disc floor and the overflow guard, the same chrome and gaps and the
// same numeral buckets -- all multiplied by one IMAGE_ZOOM, because the picture is drawn
// at about twice a phone's CSS size. Unlike the sleeve, which draws ONE Side, the
// picture draws the whole Bar: both Sides mirrored about a grip that fills the middle.
import type { Plate } from './plates.ts';
import {
  BUMPER_MM,
  CAP_H_PX,
  CAP_PX,
  COLLAR_END_H_PX,
  COLLAR_END_PX,
  COLLAR_INNER_H_PX,
  COLLAR_INNER_PX,
  DISC_GAP_PX,
  EMPTY_INSET_PX,
  EMPTY_MM,
  EMPTY_W_PX,
  END_GAP_PX,
  MAX_SCALE,
  MIN_DISC_PX,
  SHAFT_H_PX,
  SHAFT_PX,
  fitRow,
  numeralFits,
  numeralPx,
  plateLabel,
} from './sleevefit.ts';

/** The picture is a square this many px on a side (chat apps crop to square). */
export const SHARE_IMAGE_PX = 1080;
/** Sleeve px to picture px: every sleeve rule is drawn at this multiple. */
export const IMAGE_ZOOM = 2;

/** An axis-aligned box in picture px. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A text anchor: x is the centre (or left edge for the wordmark), y the baseline. */
export interface TextAnchor {
  readonly x: number;
  readonly y: number;
  /** Font size in px. */
  readonly px: number;
}

const MARGIN = 64;
const INNER_W = SHARE_IMAGE_PX - 2 * MARGIN;
const MID = SHARE_IMAGE_PX / 2;

/**
 * The picture's fixed frame, top to bottom: the wordmark (top left), the Total and the
 * other-Unit readout (centred), the whole Bar, the "per side" label and the Plate
 * lines, then the rig caption at the foot.
 */
export const SHARE_IMAGE = {
  wordmark: { x: MARGIN, y: 112, px: 44 } as TextAnchor,
  total: { x: MID, y: 300, px: 168 } as TextAnchor,
  /** The Total's unit suffix, smaller and dimmer (the card's 52 / 18 ratio, rounded). */
  totalUnitPx: 60,
  secondary: { x: MID, y: 372, px: 40 } as TextAnchor,
  /** The whole Bar: tall enough for a full-zoom bumper (168 px x IMAGE_ZOOM). */
  bar: { x: MARGIN, y: 416, w: INNER_W, h: 384 } as Rect,
  listLabel: { x: MID, y: 860, px: 24 } as TextAnchor,
  /** The Plate lines wrap and centre in this box. */
  list: { x: MARGIN, y: 876, w: INNER_W, h: 128 } as Rect,
  caption: { x: MID, y: 1044, px: 24 } as TextAnchor,
  /** The Plate-line font ladder, largest first: the list steps down until it fits. */
  listFonts: [44, 38, 32, 26] as readonly number[],
  /** Space between two Plate lines on a row, in ems of the list font. */
  listGapEm: 0.9,
  /** One row of Plate lines, in ems of the list font. */
  listRowEm: 1.4,
} as const;

/** The pieces of the Bar, in the order they are drawn left to right. */
export type BarPartKind = 'cap' | 'collar-end' | 'collar-inner' | 'grip' | 'disc' | 'empty';

/** One drawn piece of the Bar. Discs carry their Plate and engraved numeral. */
export interface BarPart {
  readonly kind: BarPartKind;
  readonly rect: Rect;
  /** The Plate a disc draws (discs only). */
  readonly plate?: Plate;
  /** The disc's engraved numeral, or null when the digits would not fit (discs only). */
  readonly numeral?: { readonly px: number; readonly text: string } | null;
}

/**
 * The whole Bar laid out in `band` (ADR-0004 by the sleeve rules, x `zoom`): from the
 * left, cap, end collar, the left Side's discs (lightest outermost), inner collar, the
 * grip, inner collar, the right Side's discs heaviest-first, end collar, cap. Both Sides
 * share one scale, so they mirror exactly. The scale is the sleeve's full zoom unless
 * the band is too short or the row too wide, when the whole row zooms out together; the
 * grip takes whatever width is left, never less than the sleeve's two shafts. A bare Bar
 * draws the sleeve's dashed empty box on each Side instead of discs. Every piece is
 * centred on the band's midline.
 */
export function barLayout(
  side: readonly Plate[],
  band: Rect = SHARE_IMAGE.bar,
  zoom: number = IMAGE_ZOOM,
): readonly BarPart[] {
  const z = zoom;
  const cy = band.y + band.h / 2;
  // One Side's fixed chrome without its shaft -- the grip stands in for both shafts.
  const sideChrome = (CAP_PX + COLLAR_END_PX + END_GAP_PX + COLLAR_INNER_PX) * z;
  const minGrip = 2 * SHAFT_PX * z;
  const discGaps = DISC_GAP_PX * z * Math.max(0, side.length - 1);
  const avail = (band.w - minGrip) / 2 - sideChrome - discGaps;
  const cap = Math.min(MAX_SCALE * z, band.h / BUMPER_MM);
  const minDisc = MIN_DISC_PX * z;
  const { scale, shrink } =
    side.length > 0 ? fitRow(side, avail, cap, minDisc) : { scale: cap, shrink: 1 };

  const discW = (p: Plate) => Math.max(p.widthMm * scale, minDisc) * shrink;
  const discH = (p: Plate) => p.diameterMm * scale * shrink;
  const rowW =
    side.length > 0
      ? side.reduce((w, p) => w + discW(p), 0) + discGaps
      : (EMPTY_INSET_PX + EMPTY_W_PX) * z;
  const gripW = band.w - 2 * (sideChrome + rowW);

  const parts: BarPart[] = [];
  let x = band.x;
  const piece = (kind: BarPartKind, w: number, h: number, extra: Partial<BarPart> = {}) => {
    parts.push({ kind, rect: { x, y: cy - h / 2, w, h }, ...extra });
    x += w;
  };
  const disc = (p: Plate) => {
    const w = discW(p);
    const h = discH(p);
    // The numeral buckets are sleeve px, so judge the fit at sleeve size, then zoom.
    const text = plateLabel(p);
    const numeral = numeralFits(w / z, h / z, text) ? { px: numeralPx(w / z) * z, text } : null;
    piece('disc', w, h, { plate: p, numeral });
  };
  const emptyH = EMPTY_MM * scale;

  piece('cap', CAP_PX * z, CAP_H_PX * z);
  piece('collar-end', COLLAR_END_PX * z, COLLAR_END_H_PX * z);
  x += END_GAP_PX * z;
  if (side.length === 0) {
    piece('empty', EMPTY_W_PX * z, emptyH);
    x += EMPTY_INSET_PX * z;
  } else {
    // The left Side mirrors the right: lightest outermost, heaviest by the collar.
    [...side].reverse().forEach((p, i) => {
      if (i > 0) x += DISC_GAP_PX * z;
      disc(p);
    });
  }
  piece('collar-inner', COLLAR_INNER_PX * z, COLLAR_INNER_H_PX * z);
  piece('grip', gripW, SHAFT_H_PX * z);
  piece('collar-inner', COLLAR_INNER_PX * z, COLLAR_INNER_H_PX * z);
  if (side.length === 0) {
    x += EMPTY_INSET_PX * z;
    piece('empty', EMPTY_W_PX * z, emptyH);
  } else {
    side.forEach((p, i) => {
      if (i > 0) x += DISC_GAP_PX * z;
      disc(p);
    });
  }
  x += END_GAP_PX * z;
  piece('collar-end', COLLAR_END_PX * z, COLLAR_END_H_PX * z);
  piece('cap', CAP_PX * z, CAP_H_PX * z);
  return parts;
}

/** Where each Plate line goes: x its left edge, y its row's vertical centre. */
export interface ListItem {
  readonly x: number;
  readonly y: number;
}

/**
 * Wrap the Plate lines into centred rows inside `area` (RBAR-70). `emWidths[i]` is line
 * i's measured width at a 1px font (text width scales with font size), so the shell
 * measures once and this picks the size: the largest font in `fonts` whose wrapped rows
 * fit the area's height. Lines keep their order, left to right then down; each row is
 * centred, and the block of rows is centred vertically. When even the smallest font
 * overflows, it is used anyway (a pathological load clips rather than throws).
 */
export function plateListLayout(
  emWidths: readonly number[],
  area: Rect,
  fonts: readonly number[] = SHARE_IMAGE.listFonts,
): { readonly fontPx: number; readonly items: readonly ListItem[] } {
  const smallest = fonts[fonts.length - 1]!;
  for (const f of fonts) {
    const rows = wrapRows(emWidths, f, area.w);
    if (rows.length * f * SHARE_IMAGE.listRowEm <= area.h || f === smallest) {
      return { fontPx: f, items: placeRows(rows, emWidths, f, area) };
    }
  }
  return { fontPx: smallest, items: [] }; // unreachable unless `fonts` is empty
}

// Greedy wrap: indices of the lines on each row at font `f`. A line wider than the
// whole area still gets a row of its own.
function wrapRows(emWidths: readonly number[], f: number, maxW: number): number[][] {
  const gap = f * SHARE_IMAGE.listGapEm;
  const rows: number[][] = [];
  let rowW = 0;
  emWidths.forEach((em, i) => {
    const w = em * f;
    const last = rows[rows.length - 1];
    if (last && rowW + gap + w <= maxW) {
      last.push(i);
      rowW += gap + w;
    } else {
      rows.push([i]);
      rowW = w;
    }
  });
  return rows;
}

function placeRows(
  rows: readonly number[][],
  emWidths: readonly number[],
  f: number,
  area: Rect,
): ListItem[] {
  const gap = f * SHARE_IMAGE.listGapEm;
  const rowH = f * SHARE_IMAGE.listRowEm;
  const top = area.y + (area.h - rows.length * rowH) / 2;
  const items: ListItem[] = [];
  rows.forEach((row, r) => {
    const w = row.reduce((sum, i) => sum + emWidths[i]! * f, 0) + gap * (row.length - 1);
    let x = area.x + (area.w - w) / 2;
    const y = top + rowH * (r + 0.5);
    for (const i of row) {
      items[i] = { x, y };
      x += emWidths[i]! * f + gap;
    }
  });
  return items;
}

/**
 * The disc fill's light top stop (RBAR-42's recipe, `color-mix(in srgb, disc 95%,
 * #fff)`), computed here because a canvas gradient cannot rely on color-mix support.
 * `white` is the white share (0.05 for the recipe). Takes a 6-digit hex such as a
 * computed --rack-plate-* token; anything else comes back unchanged.
 */
export function mixWithWhite(hex: string, white: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (255 - c) * white)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
