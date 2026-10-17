// Property-based invariants for Another way (RBAR-66) on the console shell, driven
// through the real input paths -- keypad, steppers, the round-up button, the kg|lb
// toggle and taps on the bar itself -- and judged from what is on screen. Expected ways
// come from the brute-force oracle (lib/properties.oracle.ts waysOracle), never from
// lib/ways.ts. The core counterparts are lib/properties.test.ts "Another way
// properties". See console-state.properties.test.ts for the conventions.
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import './app.ts';
import { RIGS, waysOracle } from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import type { Unit } from '../lib/units.ts';
import { MAX_WAYS } from '../lib/ways.ts';
import {
  SEED, EPS, other, on, q, sr, unitBtn, step, type, roundUp, totalText, statusKind,
  sideOnScreen, drawnTotalKg, rigDraftCaseArb, entryDraft, nextRun,
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

// RBAR-90: 30 random runs each, plus pinned cases with many ways (a full comp Side, a
// training load) so the stepping is always exercised, not left to the draw.
const RUNS = { seed: SEED, numRuns: 30 };
type Case = readonly [Rig, Unit, string];
const MANY_WAYS: readonly [Case, Case] = [
  [RIGS[0]!, 'kg', '180'],
  [RIGS[6]!, 'lb', '315'],
];

describe('<rack-console> Another way properties (RBAR-66, ADR-0003)', () => {
  it('tapping the bar steps through exactly the oracle ways in rank order and wraps; the Total and status never move (RBAR-66, ADR-0003, ADR-0012)', async () => {
    await fc.assert(
      fc.asyncProperty(rigDraftCaseArb, async ([rig, u, draft]) => {
        await nextRun();
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
      { ...RUNS, examples: MANY_WAYS.map((c): [Case] => [c]) },
    );
  });

  it('any re-solve -- a typed Target, a stepper, Round up or back -- starts on the first way (RBAR-66)', async () => {
    const actionArb = fc.constantFrom('retype', 'inc', 'dec', 'roundup');
    await fc.assert(
      fc.asyncProperty(rigDraftCaseArb, fc.integer({ min: 1, max: 4 }), actionArb, async ([rig, u, draft], taps, action) => {
        await nextRun();
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
      {
        ...RUNS,
        examples: [
          [MANY_WAYS[0], 2, 'retype'],
          [MANY_WAYS[1], 3, 'inc'],
          [MANY_WAYS[0], 1, 'dec'],
          [[RIGS[1]!, 'kg', '142.3'], 2, 'roundup'],
        ],
      },
    );
  });

  it('a kg|lb toggle keeps the way on the Bar when the Total holds, else starts on the first way (RBAR-66, ADR-0010 RBAR-60)', async () => {
    await fc.assert(
      fc.asyncProperty(rigDraftCaseArb, fc.integer({ min: 0, max: 4 }), async ([rig, u, draft], taps) => {
        await nextRun();
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
      { ...RUNS, examples: [[MANY_WAYS[0], 2], [MANY_WAYS[1], 3]] },
    );
  });

  // The whole trip (ADR-0014): the sender types a Target, maybe takes the round-up, taps
  // the bar 0-4 times, then Copy link; that exact URL boots a fresh app. The recipient
  // must see the way the sender loaded -- the same Plates and the same n/m -- not the
  // canonical stack. The sender is the pooled console (on() resets it with Clear); only
  // the recipient app is mounted fresh each run, and only the previous one is removed.
  it('Copy link carries the way actually loaded: the recipient shows the same Plates and n/m (RBAR-66, ADR-0014)', async () => {
    await fc.assert(
      fc.asyncProperty(rigDraftCaseArb, fc.boolean(), fc.integer({ min: 0, max: 4 }), async ([rig, u, draft], takeRoundUp, taps) => {
        await nextRun();
        const sender = on(rig, u);
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
        // Close the card so the pooled sender is back to a bare console for the next run.
        q<HTMLButtonElement>(sr(q(sr(sender), 'rack-share')), '[data-close]').click();
        localStorage.clear();
        history.replaceState(null, '', `/${url.slice(url.indexOf('#'))}`);
        for (const old of document.querySelectorAll('rack-app')) old.remove();
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
      {
        ...RUNS,
        endOnFailure: true,
        examples: [
          [MANY_WAYS[0], false, 3],
          [MANY_WAYS[1], false, 2],
          [[RIGS[1]!, 'kg', '142.3'], true, 1],
        ],
      },
    );
  });
});
