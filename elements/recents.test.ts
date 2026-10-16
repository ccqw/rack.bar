import { describe, it, expect, vi } from 'vitest';
import './recents.ts';
import { lbToKg } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';

type Recents = HTMLElement & {
  targets: readonly number[];
  unit: Unit;
  target: number | null;
};

function mountRecents(): { el: Recents; root: ShadowRoot } {
  const el = document.createElement('rack-recents') as Recents;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

function chips(root: ShadowRoot): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('[data-target]')];
}

describe('<rack-recents>', () => {
  it('renders one chip per Target, in order, as the bare kg number (RBAR-37)', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100, 80];
    const labels = chips(root).map((c) => c.textContent!.trim());
    expect(labels).toEqual(['120', '100', '80']);
  });

  it('keeps the Unit in the accessible name (the face is bare, the label is not)', () => {
    const { el, root } = mountRecents();
    el.targets = [120];
    expect(chips(root)[0].getAttribute('aria-label')).toBe('Set Target to 120 kg');
  });

  it('carries each chip its Target as data for re-apply', () => {
    const { el, root } = mountRecents();
    el.targets = [142.5, 100];
    expect(chips(root).map((c) => Number(c.dataset.target))).toEqual([142.5, 100]);
  });

  it('tapping a chip emits recentapply with that Target', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100, 80];
    const seen = vi.fn();
    el.addEventListener('recentapply', (e) =>
      seen((e as CustomEvent<{ target: number }>).detail.target),
    );
    chips(root)[1].click(); // the 100 kg chip
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenLastCalledWith(100);
  });

  it('renders the chip faces in the active Unit, keeping data-target canonical kg (RBAR-17)', () => {
    const { el, root } = mountRecents();
    el.targets = [lbToKg(135), lbToKg(225)];
    el.unit = 'lb';
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual(['135', '225']);
    // the store stays kg, so re-apply is Unit-agnostic
    expect(chips(root).map((c) => Number(c.dataset.target))).toEqual([
      lbToKg(135),
      lbToKg(225),
    ]);
  });

  it('renders nothing and stays hidden when the history is empty', () => {
    const { el, root } = mountRecents();
    el.targets = [];
    expect(chips(root)).toHaveLength(0);
    expect(el.hidden).toBe(true);
  });

  it('shows itself once it has Targets, and hides again when cleared', () => {
    const { el } = mountRecents();
    el.targets = [100];
    expect(el.hidden).toBe(false);
    el.targets = [];
    expect(el.hidden).toBe(true);
  });

  it('re-renders on each assignment (live list updates)', () => {
    const { el, root } = mountRecents();
    el.targets = [100];
    el.targets = [120, 100];
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual(['120', '100']);
  });

  it('strips float fuzz from a fractional chip face', () => {
    const { el, root } = mountRecents();
    el.targets = [60.5];
    expect(chips(root)[0].textContent!.trim()).toBe('60.5');
  });
});

describe('<rack-recents> (active chip, RBAR-37)', () => {
  const selected = (root: ShadowRoot) =>
    chips(root).map((c) => c.classList.contains('selected'));

  it('marks the chip naming the current Target as selected', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100, 80];
    el.target = 100;
    expect(selected(root)).toEqual([false, true, false]);
    expect(chips(root)[1].getAttribute('aria-current')).toBe('true');
    expect(chips(root)[0].hasAttribute('aria-current')).toBe(false);
  });

  it('matches near-equal Targets within the prototype epsilon, not beyond it', () => {
    const { el, root } = mountRecents();
    el.targets = [100];
    el.target = 100.04; // unit round-trip fuzz: still the same Target
    expect(selected(root)).toEqual([true]);
    el.target = 100.1; // a genuinely different Target
    expect(selected(root)).toEqual([false]);
  });

  it('selects no chip when there is no current Target', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100];
    el.target = null;
    expect(selected(root)).toEqual([false, false]);
  });

  it('applying another chip moves the highlight', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100, 80];
    el.target = 100;
    chips(root)[0].click(); // apply 120: it is the current Target now
    expect(selected(root)).toEqual([true, false, false]);
  });
});

describe('<rack-recents> (overflow nudge arrows, RBAR-37)', () => {
  // happy-dom reports 0 for every layout metric, so the show/hide math never runs on
  // its own. Stub the rail geometry and drive the scroll listener, mirroring the
  // loaded-chips rail tests -- the two rails share one helper (elements/nudge.ts).
  const geom = (rail: HTMLElement, scrollLeft: number) => {
    Object.defineProperty(rail, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(rail, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(rail, 'scrollLeft', { value: scrollLeft, configurable: true });
    rail.dispatchEvent(new Event('scroll'));
  };

  it('hides both arrows while the rail does not overflow', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100];
    expect(root.querySelector('[data-nudge="left"]')!.classList.contains('show')).toBe(false);
    expect(root.querySelector('[data-nudge="right"]')!.classList.contains('show')).toBe(false);
  });

  it('shows only the reachable arrow for the current scroll position', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100, 80, 60, 40];
    const rail = root.querySelector<HTMLElement>('[data-rail]')!;
    const shown = (side: string) =>
      root.querySelector(`[data-nudge="${side}"]`)!.classList.contains('show');

    geom(rail, 0); // at the start: only the right arrow
    expect(shown('left')).toBe(false);
    expect(shown('right')).toBe(true);

    geom(rail, 100); // mid-scroll: both arrows
    expect(shown('left')).toBe(true);
    expect(shown('right')).toBe(true);

    geom(rail, 200); // at the end (scrollWidth - clientWidth): only the left arrow
    expect(shown('left')).toBe(true);
    expect(shown('right')).toBe(false);
  });

  it('a nudge tap smooth-scrolls the rail by max(120, 0.6 * rail width)', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100, 80, 60, 40];
    const rail = root.querySelector<HTMLElement>('[data-rail]')!;
    rail.scrollBy = vi.fn();
    Object.defineProperty(rail, 'clientWidth', { value: 100, configurable: true });

    root.querySelector<HTMLButtonElement>('[data-nudge="right"]')!.click();
    expect(rail.scrollBy).toHaveBeenCalledWith({ left: 120, behavior: 'smooth' });

    Object.defineProperty(rail, 'clientWidth', { value: 400, configurable: true });
    root.querySelector<HTMLButtonElement>('[data-nudge="left"]')!.click();
    expect(rail.scrollBy).toHaveBeenLastCalledWith({ left: -240, behavior: 'smooth' });
  });
});
