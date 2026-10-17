// Property: every drawn Plate is filled solid in its set color (ADR-0004: a Plate reads
// by its Eleiko color first). Guards the "ghost plate" failure seen in a design
// prototype, where a class-name collision left the 15 and 5 kg discs as empty
// outlines. happy-dom can't cascade styles across shadow roots, so each surface is
// judged by the two things that drive its fill: the disc's inline --disc custom
// property (must name its Plate's --rack-plate-<color> token), and every rule in the
// component's own stylesheet that matches the disc (each background declaration must
// paint from var(--disc), and none may clear it to transparent/none). A future class
// collision, a dropped DISC_FILL, or a renamed token fails here. The share picture
// (canvas) is judged by the gradient it paints each disc with. Surfaces: the sleeve in
// By Weight and By Plates (and so Warm up, which loads the same sleeve), the palette
// keys, the loaded chips, the fullscreen sleeve, the share card chips and picture.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import './fullscreen.ts';
import './share.ts';
import { shareImageFile } from './shareimage.ts';
import { PLATE_SETS, PLATE_SET_KEYS } from '../lib/platesets.ts';
import type { Plate } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';
import {
  SEED, resetPool, on, q, sr, modeBtn, type, tapAdd, rigArb, unitArb, draftArb, linkStateArb,
} from './properties.drivers.ts';

beforeEach(resetPool);

// ---- tokens.css: the plate color tokens -------------------------------------------

const TOKENS_CSS = readFileSync(resolve(import.meta.dirname, '..', 'tokens.css'), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every definition of --rack-plate-<color> in tokens.css (a theme may redefine one). */
function plateTokenDefs(): Map<string, string[]> {
  const defs = new Map<string, string[]>();
  for (const m of stripComments(TOKENS_CSS).matchAll(/--rack-plate-([a-z]+)\s*:\s*([^;]+);/g)) {
    defs.set(m[1]!, [...(defs.get(m[1]!) ?? []), m[2]!.trim()]);
  }
  return defs;
}
const PLATE_TOKENS = plateTokenDefs();

/** Every color the offered Plate sets can draw. */
const SET_COLORS = [
  ...new Set(PLATE_SET_KEYS.flatMap((k) => PLATE_SETS[k].inventory.map((p) => p.color))),
];

// ---- a component's own stylesheet ------------------------------------------------

interface Rule {
  selectors: string[];
  body: string;
}

/** The innermost rules of a shadow root's <style> text (an @media wrapper is skipped). */
function shadowRules(root: ShadowRoot): Rule[] {
  const css = stripComments(
    [...root.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n'),
  );
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2]!,
  }));
}

/** Whether `el` matches `sel`; a selector happy-dom can't parse (e.g. :host) is skipped. */
function matches(el: Element, sel: string): boolean {
  if (sel.startsWith(':host') || sel.startsWith('@')) return false;
  try {
    return el.matches(sel);
  } catch {
    return false;
  }
}

/** Every background declaration the element's own stylesheet gives it. */
function backgroundDecls(el: HTMLElement, rules: readonly Rule[]): string[] {
  return rules
    .filter((r) => r.selectors.some((s) => matches(el, s)))
    .flatMap((r) => [...r.body.matchAll(/background(?:-color|-image)?\s*:\s*([^;]+)/g)])
    .map((m) => m[1]!.trim());
}

const CLEARED = /\b(transparent|none|inherit|initial|unset|revert)\b/;

/**
 * The rule: the disc names its Plate's color token on --disc, the token exists, and the
 * stylesheet paints it from var(--disc) -- with no matching rule clearing the fill.
 */
function expectFilled(disc: HTMLElement, rules: readonly Rule[], color: string): void {
  const where = `${disc.className} ${disc.dataset.kg ?? ''} ${color}`;
  expect(disc.dataset.color, where).toBe(color);
  const inline = /--disc:\s*var\(--rack-plate-([a-z]+)\)/.exec(disc.getAttribute('style') ?? '');
  expect(inline?.[1], `${where}: inline --disc`).toBe(color);
  expect(PLATE_TOKENS.has(color), `${where}: --rack-plate-${color} in tokens.css`).toBe(true);
  const decls = backgroundDecls(disc, rules);
  expect(decls.length, `${where}: a background rule`).toBeGreaterThan(0);
  for (const d of decls) {
    expect(d, `${where}: paints from --disc`).toContain('var(--disc)');
    expect(d, `${where}: not cleared`).not.toMatch(CLEARED);
  }
}

/** Check every `sel` element in `root` against the Plates it should draw, in order. */
function expectAllFilled(root: ShadowRoot, sel: string, colors: readonly string[]): void {
  const discs = [...root.querySelectorAll<HTMLElement>(sel)];
  expect(discs.map((d) => d.dataset.color)).toEqual(colors);
  const rules = shadowRules(root);
  discs.forEach((d, i) => expectFilled(d, rules, colors[i]!));
}

const colorsOf = (side: readonly Plate[]) => side.map((p) => p.color);

// ---- the properties ---------------------------------------------------------------

describe('every drawn Plate is filled solid in its set color (ADR-0004)', () => {
  it('every Plate color token the sets draw exists in tokens.css as an opaque 6-digit hex', () => {
    expect(SET_COLORS.length).toBeGreaterThan(0);
    for (const color of SET_COLORS) {
      const defs = PLATE_TOKENS.get(color);
      expect(defs, `--rack-plate-${color}`).toBeDefined();
      // 6-digit hex: opaque by construction (no alpha channel, no transparent keyword),
      // and the form the share picture's canvas gradient needs (lib/shareimage mixWithWhite).
      for (const v of defs!) expect(v, `--rack-plate-${color}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('the sleeve fills every disc in By Weight, for any Target on any rig', () => {
    fc.assert(
      fc.property(rigArb, unitArb, draftArb, (rig, u, draft) => {
        const el = on(rig, u);
        type(el, draft);
        const sleeve = sr(q(sr(el), 'rack-sleeve'));
        const colors = [...sleeve.querySelectorAll<HTMLElement>('.disc')].map(
          (d) => d.dataset.color ?? '',
        );
        expectAllFilled(sleeve, '.disc', colors);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('By Plates fills every sleeve disc, loaded chip and palette key, for any taps', () => {
    fc.assert(
      fc.property(rigArb, unitArb, fc.array(fc.nat(), { maxLength: 24 }), (rig, u, picks) => {
        const el = on(rig, u);
        modeBtn(el, 'encode').click();
        for (const i of picks) tapAdd(el, rig.inventory[i % rig.inventory.length]!.kg);
        const sleeve = sr(q(sr(el), 'rack-sleeve'));
        const colors = [...sleeve.querySelectorAll<HTMLElement>('.disc')].map(
          (d) => d.dataset.color ?? '',
        );
        expectAllFilled(sleeve, 'button.disc', colors);
        const chips = sr(q(sr(el), 'rack-loaded'));
        expectAllFilled(
          chips,
          '.chip',
          [...chips.querySelectorAll<HTMLElement>('.chip')].map((c) => c.dataset.color ?? ''),
        );
        expectAllFilled(sr(q(sr(el), 'rack-palette')), '.key', colorsOf(rig.inventory));
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  // Every drawn color is reached by the generated loads above; pin the full palette
  // directly too, so no color can go unexercised by a lucky seed.
  it('each set draws all of its colors filled (one of every Plate on the sleeve)', () => {
    for (const key of PLATE_SET_KEYS) {
      const side = PLATE_SETS[key].inventory;
      const fs = document.createElement('rack-fullscreen') as HTMLElement & {
        load: LoadSummary;
        open(): void;
      };
      document.body.append(fs);
      fs.load = { side, barKg: 20, collarKg: 0, unit: 'kg' };
      fs.open();
      expectAllFilled(sr(q(sr(fs), 'rack-sleeve')), '.disc', colorsOf(side));
    }
  });

  it('the fullscreen sleeve and the share card chips fill every Plate of any load', () => {
    fc.assert(
      fc.property(linkStateArb, (s) => {
        document.body.innerHTML = '';
        const load: LoadSummary = {
          side: s.side,
          barKg: s.barKg,
          collarKg: s.collarKg,
          unit: s.unit,
        };
        const fs = document.createElement('rack-fullscreen') as HTMLElement & {
          load: LoadSummary;
          open(): void;
        };
        document.body.append(fs);
        fs.load = load;
        fs.open();
        expectAllFilled(sr(q(sr(fs), 'rack-sleeve')), '.disc', colorsOf(s.side));

        const share = document.createElement('rack-share') as HTMLElement & {
          load: LoadSummary;
          plateSet: string;
          open(): void;
        };
        document.body.append(share);
        share.plateSet = s.set;
        share.load = load;
        share.open();
        const card = sr(share);
        const chipColors = [...card.querySelectorAll<HTMLElement>('[data-chip]')].map(
          (c) => c.dataset.color ?? '',
        );
        // One chip per run of the same Plate, in Side order.
        const runs = s.side.filter(
          (p, i, a) => i === 0 || p.kg !== a[i - 1]!.kg || p.color !== a[i - 1]!.color,
        );
        expect(chipColors).toEqual(colorsOf(runs));
        expectAllFilled(card, '[data-chip]', chipColors);
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  describe('the share picture (canvas)', () => {
    // The picture reads the tokens from the page; install tokens.css's values inline.
    beforeEach(() => {
      for (const [color, defs] of PLATE_TOKENS) {
        document.documentElement.style.setProperty(`--rack-plate-${color}`, defs[0]!);
      }
    });
    afterEach(() => {
      vi.restoreAllMocks();
      document.documentElement.removeAttribute('style');
    });

    it('paints every disc with a gradient ending in its Plate color token', async () => {
      const hexOf = new Map([...PLATE_TOKENS].map(([c, d]) => [d[0]!.toLowerCase(), c]));
      await fc.assert(
        fc.asyncProperty(linkStateArb, async (s) => {
          const gradients: string[][] = [];
          const ctx = new Proxy(
            {},
            {
              get(_t, prop: string) {
                if (prop === 'measureText') return (t: string) => ({ width: t.length * 10 });
                if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
                  return () => {
                    const stops: string[] = [];
                    gradients.push(stops);
                    return { addColorStop: (_o: number, c: string) => stops.push(c) };
                  };
                }
                return () => {};
              },
              set: () => true,
            },
          );
          vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
          vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
            cb(new Blob(['png'])),
          );
          const load = { side: s.side, barKg: s.barKg, collarKg: s.collarKg, unit: s.unit };
          expect(await shareImageFile(load, PLATE_SETS[s.set].label)).not.toBeNull();
          // The disc gradients are the ones whose last stop is a plate hex; the picture
          // draws one Side, so they are exactly that Side's colors, in order.
          const discs = gradients.filter((g) => hexOf.has((g.at(-1) ?? '').toLowerCase()));
          expect(discs.map((g) => hexOf.get(g.at(-1)!.toLowerCase()))).toEqual(
            colorsOf(s.side),
          );
          for (const g of discs) {
            expect(g).toHaveLength(2);
            for (const stop of g) expect(stop).toMatch(/^#[0-9a-f]{6}$/i);
          }
          vi.restoreAllMocks();
        }),
        { seed: SEED, numRuns: 30 },
      );
    });
  });
});
