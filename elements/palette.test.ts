import { describe, it, expect, vi } from 'vitest';
import './palette.ts';
import { ELEIKO_KG, IRON_LB, withLimits } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

type Palette = HTMLElement & { inventory: readonly Plate[]; sideMm: number };

function mountPalette(): Palette {
  const el = document.createElement('rack-palette') as Palette;
  document.body.append(el);
  return el;
}

function keys(el: HTMLElement): HTMLButtonElement[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.key')];
}

describe('<rack-palette> (the Encode add-affordance)', () => {
  it('renders one tappable key per Eleiko denomination, heaviest-first', () => {
    const el = mountPalette();
    expect(keys(el).map((k) => k.dataset.kg)).toEqual(
      ELEIKO_KG.map((p) => String(p.kg)),
    );
  });

  it('tags each key with its color (lifters name a Plate by color)', () => {
    const el = mountPalette();
    expect(keys(el)[0].dataset.color).toBe('red'); // the 25
  });

  it('emits addplate with the tapped Plate', () => {
    const el = mountPalette();
    const seen = vi.fn();
    el.addEventListener('addplate', (e) =>
      seen((e as CustomEvent<{ plate: Plate }>).detail.plate),
    );
    keys(el)[0].click(); // the 25 kg key
    expect(seen).toHaveBeenCalledWith(ELEIKO_KG[0]); // the full 25 kg red Plate
  });

  it('bubbles and crosses the shadow boundary so the console can hear it', () => {
    const el = mountPalette();
    const seen = vi.fn();
    document.addEventListener('addplate', seen);
    keys(el)[4].click(); // the 5 kg key
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener('addplate', seen);
  });

  describe('sleeve-fit key disabling (RBAR-31, ADR-0012)', () => {
    it('disables keys whose Plate no longer fits the used sleeve width', () => {
      const el = mountPalette();
      el.sideMm = 398; // 6 x 25 + a 20 loaded: 17 mm of room left
      const enabled = keys(el)
        .filter((k) => !k.disabled)
        .map((k) => k.dataset.kg);
      expect(enabled).toEqual(['2.5', '0.5']); // 15 and 16 mm still fit; 20 mm+ do not
    });

    it('re-enables keys as room frees up', () => {
      const el = mountPalette();
      el.sideMm = 398;
      el.sideMm = 0;
      expect(keys(el).every((k) => !k.disabled)).toBe(true);
    });

    it('treats an exact boundary fit as room (iron 2.5 lb onto 398 mm)', () => {
      const el = mountPalette();
      el.inventory = IRON_LB;
      el.sideMm = 398; // the 17 mm iron 2.5 lands exactly on 415
      const enabled = keys(el)
        .filter((k) => !k.disabled)
        .map((k) => k.textContent);
      expect(enabled).toEqual(['2.5']);
    });

    it('keeps the fit state across an inventory re-render', () => {
      const el = mountPalette();
      el.sideMm = 398;
      el.inventory = IRON_LB; // re-render must not forget the used width
      const enabled = keys(el).filter((k) => !k.disabled);
      expect(enabled.map((k) => k.textContent)).toEqual(['2.5']);
    });
  });

  describe('the Add head row + "Sleeve full" warning (RBAR-54, handoff 4b)', () => {
    function warning(el: HTMLElement): HTMLElement {
      return el.shadowRoot!.querySelector<HTMLElement>('[data-sleeve-full]')!;
    }

    it('labels the palette section "Add" (the handoff 4b section label)', () => {
      const el = mountPalette();
      expect(
        el.shadowRoot!.querySelector('.head .label')!.textContent,
      ).toBe('Add');
    });

    it('starts hidden on an empty sleeve (everything fits)', () => {
      const el = mountPalette();
      expect(warning(el).hidden).toBe(true);
    });

    it('surfaces real "Sleeve full" text when NO Plate fits', () => {
      const el = mountPalette();
      el.sideMm = 401; // 14 mm of room: even the 15 mm 2.5 cannot land
      expect(keys(el).every((k) => k.disabled)).toBe(true);
      expect(warning(el).hidden).toBe(false);
      expect(warning(el).textContent).toContain('Sleeve full');
    });

    it('warns in the accent ink, per the handoff and the capacity-pill twin', () => {
      // Handoff L210 sets the warning in #f5c518 == --rb-accent (its L40 map), the
      // same treatment as By Weight's "Bar at capacity" dot (L142). Accent means
      // attention here; danger red belongs to destructive Clear -- and red text
      // reads ~4:1 on Platform Black beside lit red discs, which is what got this
      // flagged by eye in the first place.
      const el = mountPalette();
      const css = el.shadowRoot!.querySelector('style')!.textContent!;
      const start = css.indexOf('.full {');
      const rule = css.slice(start, css.indexOf('}', start));
      expect(start).toBeGreaterThan(-1);
      expect(rule).toContain('var(--rack-accent)');
      expect(css).not.toContain('var(--rack-danger)');
    });

    it('clears as soon as a removal frees room', () => {
      const el = mountPalette();
      el.sideMm = 401;
      el.sideMm = 343; // a 25 comes off
      expect(warning(el).hidden).toBe(true);
    });

    it('stays hidden in a partial-fit state (dimming alone covers that)', () => {
      const el = mountPalette();
      el.sideMm = 398; // 17 mm of room: only the 2.5 and 0.5 still fit
      expect(keys(el).some((k) => k.disabled)).toBe(true);
      expect(keys(el).some((k) => !k.disabled)).toBe(true);
      expect(warning(el).hidden).toBe(true);
    });

    it('keeps the warning across an inventory re-render', () => {
      const el = mountPalette();
      el.sideMm = 401; // 14 mm of room: no iron Plate (min 17 mm) fits either
      el.inventory = IRON_LB;
      expect(warning(el).hidden).toBe(false);
    });

    it('never warns on an empty Inventory (no Plate to add is not a room problem)', () => {
      const el = mountPalette();
      el.inventory = [];
      el.sideMm = 401;
      expect(warning(el).hidden).toBe(true);
    });
  });

  describe('the iron training Inventory (RBAR-17, ADR-0010)', () => {
    it('renders the iron denominations by their lb label when given the iron set', () => {
      const el = mountPalette();
      el.inventory = IRON_LB;
      expect(keys(el).map((k) => k.textContent)).toEqual(['45', '35', '25', '10', '5', '2.5']);
      expect(keys(el).every((k) => k.dataset.color === 'iron')).toBe(true);
    });

    it('emits the tapped iron Plate (true kg mass), for the pure addPlate transform', () => {
      const el = mountPalette();
      el.inventory = IRON_LB;
      const seen = vi.fn();
      el.addEventListener('addplate', (e) =>
        seen((e as CustomEvent<{ plate: Plate }>).detail.plate),
      );
      keys(el)[0].click(); // the 45 lb key
      expect(seen).toHaveBeenCalledWith(IRON_LB[0]);
    });
  });
});

describe('<rack-palette> under Pairs of Plates on Hand (RBAR-72, ADR-0016)', () => {
  it('dims and strikes a none size, badges a limited one, and never disables either', () => {
    const el = mountPalette();
    el.inventory = withLimits(ELEIKO_KG, { '25': 0, '15': 1, '5': 4 });
    const k = (kg: number) => keys(el).find((b) => Number(b.dataset.kg) === kg)!;
    expect(k(25).classList.contains('none')).toBe(true);
    expect(k(25).disabled).toBe(false);
    expect(k(25).getAttribute('aria-label')).toBe('Add 25 kg red Plate, none on hand');
    expect(k(25).querySelector('.badge')).toBeNull();
    expect(k(15).querySelector('.badge')!.textContent).toBe('x1');
    expect(k(15).disabled).toBe(false);
    expect(k(15).getAttribute('aria-label')).toBe('Add 15 kg yellow Plate, 1 pair on hand');
    expect(k(5).querySelector('.badge')!.textContent).toBe('x4');
    expect(k(20).querySelector('.badge')).toBeNull();
    expect(k(20).classList.contains('none')).toBe(false);
    const css = el.shadowRoot!.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.key\.none \{ opacity: \.38; \}/);
    expect(css).toMatch(/\.key\.none \.face \{ text-decoration: line-through; \}/);
  });

  it('a tap on a none size still emits addplate', () => {
    const el = mountPalette();
    el.inventory = withLimits(ELEIKO_KG, { '25': 0 });
    const seen = vi.fn();
    el.addEventListener('addplate', (e) =>
      seen((e as CustomEvent<{ plate: Plate }>).detail.plate.kg),
    );
    keys(el)[0].click();
    expect(seen).toHaveBeenCalledWith(25);
  });
});
