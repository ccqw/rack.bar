// The shared loadout picture (RBAR-70): draws the current load on a canvas and exports
// it as a PNG File, so the share sheet can attach it to the format-D text and iMessage
// (or any chat) shows the loadout itself. The imperative shell half of the split
// (ADR-0001): every position and size comes from the pure lib/shareimage.ts layout;
// this module only paints it.
//
// A fixed LIGHT image (the --rack-page-* "device wallpaper" tones), so it reads the same
// in every chat theme; the Plates, the Bar chrome and the accent dot are the app's own
// tokens. Colours are read from the live --rack-* custom properties rather than copied,
// so the picture follows tokens.css. Fonts: the picture waits for document.fonts.ready,
// so Hanken Grotesk and JetBrains Mono are drawn rather than the fallback stack.
import type { LoadSummary } from '../lib/summary.ts';
import { configText, loadTotalKg, plateLines } from '../lib/summary.ts';
import { format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import type { PlateColor } from '../lib/plates.ts';
import {
  SHARE_IMAGE,
  SHARE_IMAGE_PX,
  IMAGE_ZOOM,
  barLayout,
  mixWithWhite,
  plateListLayout,
} from '../lib/shareimage.ts';
import type { BarPart, Rect } from '../lib/shareimage.ts';

// The disc corner radius (the sleeve's 4px) and the empty box's (6px), in sleeve px.
const DISC_RADIUS_PX = 4;
const EMPTY_RADIUS_PX = 6;

/** Read one --rack-* token's computed value from the page. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The PNG's file name: the Total in its display Unit, e.g. rack-bar-142-kg.png. */
export function shareImageName(load: LoadSummary): string {
  return `rack-bar-${shownIn(loadTotalKg(load), load.unit)}-${load.unit}.png`;
}

/**
 * Draw `load` as the square share picture and return it as a PNG File, or null when
 * this browser cannot draw one (no 2D canvas, no toBlob, or the encode failed). Never
 * rejects: the caller then shares the text alone.
 */
export async function shareImageFile(load: LoadSummary, setLabel: string): Promise<File | null> {
  try {
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_IMAGE_PX;
    canvas.height = SHARE_IMAGE_PX;
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

function draw(ctx: CanvasRenderingContext2D, load: LoadSummary, setLabel: string): void {
  const font = token('--rack-font');
  const mono = token('--rack-font-num');
  const ink = token('--rack-page-ink');
  const faint = token('--rack-page-faint');

  ctx.fillStyle = token('--rack-page-bg');
  ctx.fillRect(0, 0, SHARE_IMAGE_PX, SHARE_IMAGE_PX);
  ctx.textBaseline = 'alphabetic';

  // Wordmark, top left: rack.bar with the accent dot (the card's header treatment).
  const wm = SHARE_IMAGE.wordmark;
  ctx.font = `800 ${wm.px}px ${font}`;
  ctx.textAlign = 'left';
  let x = wm.x;
  for (const [text, color] of [
    ['rack', ink],
    ['.', token('--rack-accent')],
    ['bar', ink],
  ] as const) {
    ctx.fillStyle = color;
    ctx.fillText(text, x, wm.y);
    x += ctx.measureText(text).width;
  }

  // The Total in the display Unit with a small dim unit suffix, centred as one run.
  const total = loadTotalKg(load);
  const t = SHARE_IMAGE.total;
  const num = String(shownIn(total, load.unit));
  const unitText = ` ${load.unit}`;
  ctx.font = `800 ${t.px}px ${font}`;
  const numW = ctx.measureText(num).width;
  ctx.font = `700 ${SHARE_IMAGE.totalUnitPx}px ${font}`;
  const unitW = ctx.measureText(unitText).width;
  const left = t.x - (numW + unitW) / 2;
  ctx.textAlign = 'left';
  ctx.font = `800 ${t.px}px ${font}`;
  ctx.fillStyle = ink;
  ctx.fillText(num, left, t.y);
  ctx.font = `700 ${SHARE_IMAGE.totalUnitPx}px ${font}`;
  ctx.fillStyle = faint;
  ctx.fillText(unitText, left + numW, t.y);

  // The other Unit under it.
  const other: Unit = load.unit === 'kg' ? 'lb' : 'kg';
  const s = SHARE_IMAGE.secondary;
  ctx.textAlign = 'center';
  ctx.font = `500 ${s.px}px ${font}`;
  ctx.fillStyle = faint;
  ctx.fillText(format(total, other), s.x, s.y);

  drawBar(ctx, barLayout(load.side), mono);

  // "per side", then the format-D Plate lines wrapped and centred.
  const ll = SHARE_IMAGE.listLabel;
  ctx.font = `600 ${ll.px}px ${mono}`;
  ctx.fillStyle = faint;
  ctx.textAlign = 'center';
  ctx.fillText('PER SIDE', ll.x, ll.y);

  const lines = plateLines(load.side);
  // Measured at 100px and scaled, so sub-pixel rounding at 1px doesn't skew the widths.
  ctx.font = `700 100px ${font}`;
  const em = lines.map((l) => ctx.measureText(l).width / 100);
  const { fontPx, items } = plateListLayout(em, SHARE_IMAGE.list);
  ctx.font = `700 ${fontPx}px ${font}`;
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const it = items[i];
    if (it) ctx.fillText(line, it.x, it.y);
  });
  ctx.textBaseline = 'alphabetic';

  // The rig caption at the foot: dual-unit Bar, Collars when fitted, and the set.
  const c = SHARE_IMAGE.caption;
  ctx.font = `600 ${c.px}px ${mono}`;
  ctx.fillStyle = faint;
  ctx.textAlign = 'center';
  ctx.fillText(configText(load.barKg, load.collarKg, setLabel), c.x, c.y);
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(r.x, r.y, r.w, r.h, rad);
  } else {
    ctx.rect(r.x, r.y, r.w, r.h);
  }
}

// The Bar: the grey chrome, then each disc in the top-lit plate gradient with the
// sleeve's soft lift, an ink hairline so the white 5 / 0.5 hold their edge on the light
// ground, and the engraved numeral rotated to run up the face (the sleeve's -90deg).
function drawBar(ctx: CanvasRenderingContext2D, parts: readonly BarPart[], mono: string): void {
  const z = IMAGE_ZOOM;
  const chrome: Record<string, string> = {
    cap: token('--rack-sleeve-shaft'),
    grip: token('--rack-sleeve-shaft'),
    'collar-inner': token('--rack-sleeve-collar'),
    'collar-end': token('--rack-sleeve-end'),
  };
  const plate = (c: PlateColor) => token(`--rack-plate-${c}`);
  const ink = token('--rack-page-ink');
  const darkInk = token('--rack-accent-ink');
  const lightInk = token('--rack-text');

  for (const part of parts) {
    const r = part.rect;
    if (part.kind === 'empty') {
      ctx.save();
      ctx.setLineDash([4 * z, 3 * z]);
      ctx.lineWidth = 1.5 * z;
      ctx.strokeStyle = token('--rack-sleeve-empty');
      roundRect(ctx, r, EMPTY_RADIUS_PX * z);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = token('--rack-sleeve-empty-glyph');
      ctx.font = `600 ${20 * z}px ${mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', r.x + r.w / 2, r.y + r.h / 2);
      ctx.textBaseline = 'alphabetic';
      continue;
    }
    if (part.kind !== 'disc' || !part.plate) {
      ctx.fillStyle = chrome[part.kind] ?? ink;
      roundRect(ctx, r, part.kind === 'grip' ? 0 : 2 * z);
      ctx.fill();
      continue;
    }
    const hex = plate(part.plate.color);
    const grad = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    grad.addColorStop(0, mixWithWhite(hex, 0.05));
    grad.addColorStop(1, hex);
    // The sleeve's disc lift (--rack-shadow-disc's 0 2px 6px), zoomed.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 6 * z;
    ctx.shadowOffsetY = 2 * z;
    ctx.fillStyle = grad;
    roundRect(ctx, r, DISC_RADIUS_PX * z);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1 * z;
    roundRect(ctx, r, DISC_RADIUS_PX * z);
    ctx.stroke();
    ctx.restore();

    if (part.numeral) {
      const light = part.plate.color === 'white' || part.plate.color === 'yellow';
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.font = `800 ${part.numeral.px}px ${mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = light ? darkInk : lightInk;
      ctx.fillText(part.numeral.text, 0, 0);
      ctx.restore();
    }
  }
}
