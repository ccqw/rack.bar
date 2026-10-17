// The loadout picture's canvas shell (RBAR-70). happy-dom has no 2D canvas, so a fake
// context records the drawing calls; the pixels themselves get the browser pass. These
// pin the contract: wait for the fonts, draw a 1080px square, write the Total and the
// format-D lines, paint the Plates from the --rack-* tokens, and hand back a PNG File
// -- or null (never a rejection) when the browser can't draw.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { shareImageFile, shareImageName } from './shareimage.ts';
import { ELEIKO_KG, IRON_LB } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { configText, plateLines } from '../lib/summary.ts';
import { barLayout } from '../lib/shareimage.ts';

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
  order: string[];
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
        if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
        if (prop in state) return state[prop];
        return () => {};
      },
      set(_t, prop: string, value) {
        state[prop] = value;
        if (prop === 'fillStyle') rec.fills.push(value);
        return true;
      },
    },
  );
  return ctx as CanvasRenderingContext2D;
}

function stubCanvas(opts: { blob?: Blob | null; context?: boolean } = {}): Recorded {
  const rec: Recorded = { texts: [], fills: [], order: [] };
  const blob = opts.blob === undefined ? new Blob(['png'], { type: 'image/png' }) : opts.blob;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    rec.order.push(`getContext ${this.width}x${this.height}`);
    return opts.context === false ? null : (fakeContext(rec) as never);
  });
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) {
    rec.order.push(`toBlob ${type}`);
    cb(blob);
  };
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
  it('waits for the fonts, draws a 1080px square and returns a named PNG File', async () => {
    const rec = stubCanvas();
    let fontsReady!: () => void;
    const ready = new Promise<void>((r) => (fontsReady = r));
    setFonts({ ready });
    const pending = shareImageFile(LOADED, 'Competition');
    await Promise.resolve();
    expect(rec.order).toEqual([]); // nothing drawn before the fonts are in
    fontsReady();
    const file = await pending;
    expect(rec.order).toEqual(['getContext 1080x1080', 'toBlob image/png']);
    expect(file).toBeInstanceOf(File);
    expect(file!.type).toBe('image/png');
    expect(file!.name).toBe('rack-bar-142-kg.png');
  });

  it('writes the wordmark, the Total in both Units, the Plate lines and the caption', async () => {
    const rec = stubCanvas();
    await shareImageFile(LOADED, 'Competition');
    expect(rec.texts).toEqual(
      expect.arrayContaining(['rack', '.', 'bar', '142', ' kg', '313 lb', 'PER SIDE']),
    );
    for (const line of plateLines(LOADED.side)) expect(rec.texts).toContain(line);
    expect(rec.texts).toContain(configText(20, 0, 'Competition'));
    // Every disc on both Sides engraves its numeral.
    expect(rec.texts.filter((t) => t === '25')).toHaveLength(4);
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
    for (const line of plateLines(load.side)) expect(rec.texts).toContain(line);
    expect(rec.texts).toContain(configText(20, 2.5, 'Training'));
  });

  it('draws a bare Bar: the Bare bar line and the empty-box plus on each Side', async () => {
    const rec = stubCanvas();
    await shareImageFile({ side: [], barKg: 20, collarKg: 0, unit: 'kg' }, 'Competition');
    expect(rec.texts).toContain('Bare bar');
    expect(rec.texts.filter((t) => t === '+')).toHaveLength(2);
  });

  it('paints from the live --rack-* tokens (page ground, plate colours)', async () => {
    const rec = stubCanvas();
    const root = document.documentElement.style;
    root.setProperty('--rack-page-bg', '#e7e5df');
    root.setProperty('--rack-plate-green', '#25a45a');
    root.setProperty('--rack-sleeve-collar', '#8b9199');
    await shareImageFile(LOADED, 'Competition');
    expect(rec.fills[0]).toBe('#e7e5df'); // the light ground goes down first
    expect(rec.fills).toContain('#8b9199');
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

  it('the bar it draws is the pure barLayout (both Sides of discs)', () => {
    expect(barLayout(LOADED.side).filter((p) => p.kind === 'disc')).toHaveLength(8);
  });
});

describe('shareImageName', () => {
  it('names the file by the Total in its display Unit', () => {
    expect(shareImageName(LOADED)).toBe('rack-bar-142-kg.png');
    expect(shareImageName({ ...LOADED, unit: 'lb' })).toBe('rack-bar-313-lb.png');
  });
});
