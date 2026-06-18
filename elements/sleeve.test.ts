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

  describe('real plate sizing (ADR-0004: side-on, height=diameter, width=thickness)', () => {
    // happy-dom does no layout, so we assert the sizing *inputs* the element hands to
    // CSS -- each disc carries its real mm as custom properties -- not painted pixels.
    // The fit-to-width scale and the actual proportions are eyeballed on npm run dev.
    function mm(disc: HTMLElement): { d: number; w: number } {
      return {
        d: Number(disc.style.getPropertyValue('--mm-d')),
        w: Number(disc.style.getPropertyValue('--mm-w')),
      };
    }

    it('drives each disc height from real diameter, width from real thickness', () => {
      const el = mountSleeve();
      el.sideLoad = side(25); // 450 mm diameter, 58 mm thick (ADR-0004)
      expect(mm(discs(el)[0])).toEqual({ d: 450, w: 58 });
    });

    it('draws the same-diameter bumpers the same height, the heavier one fatter', () => {
      const el = mountSleeve();
      el.sideLoad = side(25, 10); // both 450 mm tall; 58 vs 35 mm thick
      const [a, b] = discs(el).map(mm);
      expect(a.d).toBe(b.d); // same height -- bumpers don't grow in diameter
      expect(a.w).toBeGreaterThan(b.w); // the 25 reads as the fatter disc
    });

    it('nests the small plates down in height below a bumper', () => {
      const el = mountSleeve();
      el.sideLoad = side(25, 5); // 450 mm bumper vs 228 mm disc
      const [bumper, small] = discs(el).map(mm);
      expect(small.d).toBeLessThan(bumper.d);
    });
  });

  describe('kg labels (on the disc, one per Plate)', () => {
    function labels(el: HTMLElement): HTMLElement[] {
      return [...el.shadowRoot!.querySelectorAll<HTMLElement>('.label')];
    }

    it('renders one label per Plate, in Side Load order', () => {
      const el = mountSleeve();
      el.sideLoad = side(25, 15, 5);
      expect(labels(el).map((l) => l.textContent)).toEqual(['25', '15', '5']);
    });

    it('drops the leading zero on the sub-1 change plate (0.5 -> .5)', () => {
      const el = mountSleeve();
      el.sideLoad = side(2.5, 1.5, 0.5);
      // 2.5 / 1.5 keep their leading digit; only the sub-1 plate loses the zero.
      expect(labels(el).map((l) => l.textContent)).toEqual(['2.5', '1.5', '.5']);
    });

    it('puts the label on the disc, hidden from assistive tech (the disc carries the aria-label)', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      const disc = discs(el)[0];
      expect(disc.querySelector('.label')).not.toBeNull(); // the label lives on the disc
      expect(labels(el)[0].getAttribute('aria-hidden')).toBe('true'); // not announced twice
      // The disc itself carries the accessible name (so the aria-hidden caption isn't a gap).
      expect(disc.getAttribute('aria-label')).toBe('25 kg red Plate');
    });

    it('names the disc with the Remove verb in Encode (the tap target a screen reader hears)', () => {
      const el = mountSleeve();
      el.interactive = true;
      el.sideLoad = side(25);
      expect(discs(el)[0].getAttribute('aria-label')).toBe('Remove 25 kg red Plate');
    });
  });

  describe('digit stacking (a thin plate too narrow for a horizontal number)', () => {
    function labelHtml(el: HTMLElement): string[] {
      return [...el.shadowRoot!.querySelectorAll<HTMLElement>('.label')].map(
        (l) => l.innerHTML,
      );
    }

    it('stacks a thin change plate\'s digits one per line, upright', () => {
      const el = mountSleeve();
      el.sideLoad = side(2.5, 0.5); // both under the 30 mm stack threshold
      // textContent still reads the plain kg (the <br>s drop out), but the markup stacks.
      expect(labelHtml(el)).toEqual(['2<br>.<br>5', '.<br>5']);
    });

    it('keeps a bumper\'s multi-digit number horizontal (wide enough, above the threshold)', () => {
      const el = mountSleeve();
      el.sideLoad = side(25, 10); // 58 / 35 mm thick, both >= 30 mm -> no stacking
      expect(labelHtml(el)).toEqual(['25', '10']);
    });

    it('never stacks a single-digit label, thin plate or not', () => {
      const el = mountSleeve();
      el.sideLoad = side(5, 2, 1); // thin plates, but one character each
      expect(labelHtml(el)).toEqual(['5', '2', '1']);
    });
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
      expect(seen).toHaveBeenCalledWith(side(25)[0]); // the full 25 kg red Plate
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
