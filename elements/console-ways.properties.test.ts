// Property-based invariants for Another way (RBAR-66) on the console shell, driven
// through the real input paths -- keypad, steppers, the round-up button, the kg|lb
// toggle and taps on the bar itself -- and judged from what is on screen. Expected ways
// come from the brute-force oracle (lib/properties.oracle.ts waysOracle), never from
// lib/ways.ts. The core counterparts are lib/properties.test.ts "Another way
// properties". See console-state.properties.test.ts for the conventions.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { waysOracle } from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import { MAX_WAYS } from '../lib/ways.ts';
import {
  SEED, EPS, other, on, q, sr, unitBtn, step, type, roundUp, totalText, statusKind,
  sideOnScreen, drawnTotalKg, rigDraftCaseArb,
} from './properties.drivers.ts';

const bar = (el: HTMLElement) => q<HTMLElement>(sr(el), 'rack-sleeve');
const pill = (el: HTMLElement) => q<HTMLButtonElement>(sr(el), '[data-another]');
const count = (el: HTMLElement) => q(sr(el), '[data-another-count]').textContent ?? '';
const shape = (side: readonly { kg: number; color: string }[]) =>
  side.map((p) => `${p.kg}/${p.color}`).join(',');
// The oracle's ways for the Side on screen: every heaviest-first stack of the same sum.
function oracleWays(el: HTMLElement, rig: Rig): string[] {
  const sideKg = sideOnScreen(el).reduce((s, p) => s + p.kg, 0);
  return waysOracle(rig.inventory, sideKg, MAX_WAYS).map(shape);
}

describe('<rack-console> Another way properties (RBAR-66, ADR-0003)', () => {
  it('tapping the bar steps through exactly the oracle ways in rank order and wraps; the Total and status never move (RBAR-66, ADR-0003, ADR-0012)', () => {
    fc.assert(
      fc.property(rigDraftCaseArb, ([rig, u, draft]) => {
        const el = on(rig, u);
        type(el, draft);
        const want = oracleWays(el, rig);
        const total = totalText(el);
        const kind = statusKind(el);
        expect(shape(sideOnScreen(el))).toBe(want[0]);
        // Interactive exactly when there is somewhere to step to.
        expect(bar(el).getAttribute('role')).toBe(want.length > 1 ? 'button' : null);
        expect(pill(el).hidden).toBe(want.length <= 1);
        const seen = [];
        for (let i = 0; i < want.length; i++) {
          bar(el).click();
          seen.push(shape(sideOnScreen(el)));
          expect(totalText(el)).toBe(total);
          expect(statusKind(el)).toBe(kind);
          const at = (i + 1) % want.length;
          expect(count(el)).toBe(at > 0 ? `${at + 1}/${want.length}` : '');
        }
        expect(seen).toEqual([...want.slice(1), want[0]]);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('any re-solve -- a typed Target, a stepper, Round up or back -- starts on the first way (RBAR-66)', () => {
    const actionArb = fc.constantFrom('retype', 'inc', 'dec', 'roundup');
    fc.assert(
      fc.property(rigDraftCaseArb, fc.integer({ min: 1, max: 4 }), actionArb, ([rig, u, draft], taps, action) => {
        const el = on(rig, u);
        type(el, draft);
        for (let i = 0; i < taps; i++) bar(el).click();
        if (action === 'retype') type(el, draft);
        else if (action === 'roundup') {
          if (roundUp(el).hidden) return;
          roundUp(el).click();
        } else step(el, action);
        expect(count(el)).toBe('');
        const want = oracleWays(el, rig);
        expect(shape(sideOnScreen(el))).toBe(want[0]);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('a kg|lb toggle keeps the way on the Bar when the Total holds, else starts on the first way (RBAR-66, ADR-0010 RBAR-60)', () => {
    fc.assert(
      fc.property(rigDraftCaseArb, fc.integer({ min: 0, max: 4 }), ([rig, u, draft], taps) => {
        const el = on(rig, u);
        type(el, draft);
        for (let i = 0; i < taps; i++) bar(el).click();
        const before = shape(sideOnScreen(el));
        const beforeKg = drawnTotalKg(el, rig);
        const beforeCount = count(el);
        unitBtn(el, other(u)).click();
        if (Math.abs(drawnTotalKg(el, rig) - beforeKg) < EPS) {
          expect(shape(sideOnScreen(el))).toBe(before);
          expect(count(el)).toBe(beforeCount);
        } else {
          expect(count(el)).toBe('');
          expect(shape(sideOnScreen(el))).toBe(oracleWays(el, rig)[0]);
        }
      }),
      { seed: SEED, numRuns: 60 },
    );
  });
});
