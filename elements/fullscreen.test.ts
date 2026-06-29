import { describe, it, expect, vi } from 'vitest';
import './fullscreen.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';

type Fullscreen = HTMLElement & {
  load: LoadSummary;
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

  it('captions the rig config with a per-side note, naming Collars only when fitted', () => {
    const none = mount(LOADED);
    none.el.open();
    expect(none.root.querySelector('[data-caption]')!.textContent).toContain('20 kg');
    expect(none.root.querySelector('[data-caption]')!.textContent).toContain('per side');
    expect(none.root.querySelector('[data-caption]')!.textContent).not.toContain('collar');

    const withCollar = mount({ ...LOADED, collarKg: 2.5 });
    withCollar.el.open();
    expect(withCollar.root.querySelector('[data-caption]')!.textContent).toContain(
      'collars 2.5 kg',
    );
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
