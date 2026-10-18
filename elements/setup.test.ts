import { describe, it, expect, vi } from 'vitest';
import './setup.ts';
import { lbToKg } from '../lib/units.ts';

type Setup = HTMLElement & {
  barKg: number;
  collarKg: number;
  plateSet: string;
  open(): void;
  close(): void;
};

function mountSetup(): { el: Setup; root: ShadowRoot } {
  const el = document.createElement('rack-setup') as Setup;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

function tile(root: ShadowRoot, kg: number): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`[data-bar="${kg}"]`)!;
}

function collarTile(root: ShadowRoot, kg: number): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`[data-collar="${kg}"]`)!;
}

function collarchangeSpy(el: HTMLElement): ReturnType<typeof vi.fn> {
  const seen = vi.fn();
  el.addEventListener('collarchange', (e) =>
    seen((e as CustomEvent<{ collarKg: number }>).detail.collarKg),
  );
  return seen;
}

function barchangeSpy(el: HTMLElement): ReturnType<typeof vi.fn> {
  const seen = vi.fn();
  el.addEventListener('barchange', (e) =>
    seen((e as CustomEvent<{ barKg: number }>).detail.barKg),
  );
  return seen;
}

describe('<rack-setup> (the Setup bottom sheet, RBAR-15)', () => {
  it('starts closed', () => {
    const { el } = mountSetup();
    expect(el.hidden).toBe(true);
  });

  it('open() shows the sheet; close() hides it and emits close', () => {
    const { el } = mountSetup();
    const closed = vi.fn();
    el.addEventListener('close', closed);
    el.open();
    expect(el.hidden).toBe(false);
    el.close();
    expect(el.hidden).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('renders three Bar tiles (20 / 15 / 5 kg) each with its whole-pound subtitle', () => {
    const { root } = mountSetup();
    expect(tile(root, 20)).toBeTruthy();
    expect(tile(root, 15)).toBeTruthy();
    expect(tile(root, 5)).toBeTruthy();
    // lb subtitle = round(kg x 2.2046): 20 -> 44, 15 -> 33, 5 -> 11.
    expect(tile(root, 20).textContent).toContain('20');
    expect(tile(root, 20).textContent).toContain('44');
    expect(tile(root, 15).textContent).toContain('33');
    expect(tile(root, 5).textContent).toContain('11');
  });

  it('marks the tile matching barKg as the active selection (default 20 kg)', () => {
    const { root } = mountSetup();
    // Default Bar is 20 kg.
    expect(tile(root, 20).getAttribute('aria-pressed')).toBe('true');
    expect(tile(root, 15).getAttribute('aria-pressed')).toBe('false');
    expect(tile(root, 5).getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects a set barKg onto the active tile', () => {
    const { el, root } = mountSetup();
    el.barKg = 15;
    expect(tile(root, 15).getAttribute('aria-pressed')).toBe('true');
    expect(tile(root, 20).getAttribute('aria-pressed')).toBe('false');
  });

  it('emits barchange with the chosen Bar when a tile is tapped', () => {
    const { el, root } = mountSetup();
    const seen = barchangeSpy(el);
    tile(root, 15).click();
    expect(seen).toHaveBeenLastCalledWith(15);
    tile(root, 5).click();
    expect(seen).toHaveBeenLastCalledWith(5);
  });

  it('closes on a scrim tap but not on a tap inside the panel', () => {
    const { el, root } = mountSetup();
    el.open();
    root.querySelector<HTMLElement>('[data-panel]')!.click();
    expect(el.hidden).toBe(false); // a tap on the sheet body does not dismiss
    root.querySelector<HTMLElement>('[data-scrim]')!.click();
    expect(el.hidden).toBe(true); // a tap on the dim backdrop does
  });

  it('closes on the Done button', () => {
    const { el, root } = mountSetup();
    el.open();
    root.querySelector<HTMLButtonElement>('[data-done]')!.click();
    expect(el.hidden).toBe(true);
  });
});

describe('<rack-setup> Collars section (RBAR-16, ADR-0008)', () => {
  it('renders two Collar tiles: None (0) and Standard 2.5 kg', () => {
    const { root } = mountSetup();
    expect(collarTile(root, 0)).toBeTruthy();
    expect(collarTile(root, 2.5)).toBeTruthy();
    expect(collarTile(root, 0).textContent).toContain('None');
    expect(collarTile(root, 2.5).textContent).toContain('2.5');
  });

  it('defaults to None as the active Collar selection', () => {
    const { root } = mountSetup();
    expect(collarTile(root, 0).getAttribute('aria-pressed')).toBe('true');
    expect(collarTile(root, 2.5).getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects a set collarKg onto the active tile', () => {
    const { el, root } = mountSetup();
    el.collarKg = 2.5;
    expect(collarTile(root, 2.5).getAttribute('aria-pressed')).toBe('true');
    expect(collarTile(root, 0).getAttribute('aria-pressed')).toBe('false');
  });

  it('emits collarchange with the chosen Collar when a tile is tapped', () => {
    const { el, root } = mountSetup();
    const seen = collarchangeSpy(el);
    collarTile(root, 2.5).click();
    expect(seen).toHaveBeenLastCalledWith(2.5);
    collarTile(root, 0).click();
    expect(seen).toHaveBeenLastCalledWith(0);
  });

  // The handoff ConfigSheet copy (RBAR-29 fold): None reads "bare sleeve", the
  // Standard tile names itself and carries the both-unit weight sub.
  it('the tiles carry the handoff copy: None / bare sleeve, Standard / 2.5 kg / 6 lb', () => {
    const { root } = mountSetup();
    expect(collarTile(root, 0).textContent).toContain('None');
    expect(collarTile(root, 0).textContent).toContain('bare sleeve');
    expect(collarTile(root, 2.5).textContent).toContain('Standard');
    expect(collarTile(root, 2.5).textContent).toContain('2.5 kg');
    expect(collarTile(root, 2.5).textContent).toContain('6 lb');
    // the accessible name keeps the per-Side fact the visible sub dropped (ADR-0008)
    expect(collarTile(root, 2.5).getAttribute('aria-label')).toContain('per Side');
  });
});

describe('<rack-setup> Plates section (RBAR-17, ADR-0010)', () => {
  function platesetTile(root: ShadowRoot, key: string): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>(`[data-plateset="${key}"]`)!;
  }

  it('renders Competition and Training tiles, Competition active by default', () => {
    const { root } = mountSetup();
    expect(platesetTile(root, 'comp').textContent).toContain('Competition');
    expect(platesetTile(root, 'training').textContent).toContain('Training');
    expect(platesetTile(root, 'comp').getAttribute('aria-pressed')).toBe('true');
    expect(platesetTile(root, 'training').getAttribute('aria-pressed')).toBe('false');
  });

  it('emits platesetchange when a plate-set tile is tapped', () => {
    const { el, root } = mountSetup();
    const seen = vi.fn();
    el.addEventListener('platesetchange', (e) =>
      seen((e as CustomEvent<{ plateSet: string }>).detail.plateSet),
    );
    platesetTile(root, 'training').click();
    expect(seen).toHaveBeenLastCalledWith('training');
  });

  it('re-renders the Bar tiles for the active set: 45 lb and 20 kg on Training', () => {
    const { el, root } = mountSetup();
    el.plateSet = 'training';
    el.barKg = lbToKg(45);
    // the Competition 15 / 5 kg tiles are gone; Training offers two Bars (RBAR-63)
    expect(root.querySelector('[data-bar="15"]')).toBeNull();
    expect(root.querySelectorAll('[data-bar]')).toHaveLength(2);
    const ironTile = tile(root, lbToKg(45));
    expect(word(ironTile)).toBe('45 lb');
    expect(csub(ironTile)).toBe('20.41 kg');
    expect(ironTile.getAttribute('aria-pressed')).toBe('true');
    expect(ironTile.getAttribute('aria-label')).toBe('45 lb Bar (20.41 kg)');
  });

  it('labels the Training 20 kg Bar in kg, its stamped unit, never "44 lb" (RBAR-63)', () => {
    const { el, root } = mountSetup();
    el.plateSet = 'training';
    el.barKg = 20;
    const kgTile = tile(root, 20);
    expect(word(kgTile)).toBe('20 kg');
    expect(csub(kgTile)).toBe('44 lb');
    expect(kgTile.getAttribute('aria-label')).toBe('20 kg Bar (44 lb)');
    expect(kgTile.getAttribute('aria-pressed')).toBe('true');
    expect(tile(root, lbToKg(45)).getAttribute('aria-pressed')).toBe('false');
  });

  it('emits barchange with 20 when the Training 20 kg tile is tapped', () => {
    const { el, root } = mountSetup();
    el.plateSet = 'training';
    el.barKg = lbToKg(45);
    const seen = barchangeSpy(el);
    tile(root, 20).click();
    expect(seen).toHaveBeenLastCalledWith(20);
  });
});

const word = (t: HTMLElement) => t.querySelector('.word')!.textContent;
const csub = (t: HTMLElement) => t.querySelector('.csub')!.textContent;

describe('<rack-setup> plate-set row swatches + selected check (RBAR-29)', () => {
  function row(root: ShadowRoot, key: string): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>(`[data-plateset="${key}"]`)!;
  }

  // Each swatch carries its fill as an inline style var(); the order is the render order.
  function swatchFills(root: ShadowRoot, key: string): string[] {
    return [...row(root, key).querySelectorAll<HTMLElement>('.swatch')].map(
      (s) => s.getAttribute('style') ?? '',
    );
  }

  it('the Competition row carries the four bumper swatches, heaviest-first', () => {
    const { root } = mountSetup();
    const fills = swatchFills(root, 'comp');
    expect(fills).toHaveLength(4);
    expect(fills[0]).toContain('var(--rack-plate-red)');
    expect(fills[1]).toContain('var(--rack-plate-blue)');
    expect(fills[2]).toContain('var(--rack-plate-yellow)');
    expect(fills[3]).toContain('var(--rack-plate-green)');
  });

  it('the Training row alternates the two iron swatch greys', () => {
    const { root } = mountSetup();
    const fills = swatchFills(root, 'training');
    expect(fills).toHaveLength(4);
    expect(fills[0]).toContain('var(--rack-swatch-iron)');
    expect(fills[1]).toContain('var(--rack-swatch-iron-deep)');
    expect(fills[2]).toContain('var(--rack-swatch-iron)');
    expect(fills[3]).toContain('var(--rack-swatch-iron-deep)');
  });

  it('swatches and the check are decorative; the row still announces the set + unit', () => {
    const { root } = mountSetup();
    for (const key of ['comp', 'training']) {
      const r = row(root, key);
      expect(r.querySelector('.swatches')!.getAttribute('aria-hidden')).toBe('true');
      expect(r.querySelector('.check')!.getAttribute('aria-hidden')).toBe('true');
    }
    expect(row(root, 'comp').getAttribute('aria-label')).toContain('Competition plates');
    expect(row(root, 'comp').getAttribute('aria-label')).toContain('kg');
    expect(row(root, 'training').getAttribute('aria-label')).toContain('lb');
  });

  // RBAR-86: the visible family/Unit subtitle is cut; the accessible name keeps it.
  it('shows only the set name; the aria-label still carries the family + Unit', () => {
    const { root } = mountSetup();
    expect(row(root, 'comp').getAttribute('aria-label')).toBe(
      'Competition plates (Eleiko - color-coded - kg)',
    );
    expect(row(root, 'training').getAttribute('aria-label')).toBe(
      'Training plates (Plain black iron - lb)',
    );
    for (const key of ['comp', 'training']) {
      expect(row(root, key).querySelector('.sub')).toBeNull();
      expect(row(root, key).textContent!.trim()).toBe(key === 'comp' ? 'Competition' : 'Training');
    }
  });

  it('both rows carry a check whose visibility keys off the pressed row', () => {
    const { el, root } = mountSetup();
    expect(row(root, 'comp').querySelector('.check')).toBeTruthy();
    expect(row(root, 'training').querySelector('.check')).toBeTruthy();
    // The check shows/hides via CSS keyed on aria-pressed (happy-dom computes no
    // styles, so lock the rule text)...
    const css = root.querySelector('style')!.textContent!;
    expect(css).toContain('.row[aria-pressed="true"] .check');
    // ...and the pressed state follows the reflected plate set, so the check moves.
    el.plateSet = 'training';
    expect(row(root, 'training').getAttribute('aria-pressed')).toBe('true');
    expect(row(root, 'comp').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('<rack-setup> (Bar-tile typography, RBAR-39)', () => {
  // Prototype L863: the Bar-tile headline is Hanken 700 14px, textPrimary on the
  // active tile and text-dim otherwise -- the same treatment the Collar tiles'
  // .word/.csub already carry, so the Bar tiles reuse those classes.
  it('renders the Bar headline as word + csub (the Collar tiles dim pattern)', () => {
    const { root } = mountSetup();
    expect(tile(root, 20).querySelector('.word')!.textContent).toBe('20 kg');
    expect(tile(root, 20).querySelector('.csub')!.textContent).toBe('44 lb');
    expect(tile(root, 15).querySelector('.word')!.textContent).toBe('15 kg');
  });

  it('sets the headline in Hanken 700 14px (buttons do not inherit fonts)', () => {
    const { root } = mountSetup();
    const css = root.querySelector('style')!.textContent!;
    const start = css.indexOf('.tile .word');
    expect(start).toBeGreaterThanOrEqual(0);
    const word = css.slice(start, css.indexOf('}', start));
    expect(word).toContain('var(--rack-font)');
    expect(word).toContain('font-weight: 700');
    expect(word).toContain('font-size: 14px');
    expect(word).toContain('var(--rack-text-dim)'); // inactive dims like the Collars
    // the active tile brightens the headline (the dimming half of the contract)
    expect(css).toContain('.tile[aria-pressed="true"] .word');
  });

  it('keeps no always-bright mono headline on the Bar tiles', () => {
    const { root } = mountSetup();
    expect(root.querySelector('[data-bar="20"] .kg')).toBeNull(); // the old 20px mono span
  });
});

// RBAR-74 (the RBAR-48a metrics sweep): the Setup sheet's metrics, shadow and entrance,
// matched to the handoff prototype (L252-L269). Text locks on the rule bodies.
describe('<rack-setup> metrics sweep (RBAR-74)', () => {
  function rule(root: ShadowRoot, selector: string): string {
    const css = root.querySelector('style')!.textContent!;
    const start = css.indexOf(selector);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('pads the panel 18px 20px 26px and lifts it with the Setup shadow (prototype L252)', () => {
    const { root } = mountSetup();
    const panel = rule(root, '.panel {');
    expect(panel).toContain('padding: 18px 20px calc(26px + env(safe-area-inset-bottom))');
    expect(panel).toContain('box-shadow: var(--rack-shadow-setup)');
  });

  it('rises with sheetIn .26s on the spring curve, fading in (prototype L21/L252)', () => {
    const { root } = mountSetup();
    const css = root.querySelector('style')!.textContent!;
    // Everyone gets the fade; only a no-preference lifter gets the rise, fade included.
    expect(rule(root, '.panel {')).toContain('animation: rack-fade .26s cubic-bezier(.2, .85, .25, 1)');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.panel \{ animation: rack-rise \.26s cubic-bezier\(\.2, \.85, \.25, 1\); \}/,
    );
    expect(css).toMatch(/rack-rise \{\s*from \{ transform: translateY\(100%\); opacity: 0; \}/);
  });

  it('sets the head 18px above the first section; title 800 17px -.01em (prototype L253-L254)', () => {
    const { root } = mountSetup();
    expect(rule(root, '.head {')).toContain('margin-bottom: 18px');
    const title = rule(root, '.head .title {');
    expect(title).toContain('font-weight: 800');
    expect(title).toContain('font-size: 17px');
    expect(title).toContain('letter-spacing: -.01em');
  });

  it('sets Done at Hanken 700 12px on a 7px 17px pad (prototype L255)', () => {
    const { root } = mountSetup();
    const done = rule(root, '.done {');
    expect(done).toContain('font-size: 12px');
    expect(done).toContain('font-weight: 700');
    expect(done).toContain('padding: 7px 17px');
  });

  it('spaces the sections: label 9px, section 20px (prototype L257-L264)', () => {
    const { root } = mountSetup();
    expect(rule(root, '.section-label {')).toContain('margin: 0 0 9px');
    expect(rule(root, '.tiles {')).toContain('margin-bottom: 20px');
  });
});
