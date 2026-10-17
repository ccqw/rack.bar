// The shared loadout picture's layout (RBAR-70) -- a pure core (ADR-0001). The share
// button attaches a PNG of the loadout to the format-D text; elements/shareimage.ts
// draws it on a canvas. The picture IS the fullscreen rack card ("big mode", RBAR-18) as
// a phone shows it: the frame here is the card's own numbers (lib/fullscreenframe.ts),
// at the phone viewport the app is budgeted for (ADR-0013's 393 x 659), rendered at an
// iPhone's 3x device pixel ratio. The Bar inside it is lib/sleevefit's sleeveLayout --
// the same fit and pieces <rack-sleeve> draws -- rotated and blown up as the card does.
// No DOM, no canvas: the shell measures text and paints.
import { FULLSCREEN, fullscreenRotWidth, fullscreenTotalPx } from './fullscreenframe.ts';
import { SLEEVE_BLOCK_PX } from './sleevefit.ts';

/**
 * The picture's frame: the fullscreen card at the 393 x 659 phone viewport (ADR-0013's
 * Must size, an iPhone 15/16 in Safari), drawn at 3x -- 1179 x 1977 px, the pixels an
 * iPhone itself renders that screen at.
 */
export const SHARE_IMAGE = {
  cssW: 393,
  cssH: 659,
  dpr: 3,
} as const;
export const SHARE_IMAGE_W = SHARE_IMAGE.cssW * SHARE_IMAGE.dpr;
export const SHARE_IMAGE_H = SHARE_IMAGE.cssH * SHARE_IMAGE.dpr;

/** The huge Total's size at the picture's viewport (the card's clamp at 393px). */
export const SHARE_TOTAL_PX = fullscreenTotalPx(SHARE_IMAGE.cssW);

/** The rotated Bar's host before rotation: the card's rot width x the sleeve block. */
export const SHARE_SLEEVE_HOST = {
  w: fullscreenRotWidth(SHARE_IMAGE.cssH),
  h: SLEEVE_BLOCK_PX,
} as const;

/** The caption wraps inside the card's padded width. */
export const SHARE_CAPTION_MAX_W = SHARE_IMAGE.cssW - 2 * FULLSCREEN.padX;

/** Line-box heights of the head's blocks, in CSS px (the shell measures them). */
export interface HeadBoxes {
  readonly wordmark: number;
  readonly total: number;
  readonly secondary: number;
  /** One entry per wrapped caption line. */
  readonly caption: readonly number[];
}

/** The top of each head block, the bottom of the head, and the Bar's centre. */
export interface HeadLayout {
  readonly wordmarkTop: number;
  readonly totalTop: number;
  readonly secondaryTop: number;
  /** The top of each caption line. */
  readonly captionTops: readonly number[];
  readonly headBottom: number;
  /** Where the rotated Bar is centred: the middle of the stage under the head. */
  readonly barCenter: { readonly x: number; readonly y: number };
}

/**
 * Stack the fullscreen card's head the way its flex column does (RBAR-18): padding top,
 * wordmark, the Total after its margin, the other-Unit line, then the caption lines;
 * the stage takes the rest down to the bottom padding and centres the Bar in it.
 */
export function headLayout(boxes: HeadBoxes): HeadLayout {
  const f = FULLSCREEN;
  const wordmarkTop = f.padTop;
  const totalTop = wordmarkTop + boxes.wordmark + f.totalMarginTop;
  const secondaryTop = totalTop + boxes.total + f.secondaryMarginTop;
  let y = secondaryTop + boxes.secondary + f.captionMarginTop;
  const captionTops = boxes.caption.map((h) => {
    const top = y;
    y += h;
    return top;
  });
  const headBottom = y;
  const stageBottom = SHARE_IMAGE.cssH - f.padBottom;
  return {
    wordmarkTop,
    totalTop,
    secondaryTop,
    captionTops,
    headBottom,
    barCenter: { x: SHARE_IMAGE.cssW / 2, y: (headBottom + stageBottom) / 2 },
  };
}

/**
 * Greedy word wrap, as a browser wraps the caption: words joined by single spaces onto a
 * line while `measure(line)` fits `maxW`; a word wider than `maxW` gets a line of its own.
 */
export function wrapText(
  text: string,
  measure: (s: string) => number,
  maxW: number,
): readonly string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && measure(`${last} ${word}`) <= maxW) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

/** One layer of a CSS box-shadow / text-shadow. */
export interface ShadowLayer {
  readonly inset: boolean;
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
}

/**
 * Parse a CSS shadow list (`inset 0 0 0 1px rgba(...), 0 2px 6px rgba(...)`) into its
 * layers, so the canvas can paint the same --rack-shadow-disc the sleeve uses. Lengths
 * are px; a layer that doesn't parse is skipped rather than guessed.
 */
export function parseShadows(value: string): readonly ShadowLayer[] {
  const layers: ShadowLayer[] = [];
  // Split on commas outside parentheses (rgba(...) has its own commas).
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const color = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|[a-z]+)\s*$/i.exec(part.replace(/^inset\s+/i, ''));
    const inset = /^inset\s/i.test(part);
    const rest = part.replace(/^inset\s+/i, '').replace(color?.[0] ?? '', '').trim();
    const nums = rest.split(/\s+/).filter(Boolean).map((n) => parseFloat(n));
    if (!color || nums.length < 2 || nums.some((n) => Number.isNaN(n))) continue;
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    layers.push({ inset, x, y, blur, spread, color: color[1]! });
  }
  return layers;
}

/**
 * The disc fill's light top stop (RBAR-42's recipe, `color-mix(in srgb, disc 95%,
 * #fff)`), computed here because a canvas gradient cannot rely on color-mix support.
 * `white` is the white share (0.05 for the recipe). Takes a 6-digit hex such as a
 * computed --rack-plate-* token; anything else comes back unchanged.
 */
export function mixWithWhite(hex: string, white: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (255 - c) * white)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
