// Property-based invariant for the screen wake lock (RBAR-80), driven through the REAL
// input paths -- the mode toggle, the fullscreen control, the card's close, and the
// page hiding and coming back -- and judged from the browser's side (a stubbed
// navigator.wakeLock counting live locks).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { SEED, fresh, resetPool, q, sr, modeBtn } from './properties.drivers.ts';
import { RIGS } from '../lib/properties.oracle.ts';
import { stubWakeLock, flush } from './wakelock.stub.ts';
import type { WakeStub } from './wakelock.stub.ts';

type Step = 'decode' | 'encode' | 'warmup' | 'open' | 'close' | 'hide-show';
const stepArb = fc.constantFrom<Step>('decode', 'encode', 'warmup', 'open', 'close', 'hide-show');

let stub: WakeStub;
beforeEach(() => {
  resetPool();
  stub = stubWakeLock();
});
afterEach(() => {
  resetPool(); // detaches the console, which lets go of any lock
  stub.restore();
});

describe('wake lock properties (RBAR-80)', () => {
  it('the screen lock is held exactly while fullscreen or Warm up is showing (RBAR-80)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { maxLength: 12 }), async (steps) => {
        const el = fresh(RIGS[0], 'kg');
        const card = q<HTMLElement & { close(): void }>(sr(el), 'rack-fullscreen');
        let mode: Step = 'decode';
        let open = false;
        for (const s of steps) {
          if (s === 'decode' || s === 'encode' || s === 'warmup') {
            modeBtn(el, s).click();
            mode = s;
          } else if (s === 'open') {
            q<HTMLButtonElement>(sr(el), '[data-fullscreen]').click();
            open = true;
          } else if (s === 'close') {
            if (open) card.close();
            open = false;
          } else {
            stub.hide();
            stub.show();
          }
          await flush();
          expect(stub.live).toBe(mode === 'warmup' || open ? 1 : 0);
        }
        resetPool();
        await flush();
        expect(stub.live).toBe(0);
      }),
      { seed: SEED, numRuns: 40 },
    );
  });
});
