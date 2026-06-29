import { describe, it, expect, vi } from 'vitest';
import './palette.ts';
import { ELEIKO_KG, IRON_LB } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

type Palette = HTMLElement & { inventory: readonly Plate[] };

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
