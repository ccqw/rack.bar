// The loadout picture's canvas shell (RBAR-70). happy-dom has no 2D canvas, so a fake
// context records the drawing calls; the pixels themselves get the browser pass. These
// pin the contract: wait for the fonts, draw the fullscreen card at 1179 x 1977 (393 x
// 659 at 3x), write its head (wordmark, Total, other Unit, uppercase caption), paint the
// one-Side sleeve rotated and blown up as the card does, read the --rack-* tokens, and
// hand back a PNG File -- or null (never a rejection) when the browser can't draw.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { shareImageFile, shareImageName } from './shareimage.ts';
import { ELEIKO_KG, IRON_LB } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { configText } from '../lib/summary.ts';

const eleiko = (kg: number) => ELEIKO_KG.find((x) => x.kg === kg)!;

const LOADED: LoadSummary = {
  side: [eleiko(25), eleiko(25), eleiko(10), eleiko(1)],
  barKg: 20,
  collarKg: 0,
  unit: 'kg',
};

interface Recorded {
  texts: string[];
  fills: unknown[];
  strokes: unknown[];
  order: string[];
  stops: string[];
  calls: string[];
}

// A fake 2D context: records fillText strings and every fillStyle assigned, and answers
// measureText with a width proportional to the string length.
function fakeContext(rec: Recorded): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'fillText') return (t: string) => rec.texts.push(t);
        if (prop === 'measureText') return (t: string) => ({ width: t.length * 10 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
          return () => ({ addColorStop: (_o: number, c: string) => rec.stops.push(c) });
        if (prop === 'rotate' || prop === 'scale')
          return (...a: number[]) => rec.calls.push(`${prop} ${a.join(' ')}`);
        if (prop in state) return state[prop];
        return () => {};
      },
      set(_t, prop: string, value) {
        state[prop] = value;
        if (prop === 'fillStyle') rec.fills.push(value);
        if (prop === 'strokeStyle') rec.strokes.push(value);
        return true;
      },
    },
  );
  return ctx as CanvasRenderingContext2D;
}

function stubCanvas(opts: { blob?: Blob | null; context?: boolean } = {}): Recorded {
  const rec: Recorded = { texts: [], fills: [], strokes: [], order: [], stops: [], calls: [] };
  const blob = opts.blob === undefined ? new Blob(['png'], { type: 'image/png' }) : opts.blob;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    rec.order.push(`getContext ${this.width}x${this.height}`);
    return opts.context === false ? null : (fakeContext(rec) as never);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    cb: BlobCallback,
    type?: string,
  ) {
    rec.order.push(`toBlob ${type}`);
    cb(blob);
  });
  return rec;
}

// happy-dom has no document.fonts; install (or remove) one per test.
function setFonts(value: unknown): void {
  Object.defineProperty(document, 'fonts', { value, configurable: true });
}

afterEach(() => {
  delete (document as { fonts?: unknown }).fonts;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
});

describe('shareImageFile (the loadout picture, RBAR-70)', () => {
  it('waits for the fonts, draws 1179 x 1977 and returns a named PNG File', async () => {
    const rec = stubCanvas();
    let fontsReady!: () => void;
    const ready = new Promise<void>((r) => (fontsReady = r));
    setFonts({ ready });
    const pending = shareImageFile(LOADED, 'Competition');
    await Promise.resolve();
    expect(rec.order).toEqual([]); // nothing drawn before the fonts are in
    fontsReady();
    const file = await pending;
    expect(rec.order).toEqual(['getContext 1179x1977', 'toBlob image/png']);
    expect(file).toBeInstanceOf(File);
    expect(file!.type).toBe('image/png');
    expect(file!.name).toBe('rack-bar-142-kg.png');
  });

  it('writes the card head: wordmark, Total in both Units, the uppercase caption', async () => {
    const rec = stubCanvas();
    await shareImageFile(LOADED, 'Competition');
    expect(rec.texts).toEqual(expect.arrayContaining(['rack', '.', 'bar', '142', ' kg', '313 lb']));
    const caption = `${configText(20, 0, 'Competition')} - per side`.toUpperCase();
    // The fake measures 10px a character, so the 345px caption wraps at word breaks.
    expect(rec.texts.filter((t) => caption.includes(t) && /[A-Z]/.test(t)).join(' ')).toBe(caption);
    // One Side, as the card shows it: each disc engraves its numeral once.
    expect(rec.texts.filter((t) => t === '25')).toHaveLength(2);
    expect(rec.texts).toContain('10');
  });

  it('draws at 3x, and turns and blows up the Bar as the card does', async () => {
    const rec = stubCanvas();
    await shareImageFile(LOADED, 'Competition');
    expect(rec.calls[0]).toBe('scale 3 3');
    expect(rec.calls).toContain(`rotate ${Math.PI / 2}`);
    expect(rec.calls).toContain('scale 1.5 1.5');
    // The numerals turn back -90deg so the card's +90deg sets them upright.
    expect(rec.calls).toContain(`rotate ${-Math.PI / 2}`);
  });

  it('reads an lb load in lb, iron faces stamped, Collars on the caption', async () => {
    const iron = (l: string) => IRON_LB.find((p) => p.label === l)!;
    const load: LoadSummary = {
      side: [iron('45'), iron('45'), iron('10')],
      barKg: 20,
      collarKg: 2.5,
      unit: 'lb',
    };
    const rec = stubCanvas();
    const file = await shareImageFile(load, 'Training');
    // 20 kg Bar + 2 x 2.5 kg Collars + 2 x 100 lb = 255 lb (whole-lb readout).
    expect(file!.name).toBe('rack-bar-255-lb.png');
    expect(rec.texts).toContain(' lb');
    expect(rec.texts.filter((t) => t === '45')).toHaveLength(2);
    expect(rec.texts.join(' ')).toContain('COLLARS 2.5 KG');
    expect(rec.texts.join(' ')).toContain('TRAINING');
  });

  it('draws a bare Bar as the sleeve empty state: one dashed box with a plus', async () => {
    const rec = stubCanvas();
    await shareImageFile({ side: [], barKg: 20, collarKg: 0, unit: 'kg' }, 'Competition');
    expect(rec.texts.filter((t) => t === '+')).toHaveLength(1);
    expect(rec.texts).toContain('20');
  });

  it('paints from the live --rack-* tokens (the card wash, plate colours, chrome)', async () => {
    const rec = stubCanvas();
    const root = document.documentElement.style;
    root.setProperty('--rack-fullscreen-glow', '#16181c');
    root.setProperty('--rack-fullscreen-deep', '#0a0b0d');
    root.setProperty('--rack-plate-green', '#25a45a');
    root.setProperty('--rack-sleeve-collar', '#8b9199');
    await shareImageFile(LOADED, 'Competition');
    expect(rec.stops.slice(0, 2)).toEqual(['#16181c', '#0a0b0d']); // the dark wash first
    expect(rec.stops).toContain('#25a45a');
    expect(rec.fills).toContain('#8b9199');
  });

  it('clamps the flat Collar on the outer disc only when collars are on and the Bar has Plates (RBAR-96)', async () => {
    const root = document.documentElement.style;
    root.setProperty('--rack-sleeve-end', '#5c636b'); // the Collar's 1px edge
    root.setProperty('--rack-plate-red', '#d23a3a'); // its latch
    const edges = (rec: Recorded) => rec.strokes.filter((c) => c === '#5c636b').length;

    const on = stubCanvas();
    await shareImageFile({ ...LOADED, collarKg: 2.5 }, 'Competition');
    expect(edges(on)).toBe(1);
    expect(on.fills).toContain('#d23a3a'); // discs fill by gradient, so a flat red is the latch
    vi.restoreAllMocks();

    const off = stubCanvas();
    await shareImageFile(LOADED, 'Competition');
    expect(edges(off)).toBe(0);
    expect(off.fills).not.toContain('#d23a3a');
    vi.restoreAllMocks();

    const bare = stubCanvas();
    await shareImageFile({ side: [], barKg: 20, collarKg: 2.5, unit: 'kg' }, 'Competition');
    expect(edges(bare)).toBe(0);
  });

  it('returns null, never rejects, without a 2D context', async () => {
    stubCanvas({ context: false });
    await expect(shareImageFile(LOADED, 'Competition')).resolves.toBeNull();
  });

  it('returns null when the PNG encode yields no blob', async () => {
    stubCanvas({ blob: null });
    await expect(shareImageFile(LOADED, 'Competition')).resolves.toBeNull();
  });

  it('returns null when drawing throws', async () => {
    stubCanvas();
    // getComputedStyle failing mid-draw stands in for any drawing error.
    vi.stubGlobal('getComputedStyle', () => {
      throw new Error('boom');
    });
    await expect(shareImageFile(LOADED, 'Competition')).resolves.toBeNull();
  });

  it('draws even where document.fonts is missing', async () => {
    stubCanvas();
    setFonts(undefined);
    await expect(shareImageFile(LOADED, 'Competition')).resolves.toBeInstanceOf(File);
  });

  it('returns null when the fonts never load (fonts.ready rejects)', async () => {
    stubCanvas();
    setFonts({ ready: Promise.reject(new Error('font load failed')) });
    await expect(shareImageFile(LOADED, 'Competition')).resolves.toBeNull();
  });
});

describe('shareImageName', () => {
  it('names the file by the Total in its display Unit', () => {
    expect(shareImageName(LOADED)).toBe('rack-bar-142-kg.png');
    expect(shareImageName({ ...LOADED, unit: 'lb' })).toBe('rack-bar-313-lb.png');
  });
});
