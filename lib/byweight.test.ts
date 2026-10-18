// Example tests for By Weight's Plate moves caption (RBAR-83). The rules are the
// properties in lib/properties.test.ts; these pin the wording and the track's steps.
import { describe, it, expect } from 'vitest';
import { NO_TRACK, movesCaption, trackLoad } from './byweight.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';

const kg = (...ns: number[]) => ns.map((n) => ELEIKO_KG.find((p) => p.kg === n)!);
const lb = (...ls: string[]) => ls.map((l) => IRON_LB.find((p) => p.label === l)!);

// Load `sides` one after another with the keypad closed; the caption on the last.
function captionAfter(...sides: ReturnType<typeof kg>[]): string | null {
  let t = NO_TRACK;
  for (const s of sides) t = trackLoad(t, s, false);
  return movesCaption(t, sides[sides.length - 1], 'kg');
}

describe('movesCaption (RBAR-83)', () => {
  it("reads in Warm up's words: on only, off only, and off then on", () => {
    expect(captionAfter(kg(25, 20), kg(25, 20, 2.5))).toBe('+2.5 kg');
    expect(captionAfter(kg(25, 20, 2.5), kg(25, 20))).toBe('-2.5 kg');
    expect(captionAfter(kg(25, 20, 1), kg(25, 20, 2.5, 2))).toBe('off 1, on 2.5 + 2 kg');
  });

  it('names lb Plates by their stamp', () => {
    let t = trackLoad(NO_TRACK, lb('45'), false);
    t = trackLoad(t, lb('45', '10'), false);
    expect(movesCaption(t, lb('45', '10'), 'lb')).toBe('+10 lb');
  });

  it('shows none for the first load, from a bare Bar, to a bare Bar, or when the Plates did not change', () => {
    expect(captionAfter(kg(25))).toBeNull();
    expect(captionAfter([], kg(25))).toBeNull();
    expect(captionAfter(kg(25), [])).toBeNull();
    expect(captionAfter(kg(25, 5), kg(25, 5))).toBeNull(); // a re-solve to the same Plates
  });

  it('keeps the caption on a re-render of the same load, and measures the next load from it', () => {
    const a = kg(25);
    const b = kg(25, 5);
    let t = trackLoad(trackLoad(NO_TRACK, a, false), b, false);
    t = trackLoad(t, b, false); // a re-render (a unit toggle that kept the Plates)
    expect(movesCaption(t, b, 'kg')).toBe('+5 kg');
    const c = kg(25, 10);
    t = trackLoad(t, c, false);
    expect(movesCaption(t, c, 'kg')).toBe('off 5, on 10 kg');
  });

  it('holds the load before the keypad opened while digits are typed', () => {
    const before = kg(25, 20, 2.5); // 115 kg on a 20 kg Bar
    let t = trackLoad(NO_TRACK, before, false);
    t = trackLoad(t, kg(), true); // "1": under the Bar, a bare Bar
    t = trackLoad(t, kg(), true); // "11": still bare
    const after = kg(25, 20, 2.5, 0.5); // "116"
    t = trackLoad(t, after, true);
    expect(movesCaption(t, after, 'kg')).toBe('+0.5 kg');
    t = trackLoad(t, after, false); // Done
    expect(movesCaption(t, after, 'kg')).toBe('+0.5 kg');
  });

  it('forgets everything outside By Weight', () => {
    let t = trackLoad(trackLoad(NO_TRACK, kg(25), false), kg(25, 5), false);
    t = trackLoad(t, null, false);
    expect(t).toEqual(NO_TRACK);
    t = trackLoad(t, kg(25, 5), false);
    expect(movesCaption(t, kg(25, 5), 'kg')).toBeNull();
  });
});
