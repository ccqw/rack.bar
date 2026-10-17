// Share-link serialize/parse (RBAR-50, ADR-0014): the v1 fragment grammar, its
// canonical form, and every rejection the parser owes. The round-trip and fuzz
// invariants live in lib/properties.test.ts; these pin the concrete examples.
import { describe, it, expect } from 'vitest';
import { serializeLink, parseLink, linkUrl, MAX_LINK_LENGTH, MAX_TARGET_KG } from './link.ts';
import type { LinkState } from './link.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import type { Plate } from './plates.ts';
import { lbToKg, shownIn } from './units.ts';
import { SHARE_LINK } from './summary.ts';

const kg = (w: number): Plate => {
  const p = ELEIKO_KG.find((x) => x.kg === w);
  if (!p) throw new Error(`no Eleiko ${w}`);
  return p;
};
const lb = (face: string): Plate => {
  const p = IRON_LB.find((x) => x.label === face);
  if (!p) throw new Error(`no iron ${face}`);
  return p;
};

// The tests read links as a kg recipient unless a case says otherwise.
const parse = (fragment: string) => parseLink(fragment, 'kg');
// The Target of a parsed load (only decode mode carries one).
const targetOf = (s: LinkState | null) => (s?.mode === 'decode' ? s.targetKg : undefined);

const BASE = 'v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140';

describe('serializeLink / linkUrl: the four plan examples (ADR-0014)', () => {
  it('By Weight, Competition, 140 kg', () => {
    const s: LinkState = {
      set: 'comp',
      barKg: 20,
      collarKg: 0,
      unit: 'kg',
      mode: 'decode',
      side: [kg(25), kg(25), kg(10)],
      targetKg: 140,
    };
    expect(linkUrl(s)).toBe('https://rack.bar/#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
  });

  it('By Weight, Training, 225 lb (Target kept to 2 dp in kg)', () => {
    const s: LinkState = {
      set: 'training',
      barKg: lbToKg(45),
      collarKg: 0,
      unit: 'lb',
      mode: 'decode',
      side: [lb('45'), lb('45')],
      targetKg: lbToKg(225),
    };
    expect(linkUrl(s)).toBe(
      'https://rack.bar/#v=1&s=training&b=45lb&m=w&c=0&u=lb&p=2x45&t=102.06',
    );
  });

  it('By Plates, 15 kg Bar + collars', () => {
    const s: LinkState = {
      set: 'comp',
      barKg: 15,
      collarKg: 2.5,
      unit: 'kg',
      mode: 'encode',
      side: [kg(20), kg(5), kg(2.5)],
    };
    expect(linkUrl(s)).toBe('https://rack.bar/#v=1&s=comp&b=15kg&m=p&c=2.5&u=kg&p=20,5,2.5');
  });

  it('bare Bar: an empty p', () => {
    const s: LinkState = {
      set: 'comp',
      barKg: 20,
      collarKg: 0,
      unit: 'kg',
      mode: 'encode',
      side: [],
    };
    expect(serializeLink(s)).toBe('v=1&s=comp&b=20kg&m=p&c=0&u=kg&p=');
  });

  it('shares the one origin constant with the summary closing line (RBAR-64)', () => {
    const s = parse(BASE)!;
    expect(linkUrl(s)).toBe(`${SHARE_LINK}/#${BASE}`);
  });

  it('names the Training set 20 kg Bar by its own kg stamp (RBAR-63)', () => {
    const s = parse('v=1&s=training&b=20kg&m=p&p=45')!;
    expect(s.barKg).toBe(20);
    expect(serializeLink(s)).toBe('v=1&s=training&b=20kg&m=p&c=0&u=kg&p=45');
  });
});

describe('parseLink: accepted links (ADR-0014)', () => {
  it('parses each plan example back to its state', () => {
    expect(parse(BASE)).toEqual({
      set: 'comp',
      barKg: 20,
      collarKg: 0,
      unit: 'kg',
      mode: 'decode',
      side: [kg(25), kg(25), kg(10)],
      targetKg: 140,
    });
    expect(parse('v=1&s=training&b=45lb&m=w&c=0&u=lb&p=2x45&t=102.06')).toEqual({
      set: 'training',
      barKg: lbToKg(45),
      collarKg: 0,
      unit: 'lb',
      mode: 'decode',
      side: [lb('45'), lb('45')],
      targetKg: 102.06,
    });
    expect(parse('v=1&s=comp&b=15kg&m=p&c=2.5&u=kg&p=20,5,2.5')).toEqual({
      set: 'comp',
      barKg: 15,
      collarKg: 2.5,
      unit: 'kg',
      mode: 'encode',
      side: [kg(20), kg(5), kg(2.5)],
    });
    expect(parse('v=1&s=comp&b=20kg&m=p&c=0&u=kg&p=')).toEqual({
      set: 'comp',
      barKg: 20,
      collarKg: 0,
      unit: 'kg',
      mode: 'encode',
      side: [],
    });
  });

  it('reads `25` by the set: a red Eleiko 25 kg vs an iron 25 lb', () => {
    const comp = parse('v=1&s=comp&b=20kg&m=p&p=25')!;
    const iron = parse('v=1&s=training&b=45lb&m=p&p=25')!;
    expect(comp.side).toEqual([kg(25)]);
    expect(comp.side[0]!.kg).toBe(25);
    expect(iron.side).toEqual([lb('25')]);
    expect(iron.side[0]!.kg).toBeCloseTo(11.34, 2);
  });

  it('an lb Target round-trips to the same reading in the Primary unit', () => {
    for (const lbTarget of [135, 225, 315, 405, 1]) {
      const sent: LinkState = {
        set: 'training',
        barKg: lbToKg(45),
        collarKg: 0,
        unit: 'lb',
        mode: 'decode',
        side: [],
        targetKg: lbToKg(lbTarget),
      };
      const got = parse(serializeLink(sent)!)!;
      expect(got.unit).toBe('lb');
      expect(shownIn(targetOf(got)!, 'lb')).toBe(lbTarget);
    }
  });

  it('defaults a missing c to None, a missing p to the bare Bar, a missing u to the recipient Primary unit', () => {
    const s = parseLink('v=1&s=comp&b=20kg&m=p', 'lb')!;
    expect(s).toEqual({ set: 'comp', barKg: 20, collarKg: 0, unit: 'lb', mode: 'encode', side: [] });
    expect(parse('v=1&s=comp&b=20kg&m=p')!.unit).toBe('kg');
  });

  it('a By Weight link may omit t', () => {
    const s = parse('v=1&s=comp&b=20kg&m=w&p=25')!;
    expect(s.mode).toBe('decode');
    expect(targetOf(s)).toBeUndefined();
    expect('targetKg' in s).toBe(false);
  });

  it('re-sorts the plates heaviest-first and merges repeated faces', () => {
    const s = parse('v=1&s=comp&b=20kg&m=p&p=2.5,25,10,25')!;
    expect(s.side).toEqual([kg(25), kg(25), kg(10), kg(2.5)]);
    expect(serializeLink(s)).toBe('v=1&s=comp&b=20kg&m=p&c=0&u=kg&p=2x25,10,2.5');
  });

  it('accepts an explicit 1x count and keys in any order', () => {
    const s = parse('t=140&p=1x10,2x25&u=kg&c=0&m=w&b=20kg&s=comp&v=1')!;
    expect(serializeLink(s)).toBe(BASE);
  });

  it('ignores unknown keys (an additive later v1 field) and empty segments', () => {
    expect(serializeLink(parse(`${BASE}&zz=whatever&q`)!)).toBe(BASE);
    expect(serializeLink(parse(`${BASE}&`)!)).toBe(BASE);
    expect(serializeLink(parse(`&${BASE.replace('&s=', '&&s=')}`)!)).toBe(BASE);
  });

  it('tolerates leading and trailing zeros in a decimal, writing the plain value back', () => {
    for (const [c, t] of [['2.50', '0140'], ['02.5', '140.0'], ['2.5', '140.00']] as const) {
      const s = parse(`v=1&s=comp&b=20kg&m=w&c=${c}&u=kg&p=2x25,10&t=${t}`)!;
      expect(serializeLink(s)).toBe('v=1&s=comp&b=20kg&m=w&c=2.5&u=kg&p=2x25,10&t=140');
    }
  });

  it('ignores unknown keys even when duplicated, valueless or badly escaped', () => {
    expect(serializeLink(parse(`${BASE}&zz=1&zz=2&q&q&w=%E0%A4%A`)!)).toBe(BASE);
  });

  it('splits before decoding: an encoded & or = inside a value never becomes a key', () => {
    // Decoding first would read `t=50` out of the unknown key's value.
    const s = parse('v=1&s=comp&b=20kg&m=w&p=25&x=a%26t%3D50')!;
    expect(targetOf(s)).toBeUndefined();
    expect(parse('v=1&s=comp&b=20kg&m=w&%74=50')).toEqual(parse('v=1&s=comp&b=20kg&m=w'));
  });

  it('tolerates a leading # and percent-encoded separators', () => {
    expect(serializeLink(parse(`#${BASE}`)!)).toBe(BASE);
    expect(serializeLink(parse(BASE.replace(',', '%2C'))!)).toBe(BASE);
  });

  it('normalizes t to 2 dp', () => {
    expect(targetOf(parse('v=1&s=comp&b=20kg&m=w&t=100.004'))).toBe(100);
    expect(targetOf(parse('v=1&s=comp&b=20kg&m=w&t=1000'))).toBe(MAX_TARGET_KG);
  });

  it('accepts a Side Load no further Plate fits on', () => {
    // 7 x 25 kg = 406 mm, + 0.5 kg (16 mm) would be 422 > 415; 7 x 58 + 1 kg (19) = 425.
    expect(parse('v=1&s=comp&b=20kg&m=p&p=7x25')).not.toBeNull();
  });
});

describe('parseLink: every rejection is all-or-nothing null (ADR-0014)', () => {
  const rejects: ReadonlyArray<readonly [string, string]> = [
    ['empty fragment', ''],
    ['too long', `${BASE}&x=${'a'.repeat(MAX_LINK_LENGTH)}`],
    ['v missing', 's=comp&b=20kg&m=w&p=25'],
    ['v not 1', BASE.replace('v=1', 'v=2')],
    ['v padded', BASE.replace('v=1', 'v=01')],
    ['duplicate key', `${BASE}&s=comp`],
    ['s missing', 'v=1&b=20kg&m=w'],
    ['s unoffered', BASE.replace('s=comp', 's=bumper')],
    ['b missing', 'v=1&s=comp&m=w'],
    ['b not offered by the set', BASE.replace('b=20kg', 'b=45lb')],
    ['b unstamped', BASE.replace('b=20kg', 'b=20')],
    ['b by kg on the iron bar', 'v=1&s=training&b=20.41kg&m=p'],
    ['m missing', 'v=1&s=comp&b=20kg'],
    ['m unoffered', BASE.replace('m=w', 'm=decode')],
    ['c unoffered', BASE.replace('c=0', 'c=5')],
    ['c empty', BASE.replace('c=0', 'c=')],
    ['c hex', BASE.replace('c=0', 'c=0x0')],
    ['u unoffered', BASE.replace('u=kg', 'u=st')],
    ['u empty', BASE.replace('u=kg', 'u=')],
    ['face not in the set', BASE.replace('p=2x25,10', 'p=2x45')],
    ['iron face on the Eleiko set', 'v=1&s=comp&b=20kg&m=p&p=35'],
    ['kg face on the iron set', 'v=1&s=training&b=45lb&m=p&p=20'],
    ['count 0', BASE.replace('2x25', '0x25')],
    ['count 100', BASE.replace('2x25', '100x25')],
    // Past 2^32 an unbounded count would make Array(n) throw -- the 1..99 bound is what
    // keeps this a null rather than a crash.
    ['count past 2^32', 'v=1&s=comp&b=20kg&m=p&p=4294967296x25'],
    ['count leading zero', BASE.replace('2x25', '02x25')],
    ['count negative', BASE.replace('2x25', '-2x25')],
    ['empty plate token', BASE.replace('2x25,10', '2x25,,10')],
    ['trailing comma', BASE.replace('2x25,10', '2x25,10,')],
    ['Side Load past the Sleeve', 'v=1&s=comp&b=20kg&m=p&p=7x25,0.5'],
    ['many small plates past the Sleeve', 'v=1&s=comp&b=20kg&m=p&p=99x0.5'],
    ['t with m=p', BASE.replace('m=w', 'm=p')],
    ['t zero', BASE.replace('t=140', 't=0')],
    ['t rounds to zero', BASE.replace('t=140', 't=0.004')],
    ['t negative', BASE.replace('t=140', 't=-5')],
    ['t not a number', BASE.replace('t=140', 't=abc')],
    ['t Infinity', BASE.replace('t=140', 't=Infinity')],
    ['t exponent', BASE.replace('t=140', 't=1e2')],
    ['t with a plus sign', BASE.replace('t=140', 't=+5')],
    ['t hex', BASE.replace('t=140', 't=0x10')],
    ['t with a leading space', BASE.replace('t=140', 't=%205')],
    ['t empty', BASE.replace('t=140', 't=')],
    ['t over the cap', BASE.replace('t=140', 't=1000.01')],
    ['known key without =', 'v=1&s=comp&b=20kg&m=w&p'],
    ['malformed percent-encoding in a known value', BASE.replace('p=2x25,10', 'p=2x25%2,10')],
    ['an encoded & inside p stays part of the value', 'v=1&s=comp&b=20kg&m=w&p=25%26t%3D50'],
    ['prototype key as a set', BASE.replace('s=comp', 's=__proto__')],
    ['prototype key as a face', BASE.replace('p=2x25,10', 'p=constructor')],
  ];

  for (const [name, frag] of rejects) {
    it(`rejects: ${name}`, () => {
      expect(parse(frag)).toBeNull();
    });
  }

  it('accepts a link exactly at the length cap', () => {
    const pad = MAX_LINK_LENGTH - BASE.length - '&x='.length;
    const frag = `${BASE}&x=${'a'.repeat(pad)}`;
    expect(frag.length).toBe(MAX_LINK_LENGTH);
    expect(parse(frag)).not.toBeNull();
    expect(parse(`${frag}a`)).toBeNull();
    // The cap counts the fragment after a leading `#` is stripped.
    expect(parse(`#${frag}`)).not.toBeNull();
  });
});

describe('serializeLink: refuses a load it cannot represent exactly (ADR-0014)', () => {
  const ok: LinkState = {
    set: 'training',
    barKg: lbToKg(45),
    collarKg: 0,
    unit: 'lb',
    mode: 'decode',
    side: [lb('45')],
    targetKg: 100,
  };

  it('serializes the valid baseline', () => {
    expect(serializeLink(ok)).toBe('v=1&s=training&b=45lb&m=w&c=0&u=lb&p=45&t=100');
  });

  const refusals: ReadonlyArray<readonly [string, LinkState]> = [
    // 20.4 kg would round to the 45 lb stamp and open as a different Bar.
    ['an off-menu Bar that rounds onto a stamp', { ...ok, barKg: 20.4 }],
    ['a Bar the set does not offer', { ...ok, barKg: 15 }],
    // A red Eleiko 25 would travel as `25` and open as the iron 25 lb.
    ['a Plate from the other set', { ...ok, side: [kg(25)] }],
    ['a Side out of order', { ...ok, side: [lb('25'), lb('45')] }],
    ['a Side past the Sleeve', { ...ok, side: Array<Plate>(9).fill(lb('45')) }],
    ['an unoffered Collar', { ...ok, collarKg: 5 as unknown as 0 }],
    ['a Target that rounds to 0', { ...ok, targetKg: 0.004 }],
    ['a NaN Target', { ...ok, targetKg: NaN }],
    ['a Target over the cap', { ...ok, targetKg: 1200 }],
    ['an unknown Unit', { ...ok, unit: 'st' as unknown as 'kg' }],
    ['an unoffered set', { ...ok, set: 'bumper' as unknown as 'comp' }],
    ['an unknown mode', { ...ok, mode: 'toString' as unknown as 'decode' }],
  ];
  it('reads a null Target (the console has no Target) as absent, never throwing', () => {
    const s = { ...ok, targetKg: null as unknown as number };
    expect(serializeLink(s)).toBe('v=1&s=training&b=45lb&m=w&c=0&u=lb&p=45');
  });

  it('never leaks an invalid Primary unit into a parsed load', () => {
    expect(parseLink('v=1&s=comp&b=20kg&m=p', 'stone' as unknown as 'kg')!.unit).toBe('kg');
  });

  for (const [name, state] of refusals) {
    it(`refuses: ${name}`, () => {
      expect(serializeLink(state)).toBeNull();
      expect(linkUrl(state)).toBeNull();
    });
  }
});
