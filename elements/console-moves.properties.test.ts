// Property-based invariants for By Weight's Plate moves caption (RBAR-83), driven
// through the real input paths -- the Target keypad (open, type, Done), the hero
// steppers, the round-up, a tap on the bar for another way, and a Recent chip -- and
// judged from what is on screen. The caption is Warm up's (lib/warmup.ts deltaText over
// lib/moves.ts movesBetween, ADR-0015 as amended), so it is judged the same way: read
// literally, it rebuilds the new Side from the one before. See
// console-state.properties.test.ts for the conventions.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { decode } from '../lib/decode.ts';
import { waysFor } from '../lib/ways.ts';
import { draftToKg } from '../lib/units.ts';
import { plateFace } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';
import { PLATE_SETS } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import {
  SEED, on, fresh, q, sr, type, step, heroTap, done, roundUp, modeBtn, rigDraftCaseArb,
  rigArb, unitArb, draftArb, captionText, facesOnScreen, followCaption, sideOnScreen,
} from './properties.drivers.ts';
import type { Console } from './properties.drivers.ts';

// The Side on screen as stamped faces of `inventory` (the active set's, after a switch).
const facesOn = (inventory: readonly Plate[], el: HTMLElement): string[] =>
  sideOnScreen(el).map((d) => plateFace(inventory.find((p) => Math.abs(p.kg - d.kg) < 1e-9)!));

type Act =
  | { readonly kind: 'target'; readonly draft: string }
  | { readonly kind: 'step'; readonly dir: 'inc' | 'dec' }
  | { readonly kind: 'roundup' }
  | { readonly kind: 'way' }
  | { readonly kind: 'recent'; readonly at: number };

// One lifter action in By Weight that can load a new Side. A Target is typed on the
// keypad the way a lifter does (open, Clear, digits, Done), so the digits typed on the
// way never count as a load of their own.
function act(el: Console, a: Act): void {
  if (a.kind === 'target') {
    heroTap(el).click();
    type(el, a.draft);
    done(el);
  } else if (a.kind === 'step') step(el, a.dir);
  else if (a.kind === 'roundup') {
    if (!roundUp(el).hidden) roundUp(el).click();
  } else if (a.kind === 'way') {
    const bar = q<HTMLElement>(sr(el), 'rack-sleeve');
    if (bar.getAttribute('role') === 'button') bar.click();
  } else {
    const chips = [...sr(q(sr(el), 'rack-recents')).querySelectorAll<HTMLElement>('[data-target]')];
    if (chips.length > 0) chips[a.at % chips.length].click();
  }
}

const actsArb = (drafts: fc.Arbitrary<string>): fc.Arbitrary<Act[]> =>
  fc.array(
    fc.oneof(
      { weight: 4, arbitrary: drafts.map((draft) => ({ kind: 'target', draft }) as const) },
      {
        weight: 3,
        arbitrary: fc.constantFrom('inc', 'dec').map((dir) => ({ kind: 'step', dir }) as const),
      },
      { weight: 1, arbitrary: fc.constant({ kind: 'roundup' } as const) },
      { weight: 2, arbitrary: fc.constant({ kind: 'way' } as const) },
      { weight: 1, arbitrary: fc.nat(5).map((at) => ({ kind: 'recent', at }) as const) },
    ),
    { minLength: 1, maxLength: 6 },
  );

// Any typed Target, weighted toward the everyday range where a small change of Target
// is a small change of Plates (the case the caption is for).
const draftsArb = fc.oneof(draftArb, fc.integer({ min: 20, max: 250 }).map(String));
const caseArb = fc.tuple(rigArb, unitArb, actsArb(draftsArb));

describe('<rack-console> By Weight Plate moves caption (RBAR-83, ADR-0015)', () => {
  it('following the moves caption literally rebuilds the new Side from the previous one; it shows exactly when Plates were on the bar before and after and they changed (RBAR-83, ADR-0015 as amended)', () => {
    fc.assert(
      fc.property(caseArb, ([rig, u, acts]) => {
        const el = on(rig, u);
        for (const a of acts) {
          const before = facesOnScreen(rig, el);
          act(el, a);
          const after = facesOnScreen(rig, el);
          const cap = captionText(el);
          const changed = JSON.stringify(before) !== JSON.stringify(after);
          expect(cap !== null).toBe(before.length > 0 && after.length > 0 && changed);
          if (cap !== null) expect(followCaption(before, cap)).toEqual(after);
        }
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('a Setup change or an opened share link is not a lifter move: no caption for its load, and the next move is measured from it (RBAR-83, ADR-0010, ADR-0014)', () => {
    type Setup = 'bar' | 'set' | 'onhand' | 'link';
    fc.assert(
      fc.property(
        rigArb, unitArb, draftsArb, draftsArb,
        fc.constantFrom<Setup>('bar', 'set', 'onhand', 'link'),
        (rig, u, first, second, change) => {
          const el = fresh(rig, u) as Console & {
            applyLink(l: unknown): void;
            platesOnHand: unknown;
          };
          heroTap(el).click();
          type(el, first);
          done(el);
          step(el, 'inc');
          const inv = () => PLATE_SETS[el.plateSet as PlateSetKey].inventory;
          if (change === 'bar') el.barKg = rig.barKg === 20 ? 15 : 20;
          else if (change === 'set') el.plateSet = rig.set === 'comp' ? 'training' : 'comp';
          else if (change === 'onhand') {
            el.platesOnHand = { [rig.set]: { [plateFace(rig.inventory[0])]: 1 } };
          } else {
            // A link to another way of another Target: its Plates, from the set itself.
            const t = draftToKg(second, u) ?? 0;
            const ways = waysFor(decode(t, rig.baselineKg, rig.inventory).primary.side, rig.inventory);
            el.applyLink({ mode: 'decode', side: ways[ways.length - 1], targetKg: t, unit: u });
          }
          expect(captionText(el)).toBeNull();
          const before = facesOn(inv(), el);
          step(el, 'inc');
          const after = facesOn(inv(), el);
          const cap = captionText(el);
          const changed = JSON.stringify(before) !== JSON.stringify(after);
          expect(cap !== null).toBe(before.length > 0 && after.length > 0 && changed);
          if (cap !== null) expect(followCaption(before, cap)).toEqual(after);
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('the caption never carries across modes: back in By Weight, the carried load shows none (RBAR-83, ADR-0005)', () => {
    fc.assert(
      fc.property(rigDraftCaseArb, fc.constantFrom('encode', 'warmup'), ([rig, u, draft], m) => {
        const el = on(rig, u);
        heroTap(el).click();
        type(el, draft);
        done(el);
        step(el, 'inc');
        modeBtn(el, m).click();
        modeBtn(el, 'decode').click();
        expect(captionText(el)).toBeNull();
      }),
      { seed: SEED, numRuns: 20 },
    );
  });
});
