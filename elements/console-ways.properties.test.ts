// Property-based invariants for Another way (RBAR-66) on the console shell, driven
// through the real input paths -- keypad, steppers, the round-up button, the kg|lb
// toggle and taps on the bar itself -- and judged from what is on screen. Expected ways
// come from the brute-force oracle (lib/properties.oracle.ts waysOracle), never from
// lib/ways.ts. The core counterparts are lib/properties.test.ts "Another way
// properties". See console-state.properties.test.ts for the conventions.
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import './app.ts';
import { waysOracle } from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import { MAX_WAYS } from '../lib/ways.ts';
import {
  SEED, EPS, other, on, fresh, q, sr, unitBtn, step, type, roundUp, totalText, statusKind,
  sideOnScreen, drawnTotalKg, rigDraftCaseArb, entryDraft,
} from './properties.drivers.ts';
import type { Console } from './properties.drivers.ts';

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
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

  // The whole trip (ADR-0014): the sender types a Target, maybe takes the round-up, taps
  // the bar 0-4 times, then Copy link; that exact URL boots a fresh app. The recipient
  // must see the way the sender loaded -- the same Plates and the same n/m -- not the
  // canonical stack. Last in the file: it mounts fresh pages (fresh() drops the pool).
  it('Copy link carries the way actually loaded: the recipient shows the same Plates and n/m (RBAR-66, ADR-0014)', () => {
    fc.assert(
      fc.property(rigDraftCaseArb, fc.boolean(), fc.integer({ min: 0, max: 4 }), ([rig, u, draft], takeRoundUp, taps) => {
        const sender = fresh(rig, u);
        type(sender, draft);
        if (takeRoundUp && !roundUp(sender).hidden) roundUp(sender).click();
        for (let i = 0; i < taps; i++) bar(sender).click();
        const seen = {
          side: sideOnScreen(sender),
          count: count(sender),
          total: totalText(sender),
          status: statusKind(sender),
          draft: entryDraft(sender),
        };
        q<HTMLButtonElement>(sr(sender), '[data-share]').click();
        const copyLink = q<HTMLButtonElement>(sr(q(sr(sender), 'rack-share')), '[data-link]');
        fc.pre(!copyLink.disabled); // a 0 kg Target has no link (covered elsewhere)
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        try {
          copyLink.click();
        } finally {
          vi.unstubAllGlobals();
        }
        const url = writeText.mock.calls[0]![0] as string;
        localStorage.clear();
        history.replaceState(null, '', `/${url.slice(url.indexOf('#'))}`);
        document.body.innerHTML = '';
        const app = document.createElement('rack-app');
        document.body.append(app);
        const c = q<Console>(sr(app), 'rack-console');
        expect({
          side: sideOnScreen(c),
          count: count(c),
          total: totalText(c),
          status: statusKind(c),
          draft: entryDraft(c),
        }).toEqual(seen);
        history.replaceState(null, '', '/');
      }),
      { seed: SEED, numRuns: 60, endOnFailure: true },
    );
  }, 30_000);
});
