// The shared loadout picture (RBAR-70): draws the current load as the fullscreen rack
// card ("big mode", RBAR-18) looks on a phone, and exports it as a PNG File, so the share
// sheet can attach it to the format-D text and iMessage (or any chat) shows the loadout
// itself. The imperative shell half of the split (ADR-0001): every position and size
// comes from the pure lib/ layout -- the card's frame (lib/fullscreenframe.ts, which the
// card's own CSS reads too), the head stack and caption wrap (lib/shareimage.ts), and the
// sleeve (lib/sleevefit.ts sleeveLayout, the fit <rack-sleeve> uses) -- and this module
// only paints it.
//
// Dark, like the card: the radial wash, the --rack-* text and plate colours and the disc
// shadow are read from the live custom properties rather than copied, so the picture
// follows tokens.css. Fonts: the picture waits for document.fonts.ready, so Hanken
// Grotesk and JetBrains Mono are drawn rather than the fallback stack.
import type { LoadSummary } from '../lib/summary.ts';
import { configText, loadTotalKg } from '../lib/summary.ts';
import { format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { FULLSCREEN } from '../lib/fullscreenframe.ts';
import {
  COLLAR_EDGE_PX,
  DISC_INK,
  collarLatch,
  darkInk,
  sleeveLayout,
} from '../lib/sleevefit.ts';
import type { SleevePart } from '../lib/sleevefit.ts';
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
} from '../lib/shareimage.ts';
import type { ShadowLayer } from '../lib/shareimage.ts';

// The sleeve's disc corner radius (4px), the empty box's (6px), the chrome's (the
// shaft's 4px lead end, the collars' 3px, the bare end's rounded tip), the numeral
// tracking and the dashed empty box -- the values elements/sleeve.ts writes in its CSS.
const DISC_RADIUS = 4;
const EMPTY_RADIUS = 6;
const NUMERAL_TRACK_EM = 0.04;

/** Read one --rack-* token's computed value from the page. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The PNG's file name: the Total in its display Unit, e.g. rack-bar-142-kg.png. */
export function shareImageName(load: LoadSummary): string {
  return `rack-bar-${shownIn(loadTotalKg(load), load.unit)}-${load.unit}.png`;
}

/**
 * Draw `load` as the fullscreen card picture and return it as a PNG File, or null when
 * this browser cannot draw one (no 2D canvas, no toBlob, the fonts failed, or the encode
 * failed). Never rejects: the caller then shares the text alone.
 */
export async function shareImageFile(load: LoadSummary, setLabel: string): Promise<File | null> {
  try {
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_IMAGE_W;
    canvas.height = SHARE_IMAGE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.toBlob !== 'function') return null;
    draw(ctx, load, setLabel);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) return null;
    return new File([blob], shareImageName(load), { type: 'image/png' });
  } catch {
    return null; // a drawing or encode failure leaves the text share intact
  }
}

// Set the canvas letter-spacing where the browser supports it (Chrome, Safari 17+);
// elsewhere text draws untracked, a hair wider.
function track(ctx: CanvasRenderingContext2D, em: number, px: number): void {
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${em * px}px`;
  }
}

// A CSS line box for one line of `font`: line-height normal is the font's ascent +
// descent; `lineHeight` (a multiple) overrides it, splitting the leading evenly.
function lineBox(
  ctx: CanvasRenderingContext2D,
  font: string,
  sample: string,
  px: number,
  lineHeight?: number,
): { height: number; baseline: number } {
  ctx.font = font;
  const m = ctx.measureText(sample);
  const asc = m.fontBoundingBoxAscent ?? px * 0.8;
  const desc = m.fontBoundingBoxDescent ?? px * 0.2;
  const content = asc + desc;
  const height = lineHeight !== undefined ? px * lineHeight : content;
  return { height, baseline: (height - content) / 2 + asc };
}

function draw(ctx: CanvasRenderingContext2D, load: LoadSummary, setLabel: string): void {
  const f = FULLSCREEN;
  const W = SHARE_IMAGE.cssW;
  const H = SHARE_IMAGE.cssH;
  const font = token('--rack-font');
  const mono = token('--rack-font-num');
  const fg = token('--rack-text');
  const muted = token('--rack-text-dim');
  ctx.scale(SHARE_IMAGE.dpr, SHARE_IMAGE.dpr); // draw in the card's CSS px

  // The backdrop: radial-gradient(120% 90% at 50% 30%, glow, deep) -- an ellipse with
  // radii 120% x 90% of the box, centred 30% down.
  const rx = 1.2 * W;
  const ry = 0.9 * H;
  ctx.save();
  ctx.translate(W / 2, 0.3 * H);
  ctx.scale(rx / ry, 1);
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  wash.addColorStop(0, token('--rack-fullscreen-glow'));
  wash.addColorStop(1, token('--rack-fullscreen-deep'));
  ctx.fillStyle = wash;
  ctx.fillRect((-W / 2) * (ry / rx), -0.3 * H, W * (ry / rx), H);
  ctx.restore();

  // Measure the head's line boxes, then stack them as the card's column does.
  const total = loadTotalKg(load);
  const other: Unit = load.unit === 'kg' ? 'lb' : 'kg';
  const wordmarkFont = `800 ${f.wordmarkPx}px ${font}`;
  const totalFont = `800 ${SHARE_TOTAL_PX}px ${font}`;
  const unitFont = `${f.unitWeight} ${f.unitPx}px ${font}`;
  const secondaryFont = `500 ${f.secondaryPx}px ${font}`;
  const captionFont = `600 ${f.captionPx}px ${mono}`;
  const wm = lineBox(ctx, wordmarkFont, 'rack.bar', f.wordmarkPx);
  const tot = lineBox(ctx, totalFont, '0', SHARE_TOTAL_PX, 1);
  const sec = lineBox(ctx, secondaryFont, '0', f.secondaryPx);
  const cap = lineBox(ctx, captionFont, 'A', f.captionPx);
  ctx.font = captionFont;
  track(ctx, f.captionTrackEm, f.captionPx);
  const captionText = `${configText(load.barKg, load.collarKg, setLabel)} - per side`.toUpperCase();
  const captionLines = wrapText(captionText, (s) => ctx.measureText(s).width, SHARE_CAPTION_MAX_W);
  track(ctx, 0, 0);
  const head = headLayout({
    wordmark: wm.height,
    total: tot.height,
    secondary: sec.height,
    caption: captionLines.map(() => cap.height),
  });

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Wordmark: rack.bar with the accent dot, centred as one run.
  ctx.font = wordmarkFont;
  track(ctx, f.wordmarkTrackEm, f.wordmarkPx);
  const runs = [
    ['rack', fg],
    ['.', token('--rack-accent')],
    ['bar', fg],
  ] as const;
  const widths = runs.map(([t]) => ctx.measureText(t).width);
  let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
  runs.forEach(([t, color], i) => {
    ctx.fillStyle = color;
    ctx.fillText(t, x, head.wordmarkTop + wm.baseline);
    x += widths[i]!;
  });

  // The huge Total in the display Unit with its small dim suffix, centred as one run.
  const num = String(shownIn(total, load.unit));
  const unitText = ` ${load.unit}`;
  ctx.font = totalFont;
  track(ctx, f.totalTrackEm, SHARE_TOTAL_PX);
  const numW = ctx.measureText(num).width;
  ctx.font = unitFont;
  track(ctx, f.totalTrackEm, f.unitPx);
  const unitW = ctx.measureText(unitText).width;
  const left = W / 2 - (numW + unitW) / 2;
  const totalBase = head.totalTop + tot.baseline;
  ctx.font = totalFont;
  track(ctx, f.totalTrackEm, SHARE_TOTAL_PX);
  ctx.fillStyle = fg;
  ctx.fillText(num, left, totalBase);
  ctx.font = unitFont;
  track(ctx, f.totalTrackEm, f.unitPx);
  ctx.fillStyle = muted;
  ctx.fillText(unitText, left + numW, totalBase);
  track(ctx, 0, 0);

  // The other-Unit line, then the uppercase caption.
  ctx.textAlign = 'center';
  ctx.font = secondaryFont;
  ctx.fillStyle = muted;
  ctx.fillText(format(total, other), W / 2, head.secondaryTop + sec.baseline);
  ctx.font = captionFont;
  track(ctx, f.captionTrackEm, f.captionPx);
  captionLines.forEach((line, i) => {
    ctx.fillText(line, W / 2, head.captionTops[i]! + cap.baseline);
  });
  track(ctx, 0, 0);

  // The Bar: the sleeve laid out in its host, rotated 90deg and blown up about the
  // stage centre -- the card's `rotate(90deg) scale(1.5)`.
  const host = SHARE_SLEEVE_HOST;
  ctx.save();
  ctx.translate(head.barCenter.x, head.barCenter.y);
  ctx.scale(f.blowUp, f.blowUp);
  ctx.rotate(Math.PI / 2);
  ctx.translate(-host.w / 2, -host.h / 2);
  drawSleeve(ctx, sleeveLayout(load.side, host.w, host.h, load.collarKg > 0), mono);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number; w: number; h: number },
  radii: number | number[],
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(p.x, p.y, p.w, p.h, radii);
  else ctx.rect(p.x, p.y, p.w, p.h);
}

// Canvas shadows ignore the current transform, so a shadow drawn inside the rotated,
// blown-up sleeve is mapped by hand: offset rotated +90deg, offset and blur scaled by
// the blow-up and the pixel ratio (canvas shadowBlur is twice the Gaussian sigma, the
// same as a CSS blur radius).
function setDropShadow(ctx: CanvasRenderingContext2D, s: ShadowLayer): void {
  const k = FULLSCREEN.blowUp * SHARE_IMAGE.dpr;
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur * k;
  ctx.shadowOffsetX = -s.y * k;
  ctx.shadowOffsetY = s.x * k;
}

// Paint the sleeve pieces as <rack-sleeve> does: grey chrome, the flat Collar (RBAR-96:
// solid fill, a 1px edge, a flat red latch on top) when drawn, then each disc in the
// top-lit plate gradient with --rack-shadow-disc (outer lift + inset ring), and the
// engraved numeral rotated -90deg so the card's +90deg turn sets it upright.
function drawSleeve(ctx: CanvasRenderingContext2D, parts: readonly SleevePart[], mono: string): void {
  const chrome: Record<string, { color: string; radii: number | number[] }> = {
    shaft: { color: token('--rack-sleeve-shaft'), radii: [4, 0, 0, 4] },
    'collar-inner': { color: token('--rack-sleeve-collar'), radii: 3 },
    'bare-end': { color: token('--rack-sleeve-shaft'), radii: [0, 5, 5, 0] },
  };
  const shadows = parseShadows(token('--rack-shadow-disc'));
  const drop = shadows.find((s) => !s.inset);
  const ring = shadows.find((s) => s.inset);

  for (const part of parts) {
    if (part.kind === 'empty') {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = token('--rack-sleeve-empty');
      roundRect(ctx, inset(part, 0.75), EMPTY_RADIUS);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = token('--rack-sleeve-empty-glyph');
      ctx.font = `600 20px ${mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', part.x + part.w / 2, part.y + part.h / 2);
      continue;
    }
    if (part.kind === 'collar') {
      // Fill, then the edge, then the latch on top -- the CSS paint order (the ::after
      // child over its parent's border), at the shared outer-box offsets.
      ctx.fillStyle = token('--rack-sleeve-collar');
      roundRect(ctx, part, 3);
      ctx.fill();
      ctx.strokeStyle = token('--rack-sleeve-end');
      ctx.lineWidth = COLLAR_EDGE_PX;
      roundRect(ctx, inset(part, COLLAR_EDGE_PX / 2), 3 - COLLAR_EDGE_PX / 2);
      ctx.stroke();
      ctx.fillStyle = token('--rack-plate-red');
      roundRect(ctx, collarLatch(part), [2, 2, 0, 0]);
      ctx.fill();
      continue;
    }
    if (part.kind !== 'disc' || !part.plate) {
      const c = chrome[part.kind]!;
      ctx.fillStyle = c.color;
      roundRect(ctx, part, c.radii);
      ctx.fill();
      continue;
    }
    const hex = token(`--rack-plate-${part.plate.color}`);
    const grad = ctx.createLinearGradient(0, part.y, 0, part.y + part.h);
    grad.addColorStop(0, mixWithWhite(hex, 0.05));
    grad.addColorStop(1, hex);
    ctx.save();
    if (drop) setDropShadow(ctx, drop);
    ctx.fillStyle = grad;
    roundRect(ctx, part, DISC_RADIUS);
    ctx.fill();
    ctx.restore();
    if (ring && ring.spread > 0) {
      ctx.save();
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.spread;
      roundRect(ctx, inset(part, ring.spread / 2), DISC_RADIUS);
      ctx.stroke();
      ctx.restore();
    }

    if (part.numeral) {
      const dark = darkInk(part.plate.color);
      const engrave = parseShadows(dark ? DISC_INK.darkEngrave : DISC_INK.lightEngrave)[0];
      ctx.save();
      ctx.translate(part.x + part.w / 2, part.y + part.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.font = `800 ${part.numeral.px}px ${mono}`;
      track(ctx, NUMERAL_TRACK_EM, part.numeral.px);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (engrave) {
        // Rotated twice (-90 here, +90 for the card), the engrave lands as authored.
        const k = FULLSCREEN.blowUp * SHARE_IMAGE.dpr;
        ctx.shadowColor = engrave.color;
        ctx.shadowBlur = engrave.blur * k;
        ctx.shadowOffsetX = engrave.x * k;
        ctx.shadowOffsetY = engrave.y * k;
      }
      ctx.fillStyle = dark ? DISC_INK.dark : DISC_INK.light;
      ctx.fillText(part.numeral.text, 0, 0);
      ctx.restore();
    }
  }
}

// A box shrunk by `d` on every side (strokes centred on the edge stay inside it).
function inset(
  p: { x: number; y: number; w: number; h: number },
  d: number,
): { x: number; y: number; w: number; h: number } {
  return { x: p.x + d, y: p.y + d, w: Math.max(0, p.w - 2 * d), h: Math.max(0, p.h - 2 * d) };
}
