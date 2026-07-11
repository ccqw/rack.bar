import { describe, it, expect, vi } from 'vitest';
import './fullscreen.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';

type Fullscreen = HTMLElement & {
  load: LoadSummary;
  plateSet: string;
  open(): void;
  close(): void;
};

const eleiko = (kg: number) => ELEIKO_KG.find((x) => x.kg === kg)!;

const LOADED: LoadSummary = {
  side: [eleiko(25), eleiko(25), eleiko(15), eleiko(2.5)],
  barKg: 20,
  collarKg: 0,
  unit: 'kg',
};

const BARE: LoadSummary = {
  side: [],
  barKg: 20,
  collarKg: 0,
  unit: 'kg',
};

function mount(load: LoadSummary = LOADED): { el: Fullscreen; root: ShadowRoot } {
  const el = document.createElement('rack-fullscreen') as Fullscreen;
  el.load = load;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

// The sleeve embedded in the card -- the blow-up reuses the real visualizer.
function sleeve(root: ShadowRoot): HTMLElement & { sideLoad: readonly Plate[]; interactive: boolean } {
  return root.querySelector('rack-sleeve')!;
}

describe('<rack-fullscreen>', () => {
  it('is hidden until opened, shown on open(), hidden again on close()', () => {
    const { el } = mount();
    expect(el.hidden).toBe(true);
    el.open();
    expect(el.hidden).toBe(false);
    el.close();
    expect(el.hidden).toBe(true);
  });

  it('close() dismisses and emits close', () => {
    const { el } = mount();
    el.open();
    const seen = vi.fn();
    el.addEventListener('close', seen);
    el.close();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(el.hidden).toBe(true);
  });

  it('derives + shows the Total in the display Unit', () => {
    // 20 Bar + 2 x (25 + 25 + 15 + 2.5) = 155 kg, derived (not stored).
    const { el, root } = mount();
    el.open();
    expect(root.querySelector('[data-total]')!.textContent!.trim()).toBe('155 kg');
  });

  it('reads the Total and caption in the load Unit (lb)', () => {
    const { el, root } = mount({
      side: [eleiko(25), eleiko(15)],
      barKg: 20,
      collarKg: 0,
      unit: 'lb',
    });
    el.open();
    // 20 + 2 x (25 + 15) = 100 kg -> 220 lb
    expect(root.querySelector('[data-total]')!.textContent!.trim()).toBe('220 lb');
  });

  it('captions with a secondary-unit line + per-side note (RBAR-30)', () => {
    const { el, root } = mount(LOADED); // comp / kg by default
    el.open();
    const sec = root.querySelector('[data-secondary]')!.textContent!;
    // The achieved Total in the OTHER unit (a kg load reads its secondary in lb) + per side.
    expect(sec).toContain('lb');
    expect(sec).toContain('per side');
  });

  it('names the plate set + Bar in the config line, Collars only when fitted (RBAR-30)', () => {
    const none = mount(LOADED);
    none.el.open();
    const cap = none.root.querySelector('[data-caption]')!.textContent!;
    expect(cap).toContain('Competition'); // the active plate set
    expect(cap).toContain('20 kg / 44 lb bar'); // the Bar, dual-unit (RBAR-44 configText)
    expect(cap).not.toContain('collar'); // None fitted
    expect(cap).not.toContain('per side'); // the per-side note moved to the secondary line

    const withCollar = mount({ ...LOADED, collarKg: 2.5 });
    withCollar.el.open();
    expect(withCollar.root.querySelector('[data-caption]')!.textContent).toContain(
      'collars 2.5 kg',
    );
  });

  it('reflects the active plate set name in the caption (RBAR-30)', () => {
    const { el, root } = mount(LOADED);
    el.plateSet = 'training';
    el.open();
    expect(root.querySelector('[data-caption]')!.textContent).toContain('Training');
  });

  it('blows up the current Side Load through the embedded sleeve', () => {
    const { el, root } = mount();
    el.open();
    expect(sleeve(root).sideLoad).toEqual(LOADED.side);
  });

  it('shows the bare rig (empty sleeve) when nothing is loaded', () => {
    const { el, root } = mount(BARE);
    el.open();
    expect(sleeve(root).sideLoad).toEqual([]);
  });

  it('renders the blown-up bar inert -- you tap to exit, not to edit', () => {
    const { el, root } = mount();
    el.open();
    expect(sleeve(root).interactive).toBe(false);
  });

  it('carries the wordmark', () => {
    const { el, root } = mount();
    el.open();
    expect(root.querySelector('[data-wordmark]')!.textContent).toContain('rack');
  });

  it('tapping anywhere on the immersive view exits', () => {
    const { el, root } = mount();
    el.open();
    (root.querySelector('[data-overlay]') as HTMLElement).click();
    expect(el.hidden).toBe(true);
  });

  it('the close button exits', () => {
    const { el, root } = mount();
    el.open();
    (root.querySelector('[data-close]') as HTMLButtonElement).click();
    expect(el.hidden).toBe(true);
  });

  it('reflects a load reassigned while open (live)', () => {
    const { el, root } = mount(BARE);
    el.open();
    expect(root.querySelector('[data-total]')!.textContent!.trim()).toBe('20 kg');
    el.load = LOADED;
    expect(root.querySelector('[data-total]')!.textContent!.trim()).toBe('155 kg');
    expect(sleeve(root).sideLoad).toEqual(LOADED.side);
  });
});

describe('<rack-fullscreen> (numeric typography, RBAR-39)', () => {
  // Prototype L321: the fullscreen total carries a separate 22px/600 text-dim unit
  // suffix; the value keeps the Hanken 800 / 58px-cap / tnum treatment it already had.
  function rule(root: ShadowRoot, selector: string): string {
    const css = root.querySelector('style')!.textContent!;
    const start = css.indexOf(selector);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('splits the huge total into a value and a small dim unit suffix (22px/600)', () => {
    const { el, root } = mount();
    el.open();
    expect(root.querySelector('[data-total-num]')!.textContent).toBe('155');
    expect(root.querySelector('[data-total-unit]')!.textContent).toBe(' kg');
    const tu = rule(root, '.total .tu');
    expect(tu).toContain('font-size: 22px');
    expect(tu).toContain('font-weight: 600');
    expect(tu).toContain('var(--rack-text-dim)');
  });

  it('arms the roll on the value, never the suffix, when the Total changes', () => {
    const { el, root } = mount(BARE); // 20 kg
    el.open();
    el.load = LOADED; // 20 -> 155: a real change, the roll arms
    expect(root.querySelector('[data-total-num]')!.classList.contains('roll')).toBe(true);
    expect(root.querySelector('[data-total-unit]')!.classList.contains('roll')).toBe(false);
  });
});
