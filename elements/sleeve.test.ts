import { describe, it, expect, vi } from 'vitest';
import './sleeve.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

function side(...kgs: number[]): Plate[] {
  return kgs.map((kg) => ELEIKO_KG.find((p) => p.kg === kg)!);
}

type Sleeve = HTMLElement & {
  sideLoad: readonly Plate[];
  interactive: boolean;
};

function mountSleeve(): Sleeve {
  const el = document.createElement('rack-sleeve') as Sleeve;
  document.body.append(el);
  return el;
}

function discs(el: HTMLElement): HTMLElement[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>('.disc')];
}

describe('<rack-sleeve>', () => {
  it('renders one disc per Plate, in Side Load order, tagged with kg and color', () => {
    const el = mountSleeve();
    el.sideLoad = side(25, 15);
    const discs = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.disc')];
    expect(discs.map((d) => d.dataset.kg)).toEqual(['25', '15']);
    expect(discs.map((d) => d.dataset.color)).toEqual(['red', 'yellow']);
  });

  it('renders no discs for an empty Side Load (a bare Bar)', () => {
    const el = mountSleeve();
    el.sideLoad = [];
    expect(el.shadowRoot!.querySelectorAll('.disc').length).toBe(0);
  });

  it('re-renders when the Side Load changes', () => {
    const el = mountSleeve();
    el.sideLoad = side(20);
    expect(el.shadowRoot!.querySelectorAll('.disc').length).toBe(1);
    el.sideLoad = side(25, 15, 5);
    expect(el.shadowRoot!.querySelectorAll('.disc').length).toBe(3);
  });

  describe('interactive mode (Encode: tap a disc to remove it)', () => {
    it('draws inert discs by default (Decode shows, does not edit)', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      expect(discs(el)[0].tagName).toBe('DIV');
    });

    it('draws discs as buttons when interactive', () => {
      const el = mountSleeve();
      el.interactive = true;
      el.sideLoad = side(25);
      expect(discs(el)[0].tagName).toBe('BUTTON');
    });

    it('emits removeplate with the tapped Plate when interactive', () => {
      const el = mountSleeve();
      el.interactive = true;
      el.sideLoad = side(25, 15);
      const seen = vi.fn();
      el.addEventListener('removeplate', (e) =>
        seen((e as CustomEvent<{ plate: Plate }>).detail.plate),
      );
      discs(el)[0].click(); // the 25 disc
      expect(seen).toHaveBeenCalledWith({ kg: 25, color: 'red' });
    });

    it('does not emit on a tap when not interactive', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      const seen = vi.fn();
      el.addEventListener('removeplate', seen);
      discs(el)[0].click();
      expect(seen).not.toHaveBeenCalled();
    });

    it('downgrades discs back to inert when interactive is turned off', () => {
      // Switching Encode -> Decode flips interactive off on every render; the live
      // remove buttons must become inert divs again, not leak a stale listener.
      const el = mountSleeve();
      el.interactive = true;
      el.sideLoad = side(25);
      expect(discs(el)[0].tagName).toBe('BUTTON');
      el.interactive = false;
      expect(discs(el)[0].tagName).toBe('DIV');
      const seen = vi.fn();
      el.addEventListener('removeplate', seen);
      discs(el)[0].click();
      expect(seen).not.toHaveBeenCalled();
    });
  });
});
