import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  configText,
  emojiRow,
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
      { face: '25', color: 'red', count: 2 },
      { face: '15', color: 'yellow', count: 1 },
      { face: '2.5', color: 'red', count: 1 },
    ]);
  });

  it('uses the Plate stamp (label) for iron, its kg for Eleiko', () => {
    expect(groupSide([iron('45'), iron('45'), iron('25')])).toEqual([
      { face: '45', color: 'iron', count: 2 },
      { face: '25', color: 'iron', count: 1 },
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
    expect(groupText({ face: '25', color: 'red', count: 1 })).toBe('1x 25');
  });

  it('labels a run as N x face', () => {
    expect(groupText({ face: '25', color: 'red', count: 2 })).toBe('2x 25');
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

describe('emojiRow', () => {
  it('is one emoji per Plate on a Side, in loading order', () => {
    expect(emojiRow([eleiko(25), eleiko(25), eleiko(15), eleiko(2.5)])).toBe(
      RED_SQ + RED_SQ + YELLOW_SQ + RED_DOT,
    );
  });

  it('a single Plate is a single emoji', () => {
    expect(emojiRow([eleiko(10)])).toBe(GREEN_SQ);
  });

  it('an empty Side Load is an empty row', () => {
    expect(emojiRow([])).toBe('');
  });

  it('agrees with groupSide: same order, same counts (cannot drift)', () => {
    const side = [eleiko(25), eleiko(20), eleiko(20), eleiko(5), eleiko(1), eleiko(0.5)];
    const fromGroups = groupSide(side)
      .map((g) => {
        const p = side.find((x) => (x.label ?? String(x.kg)) === g.face)!;
        return plateEmoji(p).repeat(g.count);
      })
      .join('');
    expect(emojiRow(side)).toBe(fromGroups);
  });

  it('a sleeve-full Side still reads as one short line', () => {
    // The heaviest Target the core will load: the sleeve caps the 25s (ADR-0012).
    const { side } = decode(1000, 20, ELEIKO_KG, SLEEVE_MM).primary;
    expect(emojiRow(side)).toBe(RED_SQ.repeat(7));
  });

  it('a sleeve-full iron Side is all black squares', () => {
    const { side } = decode(2000, lbToKg(45), IRON_LB, SLEEVE_MM).primary;
    expect(emojiRow(side)).toBe(IRON_SQ.repeat(8));
  });
});

describe('loadingSummary', () => {
  // RBAR-64 (amending the RBAR-44 3-line text): line 1 'rack.bar - {total} {unit}',
  // then the emoji row, the per-Side groups with counts always (the real
  // instruction, and the fallback for screen readers), the config caption, and a
  // closing link -- Wordle-style.
  it('is five lines: wordmark + Total, emoji row, per-Side, config, link', () => {
    const text = loadingSummary(
      {
        side: [eleiko(25), eleiko(15)],
        barKg: 20,
        collarKg: 0,
        unit: 'kg',
      },
      'Competition',
    );
    expect(text.split('\n')).toEqual([
      'rack.bar - 100 kg',
      RED_SQ + YELLOW_SQ,
      'Per side: 1x 25  1x 15',
      '20 kg / 44 lb bar - Competition',
      SHARE_LINK,
    ]);
  });

  it('links the app on the closing line', () => {
    expect(SHARE_LINK).toBe('https://rack.bar');
  });

  it('marks change Plates as circles beside the bumper squares', () => {
    const text = loadingSummary(
      {
        side: [eleiko(20), eleiko(2.5), eleiko(1.5), eleiko(0.5)],
        barKg: 15,
        collarKg: 0,
        unit: 'kg',
      },
      'Competition',
    );
    expect(text.split('\n')[1]).toBe(BLUE_SQ + RED_DOT + YELLOW_DOT + WHITE_DOT);
    expect(text.split('\n')[2]).toBe('Per side: 1x 20  1x 2.5  1x 1.5  1x 0.5');
  });

  it('iron: black glyphs, the count line carries the faces', () => {
    const text = loadingSummary(
      {
        side: [iron('45'), iron('45'), iron('10'), iron('2.5')],
        barKg: lbToKg(45),
        collarKg: 0,
        unit: 'lb',
      },
      'Training',
    );
    expect(text.split('\n')).toEqual([
      'rack.bar - 250 lb',
      IRON_SQ + IRON_SQ + IRON_SMALL + IRON_SMALL,
      'Per side: 2x 45  1x 10  1x 2.5',
      '20.41 kg / 45 lb bar - Training',
      SHARE_LINK,
    ]);
  });

  it('a 20 kg Bar on the Training set reads in kg on the config line', () => {
    const text = loadingSummary(
      { side: [iron('45')], barKg: 20, collarKg: 0, unit: 'kg' },
      'Training',
    );
    expect(text.split('\n')[1]).toBe(IRON_SQ);
    expect(text.split('\n')[3]).toBe('20 kg / 44 lb bar - Training');
  });

  it('a 5 kg Bar with a single change Plate', () => {
    const text = loadingSummary(
      { side: [eleiko(2.5)], barKg: 5, collarKg: 0, unit: 'kg' },
      'Competition',
    );
    expect(text.split('\n').slice(0, 3)).toEqual([
      'rack.bar - 10 kg',
      RED_DOT,
      'Per side: 1x 2.5',
    ]);
  });

  it('bare Bar with Collars: no emoji row, Collars on the config line', () => {
    const text = loadingSummary(
      { side: [], barKg: 20, collarKg: 2.5, unit: 'kg' },
      'Competition',
    );
    expect(text.split('\n')).toEqual([
      'rack.bar - 25 kg',
      'Bare bar - no plates',
      '20 kg / 44 lb bar, collars 2.5 kg - Competition',
      SHARE_LINK,
    ]);
  });

  it('iron with Collars in lb: no collar glyph in the row', () => {
    const text = loadingSummary(
      { side: [iron('45')], barKg: lbToKg(45), collarKg: 2.5, unit: 'lb' },
      'Training',
    );
    const lines = text.split('\n');
    expect(lines[1]).toBe(IRON_SQ);
    expect(lines[3]).toBe('20.41 kg / 45 lb bar, collars 2.5 kg - Training');
  });

  it('Collars stay on the config line, never in the emoji row', () => {
    const text = loadingSummary(
      { side: [eleiko(25)], barKg: 20, collarKg: 2.5, unit: 'kg' },
      'Competition',
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('rack.bar - 75 kg');
    expect(lines[1]).toBe(RED_SQ);
    expect(lines[3]).toBe('20 kg / 44 lb bar, collars 2.5 kg - Competition');
  });

  it('groups repeated Plates, counts always, on the per-Side line', () => {
    const text = loadingSummary(
      {
        side: [eleiko(25), eleiko(25), eleiko(2.5)],
        barKg: 20,
        collarKg: 0,
        unit: 'kg',
      },
      'Competition',
    );
    expect(text.split('\n')[1]).toBe(RED_SQ + RED_SQ + RED_DOT);
    expect(text.split('\n')[2]).toBe('Per side: 2x 25  1x 2.5');
  });

  it('names the Collars on the config line when fitted', () => {
    const text = loadingSummary(
      {
        side: [eleiko(25), eleiko(15)],
        barKg: 20,
        collarKg: 2.5,
        unit: 'kg',
      },
      'Competition',
    );
    expect(text.split('\n')[3]).toBe('20 kg / 44 lb bar, collars 2.5 kg - Competition');
  });

  it('reads the Total in the display Unit; the config line is dual-unit regardless', () => {
    const text = loadingSummary(
      {
        side: [eleiko(25), eleiko(15)],
        barKg: 20,
        collarKg: 0,
        unit: 'lb',
      },
      'Competition',
    );
    // Mixed Units: the Total reads lb, the Eleiko faces stay kg (ADR-0011).
    expect(text.split('\n')[0]).toBe('rack.bar - 220 lb');
    expect(text.split('\n')[1]).toBe(RED_SQ + YELLOW_SQ);
    expect(text.split('\n')[2]).toBe('Per side: 1x 25  1x 15');
    expect(text.split('\n')[3]).toBe('20 kg / 44 lb bar - Competition');
  });

  it('bare bar: no emoji row, the per-Side line says no plates', () => {
    const text = loadingSummary(
      {
        side: [],
        barKg: 20,
        collarKg: 0,
        unit: 'kg',
      },
      'Competition',
    );
    expect(text.split('\n')).toEqual([
      'rack.bar - 20 kg',
      'Bare bar - no plates',
      '20 kg / 44 lb bar - Competition',
      SHARE_LINK,
    ]);
  });

  it('stays short enough to paste: a sleeve-full load is under 200 chars', () => {
    const { side } = decode(1000, 20, ELEIKO_KG, SLEEVE_MM).primary;
    const text = loadingSummary({ side, barKg: 20, collarKg: 2.5, unit: 'kg' }, 'Competition');
    expect(text.length).toBeLessThan(200);
    expect(text.split('\n')).toHaveLength(5);
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
