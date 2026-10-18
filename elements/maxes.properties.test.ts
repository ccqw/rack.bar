// Property-based invariants for saved maxes in the shell (RBAR-84, ADR-0020), driven
// through the real input paths: the keypad's lift row and digits, the steppers, and the
// `maxes` list the app feeds the console. Expected values come from the pure core
// (lib/maxes.ts, itself pinned by lib/properties.test.ts) and the ADR-0003 rule, never
// from the shell under test. Deterministic: a fixed seed and modest run counts.
import { beforeEach, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { percentOfMax } from '../lib/maxes.ts';
import type { Max } from '../lib/maxes.ts';
import { format } from '../lib/units.ts';
import {
  SEED, askedText, done, entryRoot, fresh, heroTap, press, q, resetPool, rigArb, statusKind,
  step, unitArb,
} from './properties.drivers.ts';

type WithMaxes = HTMLElement & { maxes: readonly Max[] };

const maxArb: fc.Arbitrary<Max> = fc.record({
  name: fc.constantFrom('Squat', 'Bench', 'Deadlift', 'Front squat'),
  // 60-400 in its Unit, so every percent below lands over any rig's bare baseline.
  value: fc.integer({ min: 120, max: 800 }).map((h) => h / 2),
  unit: unitArb,
});
// A percent as the keypad types it: 50-150, at most one decimal.
const pctArb = fc.integer({ min: 500, max: 1500 }).map((t) => t / 10);

// Open the keypad, pick `name` in the lift row, type `pct`, and close: the real path.
function typePercent(el: HTMLElement, name: string, pct: number): void {
  heroTap(el).click();
  q<HTMLButtonElement>(entryRoot(el), `[data-lift="${name}"]`).click();
  for (const ch of String(pct)) press(el, ch);
  done(el);
}
const link = (el: HTMLElement) =>
  (q(el.shadowRoot!, 'rack-entry') as HTMLElement & { link: { name: string; pct: number } | null }).link;

beforeEach(() => resetPool());

describe('saved maxes in the console (RBAR-84, ADR-0020)', () => {
  it('a Target typed as a percent of a saved max is that share of it, Decode lands at or under it, and the chip names the lift (RBAR-84, ADR-0020, ADR-0003)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, maxArb, pctArb, (rig, u, max, pct) => {
        const el = fresh(rig, u) as unknown as WithMaxes;
        el.maxes = [max];
        let seen: number | null = null;
        el.addEventListener('target', (e) => {
          seen = (e as CustomEvent<{ target: number | null }>).detail.target;
        });
        typePercent(el, max.name, pct);
        const want = percentOfMax(max, pct)!;
        expect(seen).toBe(want);
        expect(link(el)).toEqual({ name: max.name, pct });
        expect(statusKind(el)).not.toContain('over');
        const chip = askedText(el)!.replace(/\s+/g, ' ').trim();
        expect([`${pct}% ${max.name}`, `${pct}% ${max.name} = ${format(want, u)}`]).toContain(chip);
      }),
      { seed: SEED, numRuns: 25 },
    );
  });

  it('a linked Target follows its max: a new max re-reads the same percent of it, and any other edit drops the link (RBAR-84, ADR-0020)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, maxArb, pctArb, fc.integer({ min: 1, max: 40 }), (rig, u, max, pct, up) => {
        const el = fresh(rig, u) as unknown as WithMaxes;
        el.maxes = [max];
        typePercent(el, max.name, pct);
        let seen: number | null = null;
        el.addEventListener('target', (e) => {
          seen = (e as CustomEvent<{ target: number | null }>).detail.target;
        });
        const pr = { ...max, value: max.value + up };
        el.maxes = [pr];
        expect(seen).toBe(percentOfMax(pr, pct));
        expect(link(el)).toEqual({ name: max.name, pct });
        step(el, 'inc');
        expect(link(el)).toBeNull();
      }),
      { seed: SEED, numRuns: 20 },
    );
  });

  it('removing the linked lift keeps the Target and drops the link; only an Undo of it brings the link back, never a new lift of that name (RBAR-84, ADR-0020)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, maxArb, pctArb, fc.boolean(), (rig, u, max, pct, undo) => {
        const el = fresh(rig, u) as unknown as WithMaxes & { restoreLift(n: string): void };
        el.maxes = [max];
        typePercent(el, max.name, pct);
        let emitted = 0;
        el.addEventListener('target', () => emitted++);
        el.maxes = [];
        expect(link(el)).toBeNull();
        expect(emitted).toBe(0); // the number stays: nothing is re-decoded
        el.maxes = [max];
        expect(link(el)).toBeNull(); // the same name back is not, by itself, an Undo
        expect(emitted).toBe(0);
        if (undo) {
          el.restoreLift(max.name);
          expect(link(el)).toEqual({ name: max.name, pct });
        }
      }),
      { seed: SEED, numRuns: 15 },
    );
  });
});
