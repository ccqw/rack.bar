import { describe, it, expect } from 'vitest';
import { FULLSCREEN, fullscreenRotWidth, fullscreenTotalPx } from './fullscreenframe.ts';

describe('the fullscreen card frame (RBAR-18; shared with the share picture, RBAR-70)', () => {
  it('clamps the huge Total between 40 and 58px at 16vw', () => {
    expect(fullscreenTotalPx(200)).toBe(40);
    expect(fullscreenTotalPx(320)).toBeCloseTo(51.2, 9);
    expect(fullscreenTotalPx(393)).toBe(58);
    expect(fullscreenTotalPx(1000)).toBe(58);
  });

  it('lays the rotated Bar out min(360px, 62vh) wide', () => {
    expect(fullscreenRotWidth(659)).toBe(360);
    expect(fullscreenRotWidth(500)).toBeCloseTo(310, 9);
  });

  it('keeps the handoff numbers', () => {
    expect(FULLSCREEN.blowUp).toBe(1.5);
    expect([FULLSCREEN.padTop, FULLSCREEN.padX, FULLSCREEN.padBottom]).toEqual([48, 24, 32]);
  });
});
