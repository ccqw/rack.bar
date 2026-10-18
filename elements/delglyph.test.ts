import { describe, it, expect, afterEach } from 'vitest';
import './entry.ts';
import './quiz.ts';
import { DEL_ICON } from './delglyph.ts';

// RBAR-102: the X on the delete key sits in the centre of the tag shape's rectangular
// body, not of the bounding box that includes the point. Measured from the paths each
// keypad actually renders, so a hand-edited path that drifts fails here.

type Pt = [number, number];
type Seg = [Pt, Pt];

// The straight segments of an SVG path (M L H V Q Z, absolute or relative; a Q curve
// counts as the chord to its end point, which is all the corner rounding needs).
function segments(d: string): Seg[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Seg[] = [];
  let i = 0;
  let cmd = '';
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const bx = rel ? cur[0] : 0;
    const by = rel ? cur[1] : 0;
    let next: Pt;
    switch (cmd.toUpperCase()) {
      case 'M':
        cur = start = [bx + num(), by + num()];
        cmd = rel ? 'l' : 'L'; // implicit lineto after a moveto
        continue;
      case 'L':
        next = [bx + num(), by + num()];
        break;
      case 'H':
        next = [bx + num(), cur[1]];
        break;
      case 'V':
        next = [cur[0], by + num()];
        break;
      case 'Q':
        num();
        num();
        next = [bx + num(), by + num()];
        break;
      case 'Z':
        next = start;
        cmd = '';
        out.push([cur, next]);
        cur = next;
        continue;
      default:
        throw new Error(`unsupported path command ${cmd}`);
    }
    out.push([cur, next]);
    cur = next;
  }
  return out;
}

// The rectangular body's centre: horizontally the middle of the flat top edge (the
// longest horizontal run at the shape's top), vertically midway between top and bottom.
function bodyCentre(outlineD: string): Pt {
  const segs = segments(outlineD);
  const ys = segs.flatMap(([a, b]) => [a[1], b[1]]);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const flats = segs
    .filter(([a, b]) => Math.abs(a[1] - top) < 1e-6 && Math.abs(b[1] - top) < 1e-6)
    .sort(([a, b], [c, d]) => Math.abs(d[0] - c[0]) - Math.abs(b[0] - a[0]));
  expect(flats.length).toBeGreaterThan(0);
  const [[ax], [bx]] = flats[0]!;
  return [(ax + bx) / 2, (top + bottom) / 2];
}

// The X's centre: the midpoint of each stroke, which must agree.
function crossCentre(crossD: string): Pt {
  const mids = segments(crossD).map(([a, b]): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  expect(mids).toHaveLength(2);
  expect(mids[0]![0]).toBeCloseTo(mids[1]![0], 6);
  expect(mids[0]![1]).toBeCloseTo(mids[1]![1], 6);
  return mids[0]!;
}

function delKeyPaths(root: ShadowRoot): [string, string] {
  const paths = [...root.querySelectorAll('[data-key="del"] svg path')].map(
    (p) => p.getAttribute('d') ?? '',
  );
  expect(paths).toHaveLength(2);
  return [paths[0]!, paths[1]!];
}

function mounted(tag: string): ShadowRoot {
  const el = document.createElement(tag);
  if (tag === 'rack-quiz') el.setAttribute('seed', '7');
  document.body.append(el);
  return el.shadowRoot!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the delete key glyph (RBAR-102)', () => {
  for (const tag of ['rack-entry', 'rack-quiz']) {
    it(`${tag}: the X is centred on the tag's rectangular body, not the bounding box`, () => {
      const [outline, cross] = delKeyPaths(mounted(tag));
      const [bx, by] = bodyCentre(outline);
      const [cx, cy] = crossCentre(cross);
      expect(Math.abs(cx - bx)).toBeLessThan(0.05);
      expect(Math.abs(cy - by)).toBeLessThan(0.05);
    });
  }

  it('both keypads wear the one shared glyph', () => {
    for (const tag of ['rack-entry', 'rack-quiz']) {
      const svg = mounted(tag).querySelector('[data-key="del"] svg')!;
      const probe = document.createElement('div');
      probe.innerHTML = DEL_ICON;
      expect(svg.outerHTML).toBe(probe.firstElementChild!.outerHTML);
    }
  });
});
