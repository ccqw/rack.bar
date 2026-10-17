import { describe, it, expect } from 'vitest';
import {
  IMAGE_ZOOM,
  SHARE_IMAGE,
  SHARE_IMAGE_PX,
  barLayout,
  mixWithWhite,
  plateListLayout,
} from './shareimage.ts';
import type { BarPart, Rect } from './shareimage.ts';
import { ELEIKO_KG, IRON_LB, SLEEVE_MM } from './plates.ts';
import type { Plate } from './plates.ts';
import { decode } from './decode.ts';
import { MAX_SCALE, MIN_DISC_PX, SHAFT_PX, TARGET_BUMPER_PX } from './sleevefit.ts';

const eleiko = (kg: number): Plate => ELEIKO_KG.find((p) => p.kg === kg)!;
const iron = (label: string): Plate => IRON_LB.find((p) => p.label === label)!;

const band = SHARE_IMAGE.bar;
const cx = band.x + band.w / 2;
const cy = band.y + band.h / 2;
const right = (r: Rect) => r.x + r.w;
const midX = (r: Rect) => r.x + r.w / 2;
const discs = (parts: readonly BarPart[]) => parts.filter((p) => p.kind === 'disc');
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

// A Side Load that fills the sleeve: as many 25s as fit, then 0.5s to the brim.
function fullSleeve(): Plate[] {
  const side: Plate[] = [];
  let used = 0;
  for (const p of [eleiko(25), eleiko(0.5)]) {
    while (used + p.widthMm <= SLEEVE_MM) {
      side.push(p);
      used += p.widthMm;
    }
  }
  return side;
}

describe('the share image frame', () => {
  it('is a square that holds the bar band and the list inside its margins', () => {
    expect(SHARE_IMAGE_PX).toBe(1080);
    for (const r of [SHARE_IMAGE.bar, SHARE_IMAGE.list]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(right(r)).toBeLessThanOrEqual(SHARE_IMAGE_PX);
      expect(r.y + r.h).toBeLessThanOrEqual(SHARE_IMAGE_PX);
    }
    // The Total sits above the Bar, the Plate list below it, the caption at the foot.
    expect(SHARE_IMAGE.total.y).toBeLessThan(band.y);
    expect(SHARE_IMAGE.list.y).toBeGreaterThanOrEqual(band.y + band.h);
    expect(SHARE_IMAGE.caption.y).toBeGreaterThan(SHARE_IMAGE.list.y + SHARE_IMAGE.list.h);
  });

  it('leaves the band tall enough for a full-zoom bumper', () => {
    expect(band.h).toBeGreaterThanOrEqual(TARGET_BUMPER_PX * IMAGE_ZOOM);
  });
});

describe('barLayout (the whole Bar, both Sides, by the sleeve rules)', () => {
  const side = [eleiko(25), eleiko(25), eleiko(10), eleiko(5), eleiko(1)];

  it('spans the band edge to edge: cap at each end, the grip in the middle', () => {
    const parts = barLayout(side);
    expect(parts[0]!.kind).toBe('cap');
    expect(parts[parts.length - 1]!.kind).toBe('cap');
    near(parts[0]!.rect.x, band.x);
    near(right(parts[parts.length - 1]!.rect), band.x + band.w);
    const grip = parts.find((p) => p.kind === 'grip')!;
    near(midX(grip.rect), cx);
  });

  it('lays the pieces left to right without overlap', () => {
    const parts = barLayout(side);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]!.rect.x).toBeGreaterThanOrEqual(right(parts[i - 1]!.rect) - 1e-6);
    }
  });

  it('centres every piece on the band midline', () => {
    for (const p of barLayout(side)) near(p.rect.y + p.rect.h / 2, cy);
  });

  it('loads both Sides as mirror images, heaviest next to the inner collar', () => {
    const d = discs(barLayout(side));
    expect(d).toHaveLength(side.length * 2);
    const left = d.slice(0, side.length);
    const rightSide = d.slice(side.length);
    // Right Side reads heaviest-first outward; the left is its mirror.
    expect(rightSide.map((p) => p.plate!.kg)).toEqual([25, 25, 10, 5, 1]);
    expect(left.map((p) => p.plate!.kg)).toEqual([1, 5, 10, 25, 25]);
    for (let i = 0; i < side.length; i++) {
      const l = left[side.length - 1 - i]!.rect;
      const r = rightSide[i]!.rect;
      near(midX(l) + midX(r), 2 * cx);
      near(l.w, r.w);
      near(l.h, r.h);
    }
  });

  it('sizes discs like the sleeve at full zoom: a bumper is 168px x zoom tall', () => {
    const d = discs(barLayout(side));
    const bumper = d.find((p) => p.plate!.kg === 25)!.rect;
    const green = d.find((p) => p.plate!.kg === 10)!.rect;
    near(bumper.h, TARGET_BUMPER_PX * IMAGE_ZOOM);
    // Same diameter, so same height; the 25 is fatter (ADR-0004).
    near(green.h, bumper.h);
    expect(bumper.w).toBeGreaterThan(green.w);
    near(bumper.w, 58 * MAX_SCALE * IMAGE_ZOOM);
    // The change Plates nest down in height.
    const one = d.find((p) => p.plate!.kg === 1)!.rect;
    expect(one.h).toBeLessThan(bumper.h);
  });

  it('floors a thin change Plate at the sleeve minimum, zoomed', () => {
    const d = discs(barLayout([eleiko(25), eleiko(0.5)]));
    const half = d.find((p) => p.plate!.kg === 0.5)!.rect;
    expect(half.w).toBeGreaterThanOrEqual(MIN_DISC_PX * IMAGE_ZOOM - 1e-6);
  });

  it('fits a full sleeve inside the band and keeps a real grip between the collars', () => {
    const parts = barLayout(fullSleeve());
    for (const p of parts) {
      expect(p.rect.x).toBeGreaterThanOrEqual(band.x - 1e-6);
      expect(right(p.rect)).toBeLessThanOrEqual(band.x + band.w + 1e-6);
      expect(p.rect.h).toBeLessThanOrEqual(band.h + 1e-6);
    }
    const grip = parts.find((p) => p.kind === 'grip')!;
    expect(grip.rect.w).toBeGreaterThanOrEqual(2 * SHAFT_PX * IMAGE_ZOOM - 1e-6);
  });

  it('zooms the whole row out (never overflows) for a narrower band', () => {
    const narrow: Rect = { x: 0, y: 0, w: 500, h: 400 };
    const parts = barLayout(fullSleeve(), narrow);
    near(right(parts[parts.length - 1]!.rect), 500);
    for (const p of parts) expect(right(p.rect)).toBeLessThanOrEqual(500 + 1e-6);
    const bumper = discs(parts)[0]!.rect;
    expect(bumper.h).toBeLessThan(TARGET_BUMPER_PX * IMAGE_ZOOM);
  });

  it('draws a bare Bar with an empty box on each Side and no discs', () => {
    const parts = barLayout([]);
    expect(discs(parts)).toHaveLength(0);
    const empty = parts.filter((p) => p.kind === 'empty');
    expect(empty).toHaveLength(2);
    near(midX(empty[0]!.rect) + midX(empty[1]!.rect), 2 * cx);
  });

  it('engraves the numeral by the sleeve buckets, zoomed, and only where it fits', () => {
    const d = discs(barLayout([eleiko(25), eleiko(0.5)]));
    const bumper = d.find((p) => p.plate!.kg === 25)!;
    expect(bumper.numeral).toEqual({ px: 11 * IMAGE_ZOOM, text: '25' });
    const half = d.find((p) => p.plate!.kg === 0.5)!;
    // 16 mm at full zoom is ~6px: floored to 9px, it seats the 8px bucket.
    expect(half.numeral).toEqual({ px: 8 * IMAGE_ZOOM, text: '.5' });
  });

  it('stamps iron Plates with their lb label', () => {
    const d = discs(barLayout([iron('45'), iron('2.5')]));
    expect(d.find((p) => p.plate!.label === '45')!.numeral!.text).toBe('45');
  });

  it('a decoded Competition 142 kg fits at full zoom', () => {
    const { side: s } = decode(142, 20, ELEIKO_KG).primary;
    expect(s.map((p) => p.kg)).toEqual([25, 25, 10, 1]);
    const bumper = discs(barLayout(s)).find((p) => p.plate!.kg === 25)!.rect;
    near(bumper.h, TARGET_BUMPER_PX * IMAGE_ZOOM);
  });
});

describe('plateListLayout (the format-D lines, wrapped and centred)', () => {
  const area: Rect = { x: 100, y: 0, w: 800, h: 200 };

  it('uses the largest font when the lines fit, one centred row', () => {
    const { fontPx, items } = plateListLayout([2, 2, 2], area);
    expect(fontPx).toBe(SHARE_IMAGE.listFonts[0]);
    const gap = fontPx * SHARE_IMAGE.listGapEm;
    const rowW = 3 * 2 * fontPx + 2 * gap;
    near(items[0]!.x, area.x + (area.w - rowW) / 2);
    expect(new Set(items.map((i) => i.y)).size).toBe(1);
    near(items[0]!.y, area.y + area.h / 2);
  });

  it('wraps to more rows, then steps the font down until the block fits', () => {
    const many = Array.from({ length: 10 }, () => 4);
    const { fontPx, items } = plateListLayout(many, area);
    expect(fontPx).toBeLessThan(SHARE_IMAGE.listFonts[0]!);
    const rows = new Set(items.map((i) => i.y)).size;
    expect(rows).toBeGreaterThan(1);
    expect(rows * fontPx * SHARE_IMAGE.listRowEm).toBeLessThanOrEqual(area.h + 1e-6);
    for (const [i, it] of items.entries()) {
      expect(it.x).toBeGreaterThanOrEqual(area.x - 1e-6);
      expect(it.x + many[i]! * fontPx).toBeLessThanOrEqual(area.x + area.w + 1e-6);
    }
  });

  it('keeps the input order, reading left to right then down', () => {
    const { items } = plateListLayout([5, 5, 5, 5, 5], { x: 0, y: 0, w: 600, h: 400 });
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!;
      const cur = items[i]!;
      expect(cur.y > prev.y || (cur.y === prev.y && cur.x > prev.x)).toBe(true);
    }
  });

  it('falls back to the smallest font when nothing fits (never throws)', () => {
    const { fontPx, items } = plateListLayout(Array(40).fill(9), { x: 0, y: 0, w: 300, h: 50 });
    const fonts = SHARE_IMAGE.listFonts;
    expect(fontPx).toBe(fonts[fonts.length - 1]);
    expect(items).toHaveLength(40);
  });

  it('places nothing for an empty list', () => {
    expect(plateListLayout([], area).items).toEqual([]);
  });
});

describe('mixWithWhite (the top-lit disc gradient stop)', () => {
  it('mixes a plate hex 95 / 5 with white, like color-mix in srgb', () => {
    expect(mixWithWhite('#e0263a', 0.05)).toBe('#e23144');
    expect(mixWithWhite('#000000', 0.5)).toBe('#808080');
    expect(mixWithWhite('#ffffff', 0.05)).toBe('#ffffff');
  });

  it('accepts surrounding whitespace and upper case (a computed token value)', () => {
    expect(mixWithWhite('  #E0263A ', 0.05)).toBe('#e23144');
  });

  it('returns a non-hex colour unchanged rather than guessing', () => {
    expect(mixWithWhite('red', 0.05)).toBe('red');
  });
});
