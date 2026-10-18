// Shell-side properties for the Loadout quiz (RBAR-92), through the real input paths:
// the stored Setup rig and the on-screen keypad. The core rules are pinned against the
// oracle in lib/properties.test.ts; these check the page wires them through.
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import './quiz.ts';
import { PLATE_SETS, PLATE_SET_KEYS } from '../lib/platesets.ts';
import type { Question } from '../lib/quiz.ts';
import type { Plate } from '../lib/plates.ts';

type Quiz = HTMLElement & { question: Question | null };
type Sleeve = HTMLElement & { sideLoad: readonly Plate[]; collars: boolean; numerals: boolean };

const SEED = 92;

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

// Every set x Bar x Collar Setup offers, and a seed for the list.
const caseArb = fc.record({
  set: fc.constantFrom(...PLATE_SET_KEYS),
  barIndex: fc.nat({ max: 2 }),
  collarKg: fc.constantFrom(0, 2.5),
  collars: fc.constantFrom('off', 'some', 'always'),
  seed: fc.integer({ min: 0, max: 1_000_000 }),
  wrongBy: fc.integer({ min: 1, max: 40 }),
});
type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

function mount(c: Case): { el: Quiz; root: ShadowRoot } {
  localStorage.clear();
  const bars = PLATE_SETS[c.set].bars;
  localStorage.setItem('rackbar.plateSet', c.set);
  localStorage.setItem('rackbar.barKg', String(bars[c.barIndex % bars.length].kg));
  localStorage.setItem('rackbar.collarKg', String(c.collarKg));
  localStorage.setItem('rackbar.quiz', JSON.stringify({ settings: { collars: c.collars } }));
  document.body.innerHTML = '';
  const el = document.createElement('rack-quiz') as Quiz;
  el.setAttribute('seed', String(c.seed));
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

const typeOn = (root: ShadowRoot, s: string) =>
  [...s].forEach((k) => root.querySelector<HTMLButtonElement>(`[data-key="${k}"]`)!.click());
const check = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('[data-go]')!.click();
const phase = (root: ShadowRoot) => root.querySelector<HTMLElement>('[data-viz]')!.dataset.phase;

describe('Loadout quiz shell properties (RBAR-92)', () => {
  it('typing the shown Total on the keypad scores right; any other Total scores wrong and is explained (RBAR-92)', () => {
    fc.assert(
      fc.property(caseArb, fc.boolean(), (c, right) => {
        const { el, root } = mount(c);
        const q = el.question!;
        const typed = right ? q.totalShown : q.totalShown + c.wrongBy;
        typeOn(root, String(typed));
        check(root);
        expect(phase(root)).toBe(right ? 'right' : 'wrong');
        expect(root.querySelector('[data-streak]')!.textContent).toBe(right ? '1' : '0');
        if (!right) {
          expect(root.querySelector('[data-why]')!.textContent).not.toBe('');
          expect(root.querySelector('[data-math]')!.textContent).toContain(`= ${q.totalShown} ${q.unit}`);
        }
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  it("the quiz bar draws the question's Side, and a Collar only when Setup has Collars on the kg set, never on a bare Bar (RBAR-92, ADR-0008)", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { el, root } = mount(c);
        const q = el.question!;
        const sleeve = root.querySelector('rack-sleeve') as Sleeve;
        expect(sleeve.sideLoad).toEqual(q.side);
        expect(sleeve.sideLoad.length).toBeGreaterThan(0);
        expect(sleeve.collars).toBe(q.collarKg > 0);
        if (sleeve.collars) {
          expect(c.collarKg).toBe(2.5);
          expect(PLATE_SETS[c.set].unit).toBe('kg');
          expect(c.collars).not.toBe('off');
        }
      }),
      { seed: SEED, numRuns: 40 },
    );
  });
});
