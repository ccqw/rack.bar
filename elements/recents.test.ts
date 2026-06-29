import { describe, it, expect, vi } from 'vitest';
import './recents.ts';
import { lbToKg } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';

type Recents = HTMLElement & { targets: readonly number[]; unit: Unit };

function mountRecents(): { el: Recents; root: ShadowRoot } {
  const el = document.createElement('rack-recents') as Recents;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

function chips(root: ShadowRoot): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('[data-target]')];
}

describe('<rack-recents>', () => {
  it('renders one chip per Target, in order, labelled in kg', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100, 80];
    const labels = chips(root).map((c) => c.textContent!.trim());
    expect(labels).toEqual(['120 kg', '100 kg', '80 kg']);
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

  it('renders the chip labels in the active Unit, keeping data-target canonical kg (RBAR-17)', () => {
    const { el, root } = mountRecents();
    el.targets = [lbToKg(135), lbToKg(225)];
    el.unit = 'lb';
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual(['135 lb', '225 lb']);
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
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual([
      '120 kg',
      '100 kg',
    ]);
  });

  it('strips float fuzz from a fractional chip label', () => {
    const { el, root } = mountRecents();
    el.targets = [60.5];
    expect(chips(root)[0].textContent!.trim()).toBe('60.5 kg');
  });
});
