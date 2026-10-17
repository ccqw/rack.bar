import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  configText,
  groupSide,
  groupText,
  loadingSummary,
  loadTotalKg,
  plateEmoji,
  SHARE_LINK,
} from './summary.ts';
import { ELEIKO_KG, IRON_LB, SLEEVE_MM } from './plates.ts';
import type { Plate } from './plates.ts';
import { decode } from './decode.ts';
import { lbToKg } from './units.ts';

// The emoji glyphs the expectations compare against, written as escapes so this
// file stays ASCII too (RBAR-64).
const RED_SQ = '\u{1F7E5}'; // large red square
const BLUE_SQ = '\u{1F7E6}'; // large blue square
const YELLOW_SQ = '\u{1F7E8}'; // large yellow square
const GREEN_SQ = '\u{1F7E9}'; // large green square
const WHITE_SQ = '\u{2B1C}'; // white large square
const RED_DOT = '\u{1F534}'; // large red circle
const BLUE_DOT = '\u{1F535}'; // large blue circle
const YELLOW_DOT = '\u{1F7E1}'; // large yellow circle
const GREEN_DOT = '\u{1F7E2}'; // large green circle
const WHITE_DOT = '\u{26AA}'; // medium white circle
const IRON_SQ = '\u{2B1B}'; // black large square
const IRON_SMALL = '\u{25FE}'; // black medium-small square
const LOCK = '\u{1F512}'; // lock (the Collars line)
const MID = '\u{00B7}'; // middle dot (heading separator)
const TIMES = '\u{00D7}'; // multiplication sign (count)

// Pull denominations by kg from a set, so tests read in domain terms.
const eleiko = (kg: number): Plate => {
  const p = ELEIKO_KG.find((x) => x.kg === kg);
  if (!p) throw new Error(`no Eleiko ${kg}`);
  return p;
};
const iron = (label: string): Plate => {
  const p = IRON_LB.find((x) => x.label === label);
  if (!p) throw new Error(`no iron ${label}`);
  return p;
};

describe('groupSide', () => {
  it('folds a heaviest-first Side Load into count x face groups', () => {
    const side = [eleiko(25), eleiko(25), eleiko(15), eleiko(2.5)];
    expect(groupSide(side)).toEqual([
      { face: '25', color: 'red', emoji: RED_SQ, count: 2 },
      { face: '15', color: 'yellow', emoji: YELLOW_SQ, count: 1 },
      { face: '2.5', color: 'red', emoji: RED_DOT, count: 1 },
    ]);
  });

  it('uses the Plate stamp (label) for iron, its kg for Eleiko', () => {
    expect(groupSide([iron('45'), iron('45'), iron('25')])).toEqual([
      { face: '45', color: 'iron', emoji: IRON_SQ, count: 2 },
      { face: '25', color: 'iron', emoji: IRON_SQ, count: 1 },
    ]);
  });

  it('an empty Side Load groups to nothing', () => {
    expect(groupSide([])).toEqual([]);
  });
});

describe('groupText', () => {
  // Prototype L888: the count ALWAYS shows, including a single ('1x 25'), so a
  // glance never has to infer whether a bare face means one Plate (RBAR-44).
  it('labels a single Plate with its count too', () => {
    expect(groupText({ face: '25', color: 'red', emoji: RED_SQ, count: 1 })).toBe('1x 25');
  });

  it('labels a run as N x face', () => {
    expect(groupText({ face: '25', color: 'red', emoji: RED_SQ, count: 2 })).toBe('2x 25');
  });
});

describe('configText', () => {
  // Prototype L891: '{kg} kg / {lb} lb bar - {setName}' -- the Bar always reads in
  // BOTH Units, and the plate-set name rides the config line (RBAR-44).
  it('names the Bar in both Units plus the plate set', () => {
    expect(configText(20, 0, 'Competition')).toBe('20 kg / 44 lb bar - Competition');
  });

  it('appends the Collars when fitted (in-house addition kept)', () => {
    expect(configText(20, 2.5, 'Competition')).toBe(
      '20 kg / 44 lb bar, collars 2.5 kg - Competition',
    );
  });

  it('reads an iron Bar dual-unit too (whole-lb side exact)', () => {
    expect(configText(lbToKg(45), 0, 'Training')).toBe('20.41 kg / 45 lb bar - Training');
  });
});

describe('plateEmoji', () => {
  // RBAR-64: a bumper is a coloured square; a change Plate (under 5 kg) wears its
  // bumper's colour as a circle, so the row tells big from small at a glance.
  it('maps every Eleiko bumper to its colour square', () => {
    expect([25, 20, 15, 10, 5].map((kg) => plateEmoji(eleiko(kg)))).toEqual([
      RED_SQ,
      BLUE_SQ,
      YELLOW_SQ,
      GREEN_SQ,
      WHITE_SQ,
    ]);
  });

  it('maps every Eleiko change Plate to its colour circle', () => {
    expect([2.5, 2, 1.5, 1, 0.5].map((kg) => plateEmoji(eleiko(kg)))).toEqual([
      RED_DOT,
      BLUE_DOT,
      YELLOW_DOT,
      GREEN_DOT,
      WHITE_DOT,
    ]);
  });

  it('maps iron to black: a big square for 45/35/25, a small one for 10/5/2.5', () => {
    expect(['45', '35', '25', '10', '5', '2.5'].map((l) => plateEmoji(iron(l)))).toEqual([
      IRON_SQ,
      IRON_SQ,
      IRON_SQ,
      IRON_SMALL,
      IRON_SMALL,
      IRON_SMALL,
    ]);
  });

  it('gives every Plate in both sets exactly one glyph', () => {
    for (const p of [...ELEIKO_KG, ...IRON_LB]) {
      expect([...plateEmoji(p)]).toHaveLength(1);
    }
  });
});

describe('loadingSummary', () => {
  // RBAR-64, format "D. Plate list" (Caitlin's pick): a heading with the Total and
  // "per side", one line per Plate group heaviest first (emoji, stamped face, count),
  // the Collars if fitted, and a closing link.
  const lines = (s: Parameters<typeof loadingSummary>[0]) => loadingSummary(s).split('\n');

  it('lists one line per Plate group under a Total heading, then the link', () => {
    expect(
      lines({
        side: [eleiko(25), eleiko(25), eleiko(10), eleiko(1)],
        barKg: 20,
        collarKg: 0,
        unit: 'kg',
      }),
    ).toEqual([
      `rack.bar ${MID} 142 kg ${MID} per side`,
      `${RED_SQ} 25 ${TIMES} 2`,
      `${GREEN_SQ} 10 ${TIMES} 1`,
      `${GREEN_DOT} 1 ${TIMES} 1`,
      SHARE_LINK,
    ]);
  });

  // Pins the URL itself: every other case compares against the SHARE_LINK constant.
  it('links the app on the closing line', () => {
    expect(SHARE_LINK).toBe('https://rack.bar');
  });

  it('marks change Plates with circles beside the bumper squares', () => {
    expect(
      lines({
        side: [eleiko(20), eleiko(2.5), eleiko(1.5), eleiko(0.5)],
        barKg: 15,
        collarKg: 0,
        unit: 'kg',
      }),
    ).toEqual([
      `rack.bar ${MID} 64 kg ${MID} per side`, // the 15 kg Bar + 2 x 24.5
      `${BLUE_SQ} 20 ${TIMES} 1`,
      `${RED_DOT} 2.5 ${TIMES} 1`,
      `${YELLOW_DOT} 1.5 ${TIMES} 1`,
      `${WHITE_DOT} 0.5 ${TIMES} 1`,
      SHARE_LINK,
    ]);
  });

  it('a single Plate is a single line', () => {
    expect(
      lines({ side: [eleiko(2.5)], barKg: 5, collarKg: 0, unit: 'kg' }),
    ).toEqual([`rack.bar ${MID} 10 kg ${MID} per side`, `${RED_DOT} 2.5 ${TIMES} 1`, SHARE_LINK]);
  });

  it('iron: black glyphs, lb faces as stamped, Collars after the Plates', () => {
    expect(
      lines({
        side: [iron('45'), iron('35'), iron('5'), iron('2.5')],
        barKg: lbToKg(45),
        collarKg: 2.5,
        unit: 'lb',
      }),
    ).toEqual([
      `rack.bar ${MID} 231 lb ${MID} per side`,
      `${IRON_SQ} 45 ${TIMES} 1`,
      `${IRON_SQ} 35 ${TIMES} 1`,
      `${IRON_SMALL} 5 ${TIMES} 1`,
      `${IRON_SMALL} 2.5 ${TIMES} 1`,
      `${LOCK} collars 2.5 kg`,
      SHARE_LINK,
    ]);
  });

  it('Collars fitted on the Competition set get their own line', () => {
    expect(
      lines({ side: [eleiko(25)], barKg: 20, collarKg: 2.5, unit: 'kg' }),
    ).toEqual([
      `rack.bar ${MID} 75 kg ${MID} per side`,
      `${RED_SQ} 25 ${TIMES} 1`,
      `${LOCK} collars 2.5 kg`,
      SHARE_LINK,
    ]);
  });

  it('mixed Units: the Total reads lb, the Eleiko faces stay kg', () => {
    expect(
      lines({ side: [eleiko(25), eleiko(15)], barKg: 20, collarKg: 0, unit: 'lb' }),
    ).toEqual([
      `rack.bar ${MID} 220 lb ${MID} per side`,
      `${RED_SQ} 25 ${TIMES} 1`,
      `${YELLOW_SQ} 15 ${TIMES} 1`,
      SHARE_LINK,
    ]);
  });

  it('a 20 kg Bar on the Training set: kg Total, lb face', () => {
    // 20 + 2 x 45 lb (20.41 kg) = 60.82 kg.
    expect(lines({ side: [iron('45')], barKg: 20, collarKg: 0, unit: 'kg' })).toEqual([
      `rack.bar ${MID} 60.82 kg ${MID} per side`,
      `${IRON_SQ} 45 ${TIMES} 1`,
      SHARE_LINK,
    ]);
  });

  it('bare Bar: one "Bare bar" line in place of the Plates', () => {
    expect(lines({ side: [], barKg: 20, collarKg: 0, unit: 'kg' })).toEqual([
      `rack.bar ${MID} 20 kg ${MID} per side`,
      'Bare bar',
      SHARE_LINK,
    ]);
  });

  it('bare Bar with Collars: the Collar line still follows', () => {
    expect(lines({ side: [], barKg: 20, collarKg: 2.5, unit: 'kg' })).toEqual([
      `rack.bar ${MID} 25 kg ${MID} per side`,
      'Bare bar',
      `${LOCK} collars 2.5 kg`,
      SHARE_LINK,
    ]);
  });

  it('builds its Plate lines from groupSide, so it cannot drift from the card chips', () => {
    const side = [eleiko(25), eleiko(20), eleiko(20), eleiko(5), eleiko(1), eleiko(0.5)];
    const plateLines = lines({ side, barKg: 20, collarKg: 0, unit: 'kg' }).slice(1, -1);
    // One line per groupSide group, in the same order and counts as the chips.
    expect(plateLines).toHaveLength(groupSide(side).length);
    expect(plateLines).toEqual([
      `${RED_SQ} 25 ${TIMES} 1`,
      `${BLUE_SQ} 20 ${TIMES} 2`,
      `${WHITE_SQ} 5 ${TIMES} 1`,
      `${GREEN_DOT} 1 ${TIMES} 1`,
      `${WHITE_DOT} 0.5 ${TIMES} 1`,
    ]);
  });

  it('a sleeve-full Side is one short line, and the paste stays short', () => {
    // The heaviest Target the core will load: the sleeve caps the 25s (ADR-0012).
    const { side } = decode(1000, 20, ELEIKO_KG, SLEEVE_MM).primary;
    expect(lines({ side, barKg: 20, collarKg: 2.5, unit: 'kg' })).toEqual([
      `rack.bar ${MID} 375 kg ${MID} per side`,
      `${RED_SQ} 25 ${TIMES} 7`,
      `${LOCK} collars 2.5 kg`,
      SHARE_LINK,
    ]);
  });

  it('the longest group list (every Eleiko denomination) stays under 200 chars', () => {
    const side = [...ELEIKO_KG];
    const text = loadingSummary({ side, barKg: 20, collarKg: 2.5, unit: 'kg' });
    expect(text.split('\n')).toHaveLength(13);
    expect(text.length).toBeLessThan(200);
  });
});

describe('summary source', () => {
  // The project emits plain ASCII in source; the emoji live only in the OUTPUT,
  // written as escapes in one map (RBAR-64).
  it('is plain ASCII', () => {
    const src = readFileSync(resolve(import.meta.dirname, 'summary.ts'), 'utf8');
    const bad = [...src].filter((c) => c.charCodeAt(0) > 0x7e);
    expect(bad).toEqual([]);
  });
});

describe('loadTotalKg', () => {
  it('derives the Total from the rig + Side Load (Bar + 2 x Side Load)', () => {
    expect(loadTotalKg({ side: [eleiko(25), eleiko(15)], barKg: 20, collarKg: 0, unit: 'kg' })).toBe(100);
  });

  it('folds the Collars into the baseline (Bar + 2 x Collar + 2 x Side Load)', () => {
    expect(loadTotalKg({ side: [eleiko(25), eleiko(15)], barKg: 20, collarKg: 2.5, unit: 'kg' })).toBe(105);
  });

  it('a bare Bar Totals to the Bar', () => {
    expect(loadTotalKg({ side: [], barKg: 20, collarKg: 0, unit: 'kg' })).toBe(20);
  });
});
