import { describe, it, expect, vi } from 'vitest';
import './palette.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

function mountPalette(): HTMLElement {
  const el = document.createElement('rack-palette');
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
});
