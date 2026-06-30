import { describe, it, expect, vi } from 'vitest';
import './loaded.ts';
import { ELEIKO_KG, IRON_LB } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

type Loaded = HTMLElement & { side: readonly Plate[] };

function mountLoaded(): { el: Loaded; root: ShadowRoot } {
  const el = document.createElement('rack-loaded') as Loaded;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

function chips(root: ShadowRoot): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('.chip')];
}

// Pick a denomination out of a set's Inventory by its weight / lb stamp.
const kg = (n: number): Plate => ELEIKO_KG.find((p) => p.kg === n)!;
const lb = (label: string): Plate => IRON_LB.find((p) => p.label === label)!;

describe('<rack-loaded> ("On the bar" loaded chips + Clear, RBAR-27)', () => {
  it('renders one chip per Plate group, heaviest-first, grouped Nx face', () => {
    const { el, root } = mountLoaded();
    el.side = [kg(25), kg(25), kg(20)];
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual(['25x2', '20']);
  });

  it('shows a single Plate with no count suffix', () => {
    const { el, root } = mountLoaded();
    el.side = [kg(20)];
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual(['20']);
  });

  it('carries each chip its Plate kg + colour, and tints the chip per plate', () => {
    const { el, root } = mountLoaded();
    el.side = [kg(25), kg(20)];
    expect(chips(root).map((c) => Number(c.dataset.kg))).toEqual([25, 20]);
    expect(chips(root).map((c) => c.dataset.color)).toEqual(['red', 'blue']);
  });

  it('tapping a chip emits removeplate with that group representative Plate', () => {
    const { el, root } = mountLoaded();
    el.side = [kg(25), kg(25), kg(20)];
    const seen = vi.fn();
    el.addEventListener('removeplate', (e) =>
      seen((e as CustomEvent<{ plate: Plate }>).detail.plate),
    );
    chips(root)[0].click(); // the 25x2 chip
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0]).toMatchObject({ kg: 25, color: 'red' });
  });

  it('the Clear pill emits clearbar', () => {
    const { el, root } = mountLoaded();
    el.side = [kg(20)];
    const seen = vi.fn();
    el.addEventListener('clearbar', seen);
    root.querySelector<HTMLButtonElement>('[data-clear]')!.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('empty -> "Tap to add a pair", with the On the bar label + Clear hidden', () => {
    const { el, root } = mountLoaded();
    el.side = [];
    expect(chips(root)).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-empty]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-empty]')!.textContent!.trim()).toBe(
      'Tap to add a pair',
    );
    expect(root.querySelector<HTMLElement>('[data-head]')!.hidden).toBe(true);
    // The chip rail viewport is hidden too -- no empty strip above the hint.
    expect(root.querySelector<HTMLElement>('[data-viewport]')!.hidden).toBe(true);
  });

  it('loaded -> the On the bar label + Clear show, the empty hint hides', () => {
    const { el, root } = mountLoaded();
    el.side = [kg(20)];
    expect(root.querySelector<HTMLElement>('[data-head]')!.hidden).toBe(false);
    expect(root.querySelector('[data-head] .label')!.textContent!.trim()).toBe(
      'On the bar',
    );
    expect(root.querySelector<HTMLElement>('[data-empty]')!.hidden).toBe(true);
  });

  it('renders iron chips with their lb labels (unit-correct per set, ADR-0010)', () => {
    const { el, root } = mountLoaded();
    el.side = [lb('45'), lb('25')];
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual(['45', '25']);
    expect(chips(root).map((c) => c.dataset.color)).toEqual(['iron', 'iron']);
  });

  it('re-renders on each assignment (live updates as Plates come and go)', () => {
    const { el, root } = mountLoaded();
    el.side = [kg(25)];
    el.side = [kg(25), kg(25), kg(20)];
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual(['25x2', '20']);
    el.side = [];
    expect(chips(root)).toHaveLength(0);
  });

  it('shows only the reachable nudge arrow for the current scroll position', () => {
    // happy-dom reports 0 for every layout metric, so the show/hide math never runs on
    // its own. Stub the rail geometry and drive the scroll listener to exercise the one
    // branch of real logic this element owns: left arrow once scrolled off the start,
    // right arrow while more chips sit past the end.
    const { el, root } = mountLoaded();
    el.side = [kg(25), kg(20), kg(15)];
    const rail = root.querySelector<HTMLElement>('[data-rail]')!;
    const geom = (scrollLeft: number) => {
      Object.defineProperty(rail, 'clientWidth', { value: 100, configurable: true });
      Object.defineProperty(rail, 'scrollWidth', { value: 300, configurable: true });
      Object.defineProperty(rail, 'scrollLeft', { value: scrollLeft, configurable: true });
      rail.dispatchEvent(new Event('scroll'));
    };
    const shown = (side: string) =>
      root.querySelector(`[data-nudge="${side}"]`)!.classList.contains('show');

    geom(0); // at the start: only the right arrow
    expect(shown('left')).toBe(false);
    expect(shown('right')).toBe(true);

    geom(100); // mid-scroll: both arrows
    expect(shown('left')).toBe(true);
    expect(shown('right')).toBe(true);

    geom(200); // at the end (scrollWidth - clientWidth): only the left arrow
    expect(shown('left')).toBe(true);
    expect(shown('right')).toBe(false);
  });

  it('a nudge control scrolls the chip rail (the overflow affordance)', () => {
    const { el, root } = mountLoaded();
    el.side = [kg(25), kg(20), kg(15), kg(10), kg(5)];
    const rail = root.querySelector<HTMLElement>('[data-rail]')!;
    rail.scrollBy = vi.fn();
    root.querySelector<HTMLButtonElement>('[data-nudge="right"]')!.click();
    expect(rail.scrollBy).toHaveBeenCalledTimes(1);
    expect((rail.scrollBy as ReturnType<typeof vi.fn>).mock.calls[0][0].left).toBeGreaterThan(0);
    root.querySelector<HTMLButtonElement>('[data-nudge="left"]')!.click();
    expect((rail.scrollBy as ReturnType<typeof vi.fn>).mock.calls[1][0].left).toBeLessThan(0);
  });
});
