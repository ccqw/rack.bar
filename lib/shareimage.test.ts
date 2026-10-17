import { describe, it, expect } from 'vitest';
import {
  SHARE_CAPTION_MAX_W,
  SHARE_IMAGE,
  SHARE_IMAGE_H,
  SHARE_IMAGE_W,
  SHARE_SLEEVE_HOST,
  SHARE_TOTAL_PX,
  headLayout,
  mixWithWhite,
  parseShadows,
  wrapText,
} from './shareimage.ts';
import { FULLSCREEN } from './fullscreenframe.ts';
import { SLEEVE_BLOCK_PX } from './sleevefit.ts';

describe('the share picture frame is the fullscreen card on a phone (RBAR-70)', () => {
  it('is the 393 x 659 phone viewport (ADR-0013) at an iPhone 3x: 1179 x 1977', () => {
    expect([SHARE_IMAGE.cssW, SHARE_IMAGE.cssH, SHARE_IMAGE.dpr]).toEqual([393, 659, 3]);
    expect([SHARE_IMAGE_W, SHARE_IMAGE_H]).toEqual([1179, 1977]);
  });

  it('takes the card numbers at that viewport: 58px Total, a 360 x 204 sleeve host', () => {
    expect(SHARE_TOTAL_PX).toBe(58); // clamp(40px, 16vw, 58px) at 393px
    expect(SHARE_SLEEVE_HOST).toEqual({ w: 360, h: SLEEVE_BLOCK_PX }); // min(360px, 62vh)
    expect(SHARE_CAPTION_MAX_W).toBe(393 - 2 * FULLSCREEN.padX);
  });

  it('the blown-up rotated Bar fits the frame', () => {
    // Rotated, the host's width runs down the picture and its height across it.
    expect(SHARE_SLEEVE_HOST.w * FULLSCREEN.blowUp).toBeLessThan(SHARE_IMAGE.cssH);
    expect(SHARE_SLEEVE_HOST.h * FULLSCREEN.blowUp).toBeLessThan(SHARE_IMAGE.cssW);
  });
});

describe('headLayout (the card column, top to bottom)', () => {
  const boxes = { wordmark: 25, total: 58, secondary: 18, caption: [15] };

  it('stacks padding, wordmark, Total, other Unit and caption with the card margins', () => {
    const h = headLayout(boxes);
    const f = FULLSCREEN;
    expect(h.wordmarkTop).toBe(f.padTop);
    expect(h.totalTop).toBe(f.padTop + 25 + f.totalMarginTop);
    expect(h.secondaryTop).toBe(h.totalTop + 58 + f.secondaryMarginTop);
    expect(h.captionTops).toEqual([h.secondaryTop + 18 + f.captionMarginTop]);
    expect(h.headBottom).toBe(h.captionTops[0]! + 15);
  });

  it('centres the Bar in the stage between the head and the bottom padding', () => {
    const h = headLayout(boxes);
    expect(h.barCenter.x).toBe(SHARE_IMAGE.cssW / 2);
    expect(h.barCenter.y).toBe((h.headBottom + SHARE_IMAGE.cssH - FULLSCREEN.padBottom) / 2);
  });

  it('a wrapped caption pushes the head down and the Bar with it', () => {
    const one = headLayout(boxes);
    const two = headLayout({ ...boxes, caption: [15, 15] });
    expect(two.captionTops).toEqual([one.captionTops[0], one.captionTops[0]! + 15]);
    expect(two.headBottom).toBe(one.headBottom + 15);
    expect(two.barCenter.y).toBe(one.barCenter.y + 7.5);
  });
});

describe('wrapText (the caption wrap)', () => {
  const measure = (s: string) => s.length * 10;

  it('keeps a line that fits whole', () => {
    expect(wrapText('20 KG BAR', measure, 200)).toEqual(['20 KG BAR']);
  });

  it('breaks between words, greedily', () => {
    expect(wrapText('AAA BBB CCC DDD', measure, 75)).toEqual(['AAA BBB', 'CCC DDD']);
  });

  it('gives an over-long word its own line and collapses extra spaces', () => {
    expect(wrapText('A  LONGWORDHERE B', measure, 50)).toEqual(['A', 'LONGWORDHERE', 'B']);
  });

  it('is empty for empty text', () => {
    expect(wrapText('   ', measure, 50)).toEqual([]);
  });
});

describe('parseShadows (painting --rack-shadow-disc on a canvas)', () => {
  it('parses the disc token: an inset ring and an outer lift', () => {
    expect(
      parseShadows('inset 0 0 0 1px rgba(255,255,255,.1), 0 2px 6px rgba(0,0,0,.25)'),
    ).toEqual([
      { inset: true, x: 0, y: 0, blur: 0, spread: 1, color: 'rgba(255,255,255,.1)' },
      { inset: false, x: 0, y: 2, blur: 6, spread: 0, color: 'rgba(0,0,0,.25)' },
    ]);
  });

  it('parses a text-shadow (the numeral engrave)', () => {
    expect(parseShadows('0 1px 0 rgba(255,255,255,.3)')).toEqual([
      { inset: false, x: 0, y: 1, blur: 0, spread: 0, color: 'rgba(255,255,255,.3)' },
    ]);
  });

  it('skips what it cannot parse rather than guessing', () => {
    expect(parseShadows('')).toEqual([]);
    expect(parseShadows('none')).toEqual([]);
    expect(parseShadows('0 2px 6px rgba(0,0,0,.25), garbage')).toHaveLength(1);
  });
});

describe('mixWithWhite (the top-lit disc gradient stop)', () => {
  it('mixes a plate hex 95 / 5 with white, like color-mix in srgb', () => {
    expect(mixWithWhite('#e0263a', 0.05)).toBe('#e23144');
    expect(mixWithWhite('#000000', 0.5)).toBe('#808080');
    expect(mixWithWhite('#ffffff', 0.05)).toBe('#ffffff');
  });

  it('accepts surrounding whitespace and upper case (a computed token value)', () => {
    expect(mixWithWhite('  #E0263A ', 0.05)).toBe('#e23144');
  });

  it('returns a non-hex colour unchanged rather than guessing', () => {
    expect(mixWithWhite('red', 0.05)).toBe('red');
  });
});
