// Property-based invariants for By Weight's Plate moves caption (RBAR-83), driven
// through the real input paths -- the Target keypad (open, type, Done), the hero
// steppers, the round-up, a tap on the bar for another way, and a Recent chip -- and
// judged from what is on screen. The caption is Warm up's (lib/warmup.ts deltaText over
// lib/moves.ts movesBetween, ADR-0015 as amended), so it is judged the same way: read
// literally, it rebuilds the new Side from the one before. See
// console-state.properties.test.ts for the conventions.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  SEED, on, q, sr, type, step, heroTap, done, roundUp, modeBtn, rigDraftCaseArb, rigArb,
  unitArb, draftArb, captionText, facesOnScreen, followCaption,
} from './properties.drivers.ts';
import type { Console } from './properties.drivers.ts';

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
