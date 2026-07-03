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

  it('re-renders the Bar tiles for the active set: a single 45 lb Bar on Training', () => {
    const { el, root } = mountSetup();
    el.plateSet = 'training';
    el.barKg = lbToKg(45);
    // the kg tiles are gone; the one iron Bar tile reads in pounds
    expect(root.querySelector('[data-bar="20"]')).toBeNull();
    const ironTile = root.querySelector<HTMLButtonElement>(
      `[data-bar="${lbToKg(45)}"]`,
    )!;
    expect(ironTile).toBeTruthy();
    expect(ironTile.textContent).toContain('45');
    expect(ironTile.getAttribute('aria-pressed')).toBe('true');
  });
});

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
