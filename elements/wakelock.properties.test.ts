// Property-based invariant for the screen wake lock (RBAR-80), driven through the REAL
// input paths -- the mode toggle, the fullscreen control, the card's close, the page
// hiding and coming back, and the browser dropping the lock while visible -- and judged
// from the browser's side (a stubbed navigator.wakeLock counting live locks).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { SEED, fresh, resetPool, q, sr, modeBtn } from './properties.drivers.ts';
import { RIGS } from '../lib/properties.oracle.ts';
import { stubWakeLock, flush } from './wakelock.stub.ts';
import type { WakeStub } from './wakelock.stub.ts';

type Action = 'decode' | 'encode' | 'warmup' | 'open' | 'close' | 'hide' | 'show' | 'drop';
const actionArb = fc.constantFrom<Action>(
  'decode', 'encode', 'warmup', 'open', 'close', 'hide', 'show', 'drop',
);
// `settle` false runs the next step straight away, so a request can still be in flight
// across a hide, a mode change, or a close; the invariant is judged at settle points.
const stepArb = fc.record({ action: actionArb, settle: fc.boolean() });

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
      fc.asyncProperty(fc.array(stepArb, { maxLength: 14 }), async (steps) => {
        stub.show();
        const el = fresh(RIGS[0], 'kg');
        const card = q<HTMLElement & { close(): void }>(sr(el), 'rack-fullscreen');
        let mode: Action = 'decode';
        let open = false;
        let visible = true;
        const expected = (): number => (visible && (mode === 'warmup' || open) ? 1 : 0);
        for (const { action, settle } of steps) {
          if (action === 'decode' || action === 'encode' || action === 'warmup') {
            modeBtn(el, action).click();
            mode = action;
          } else if (action === 'open') {
            q<HTMLButtonElement>(sr(el), '[data-fullscreen]').click();
            open = true;
          } else if (action === 'close') {
            if (open) card.close();
            open = false;
          } else if (action === 'hide') {
            stub.hide();
            visible = false;
          } else if (action === 'show') {
            stub.show();
            visible = true;
          } else {
            stub.drop();
          }
          if (settle) {
            await flush();
            expect(stub.live).toBe(expected());
          }
        }
        await flush();
        expect(stub.live).toBe(expected());
        resetPool();
        await flush();
        expect(stub.live).toBe(0);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });
});
