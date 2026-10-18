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

  // ----- Build the bar (RBAR-101) -----
  const buildArb = fc.record({
    c: caseArb,
    // Palette taps by key index, with an Undo after some.
    taps: fc.array(fc.record({ key: fc.nat(), undo: fc.boolean() }), { maxLength: 10 }),
    // Pairs on hand per size (or unlimited), so the palette holds the limits.
    caps: fc.array(fc.oneof(fc.integer({ min: 0, max: 2 }), fc.constant(-1)), {
      minLength: 10,
      maxLength: 10,
    }),
  });
  function mountBuild(c: Case, caps: number[] | null): { el: Quiz; root: ShadowRoot } {
    const set = PLATE_SETS[c.set];
    localStorage.clear();
    localStorage.setItem('rackbar.plateSet', c.set);
    localStorage.setItem('rackbar.barKg', String(set.bars[c.barIndex % set.bars.length].kg));
    localStorage.setItem('rackbar.collarKg', String(c.collarKg));
    localStorage.setItem('rackbar.quiz', JSON.stringify({ mode: 'build', settings: { collars: c.collars } }));
    if (caps) {
      const limits = Object.fromEntries(
        set.inventory
          .map((p, i) => [p.label ?? String(p.kg), caps[i % caps.length]] as const)
          .filter(([, n]) => n >= 0),
      );
      localStorage.setItem('rackbar.platesOnHand', JSON.stringify({ [c.set]: limits }));
    }
    document.body.innerHTML = '';
    const el = document.createElement('rack-quiz') as Quiz;
    el.setAttribute('seed', String(c.seed));
    document.body.append(el);
    return { el, root: el.shadowRoot! };
  }
  const paletteKeys = (root: ShadowRoot) => [
    ...root.querySelector('rack-palette')!.shadowRoot!.querySelectorAll<HTMLButtonElement>('.key'),
  ];

  it("tapping the Target's fewest Side onto the palette and Checking scores right (RBAR-101, ADR-0003)", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { el, root } = mountBuild(c, null);
        const q = el.question!;
        const keys = paletteKeys(root);
        for (const p of q.side) keys.find((k) => k.dataset.kg === String(p.kg))!.click();
        const sleeve = root.querySelector('rack-sleeve') as Sleeve;
        expect(sleeve.sideLoad.map((p) => p.kg)).toEqual(q.side.map((p) => p.kg));
        expect(sleeve.collars).toBe(q.collarKg > 0);
        root.querySelector<HTMLButtonElement>('[data-check]')!.click();
        expect(phase(root)).toBe('right');
        expect(root.querySelector('[data-streak]')!.textContent).toBe('1');
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('any Side tapped on the palette is right exactly when Bar + 2 x Collar + 2 x Side is the Target; the taps hold the Sleeve and the Plate limits (RBAR-101, ADR-0008, ADR-0012, ADR-0016)', () => {
    fc.assert(
      fc.property(buildArb, fc.boolean(), ({ c, taps, caps }, limited) => {
        const { el, root } = mountBuild(c, limited ? caps : null);
        const q = el.question!;
        const sleeve = root.querySelector('rack-sleeve') as Sleeve;
        for (const t of taps) {
          const keys = paletteKeys(root);
          keys[t.key % keys.length].click();
          if (t.undo) root.querySelector<HTMLButtonElement>('[data-undo]')!.click();
        }
        const side = sleeve.sideLoad;
        // Heaviest first, within the Sleeve, and never past a size's pairs on hand.
        expect([...side].sort((a, b) => b.kg - a.kg)).toEqual(side);
        expect(side.reduce((mm, p) => mm + p.widthMm, 0)).toBeLessThanOrEqual(415 + 1e-9);
        const inv = (root.querySelector('rack-palette') as HTMLElement & {
          inventory: readonly (Plate & { maxPerSide?: number })[];
        }).inventory;
        for (const p of inv) {
          const on = side.filter((x) => x.kg === p.kg).length;
          expect(on).toBeLessThanOrEqual(p.maxPerSide ?? Infinity);
        }
        const go = root.querySelector<HTMLButtonElement>('[data-check]')!;
        if (side.length === 0) {
          expect(go.disabled).toBe(true);
          return;
        }
        go.click();
        const totalKg = q.barKg + 2 * q.collarKg + 2 * side.reduce((s, p) => s + p.kg, 0);
        const right = Math.abs(totalKg - q.totalKg) < 1e-6;
        expect(phase(root)).toBe(right ? 'right' : 'wrong');
        if (!right) {
          expect(root.querySelector('[data-why]')!.textContent).not.toBe('');
          expect(root.querySelector('[data-oneway]')).not.toBeNull();
        }
      }),
      { seed: SEED, numRuns: 60 },
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
