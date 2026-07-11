import { describe, it, expect, vi } from 'vitest';
import './sleeve.ts';
import { ELEIKO_KG, IRON_LB } from '../lib/plates.ts';
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

  describe('the barbell chrome (RBAR-24: a centered sleeve, not a one-sided strip)', () => {
    function has(el: HTMLElement, sel: string): boolean {
      return el.shadowRoot!.querySelector(sel) !== null;
    }

    it('frames the loaded discs with a sleeve shaft, inner collar, end collar, and end cap', () => {
      const el = mountSleeve();
      el.sideLoad = side(25, 15);
      expect(has(el, '.shaft')).toBe(true);
      expect(has(el, '.collar-inner')).toBe(true);
      expect(has(el, '.collar-end')).toBe(true);
      expect(has(el, '.cap')).toBe(true);
    });

    it('keeps the full chrome on a bare Bar (the empty state is still a barbell)', () => {
      const el = mountSleeve();
      el.sideLoad = [];
      expect(has(el, '.shaft')).toBe(true);
      expect(has(el, '.collar-inner')).toBe(true);
      expect(has(el, '.collar-end')).toBe(true);
      expect(has(el, '.cap')).toBe(true);
    });

    it('renders the chrome decoratively (the discs carry the accessible names)', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      for (const sel of ['.shaft', '.collar-inner', '.collar-end', '.cap']) {
        expect(el.shadowRoot!.querySelector(sel)!.getAttribute('aria-hidden')).toBe('true');
      }
    });
  });

  describe('the empty state (RBAR-24: a dashed box with a +, not a bare stub)', () => {
    it('draws a dashed empty box with a + and no discs for a bare Bar', () => {
      const el = mountSleeve();
      el.sideLoad = [];
      const box = el.shadowRoot!.querySelector('.empty');
      expect(box).not.toBeNull();
      expect(box!.textContent).toContain('+');
      expect(el.shadowRoot!.querySelectorAll('.disc').length).toBe(0);
    });

    it('drops the empty box once a Plate is loaded', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      expect(el.shadowRoot!.querySelector('.empty')).toBeNull();
      expect(el.shadowRoot!.querySelectorAll('.disc').length).toBe(1);
    });
  });

  describe('disc treatment (RBAR-24: top-lit gradient + the disc shadow token)', () => {
    function styleText(el: HTMLElement): string {
      return el.shadowRoot!.querySelector('style')!.textContent!;
    }

    it('fills each disc with the documented top-lit gradient over its plate hex', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      expect(styleText(el)).toContain(
        'linear-gradient(180deg, color-mix(in srgb, var(--disc) 95%, #fff), var(--disc))',
      );
    });

    it('lifts each disc with the shared --rack-shadow-disc token', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      expect(styleText(el)).toContain('box-shadow: var(--rack-shadow-disc)');
    });
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

  describe('engraved numerals (RBAR-41: rotated -90deg, adaptive size, hidden when too thin)', () => {
    function styleText(el: HTMLElement): string {
      return el.shadowRoot!.querySelector('style')!.textContent!;
    }

    it('rotates the numeral -90deg in mono 800 with the prototype letter-spacing', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      const css = styleText(el);
      expect(css).toContain('transform: rotate(-90deg)');
      expect(css).toContain('font-weight: 800');
      expect(css).toContain('letter-spacing: .04em');
    });

    it('engraves the numeral: light lip under dark ink, dark seat under light ink', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      const css = styleText(el);
      // prototype vm L731: the shadow direction keys off the ink, not the plate hex
      expect(css).toContain('text-shadow: 0 1px 0 rgba(255,255,255,.3)');
      expect(css).toContain('text-shadow: 0 1px 1px rgba(0,0,0,.4)');
    });

    it('clips the rotated numeral to its disc (overflow hidden)', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      expect(styleText(el)).toContain('overflow: hidden');
    });

    it('buckets the numeral size by the disc\'s rendered width (11 / 9 / 8 px)', () => {
      const el = mountSleeve();
      // full zoom (168/450 px per mm): 58 mm -> ~21.7 px, 35 mm -> ~13.1 px,
      // 20 mm -> ~7.5 px floored to the 9 px min (prototype vm L727 buckets)
      el.sideLoad = side(25, 10, 5);
      expect(discs(el).map((d) => d.dataset.numeral)).toEqual(['11', '9', '8']);
    });

    it('keeps a multi-digit label on one rotated line (no per-digit stacking)', () => {
      const el = mountSleeve();
      el.sideLoad = side(2.5, 0.5);
      const html = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.label')].map(
        (l) => l.innerHTML,
      );
      expect(html).toEqual(['2.5', '.5']); // the RBAR-9 <br> stacking is retired
    });

    it('shows no numeral on a disc squeezed below the readable floor', () => {
      const el = mountSleeve();
      // A narrow host + a wall of floored thin plates forces the overflow guard;
      // the squeezed discs can no longer seat their digits, so the numeral goes.
      Object.defineProperty(el, 'clientWidth', { value: 200, configurable: true });
      el.sideLoad = side(...Array(13).fill(0.5));
      for (const d of discs(el)) expect(d.dataset.numeral).toBeUndefined();
    });
  });

  describe('block geometry + overflow guard (RBAR-41: 204px block, 168px cap, no overflow)', () => {
    // The fixed chrome the fit budget reserves (sleeve.ts constants, text-locked here
    // the same way the mm sizing tests lock the plate table).
    const CHROME = 52 + 11 + 8 + 13;
    const END_GAP = 3;
    const DISC_GAP = 1.5;
    const MIN_DISC = 9;

    function styleText(el: HTMLElement): string {
      return el.shadowRoot!.querySelector('style')!.textContent!;
    }
    function fitted(width: number, load: Plate[]): Sleeve {
      const el = mountSleeve();
      Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
      el.sideLoad = load;
      return el;
    }
    function rowPx(el: Sleeve, load: Plate[]): number {
      const scale = Number(el.style.getPropertyValue('--rack-mm-scale'));
      const shrink = Number(el.style.getPropertyValue('--rack-fit-shrink') || '1');
      return load.reduce((px, p) => px + Math.max(p.widthMm * scale, MIN_DISC) * shrink, 0);
    }

    it('reserves the handoff\'s 204px block height', () => {
      const el = mountSleeve();
      el.sideLoad = side(25);
      expect(styleText(el)).toContain('min-height: 204px');
    });

    it('caps a bumper at the prototype\'s 168px scale at full zoom', () => {
      const el = fitted(390, side(25, 15));
      expect(el.style.getPropertyValue('--rack-mm-scale')).toBe(String(168 / 450));
    });

    it('shrinks a floored wall of thin plates proportionally instead of overflowing', () => {
      const load = side(...Array(13).fill(0.5));
      const el = fitted(200, load);
      const shrink = Number(el.style.getPropertyValue('--rack-fit-shrink'));
      expect(shrink).toBeGreaterThan(0);
      expect(shrink).toBeLessThan(1);
      const budget = 200 - CHROME - END_GAP - DISC_GAP * (load.length - 1);
      expect(rowPx(el, load)).toBeLessThanOrEqual(budget + 1e-6);
    });

    it('keeps the shrink sane for a bare Bar on a host narrower than the chrome', () => {
      // An empty row is 0 wide; without the row > 0 guard the shrink would be 0/0 NaN.
      const el = fitted(60, []);
      const shrink = el.style.getPropertyValue('--rack-fit-shrink');
      expect(shrink === '' || shrink === '1').toBe(true);
    });

    it('never overflows the host across mixed loads and widths (the AC property case)', () => {
      const loads = [
        side(25, 25, 25, 25, 25, 25),
        side(25, 10, 5, 2.5, 1, 0.5),
        side(...Array(20).fill(0.5)),
        side(...Array(8).fill(2.5)),
      ];
      for (const width of [200, 280, 390]) {
        for (const load of loads) {
          const el = fitted(width, load);
          const budget = width - CHROME - END_GAP - DISC_GAP * (load.length - 1);
          expect(rowPx(el, load)).toBeLessThanOrEqual(budget + 1e-6);
        }
      }
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

  describe('the iron training set (RBAR-17, ADR-0010)', () => {
    it('labels an iron disc by its stamped lb face, not its kg mass', () => {
      const el = mountSleeve();
      el.sideLoad = [IRON_LB[0], IRON_LB[5]]; // 45 lb, 2.5 lb
      const ds = discs(el);
      expect(ds.map((d) => d.dataset.color)).toEqual(['iron', 'iron']);
      // the visible on-disc label reads the lb face (45), not 20.41166 kg
      expect(ds[0].querySelector('.label')!.textContent).toBe('45');
      // the accessible name names it in pounds
      expect(ds[0].getAttribute('aria-label')).toBe('45 lb iron Plate');
    });
  });
});
