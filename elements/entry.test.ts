import { describe, it, expect, vi } from 'vitest';
import './entry.ts';
import { DEFAULT_BAR_KG } from '../lib/plates.ts';

type Entry = HTMLElement & {
  display(value: number | null): void;
  barKg: number;
};

function mountEntry(): { el: Entry; root: ShadowRoot } {
  const el = document.createElement('rack-entry') as Entry;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

function targetSpy(el: HTMLElement): ReturnType<typeof vi.fn> {
  const seen = vi.fn();
  el.addEventListener('target', (e) =>
    seen((e as CustomEvent<{ target: number | null }>).detail.target),
  );
  return seen;
}

function tap(root: ShadowRoot, selector: string): void {
  root.querySelector<HTMLButtonElement>(selector)!.click();
}

function key(root: ShadowRoot, k: string): void {
  tap(root, `[data-key="${CSS.escape(k)}"]`);
}

describe('<rack-entry>', () => {
  it('keypad digits build the Target and emit on each tap (no submit step)', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    key(root, '1');
    key(root, '0');
    key(root, '0');
    expect(seen).toHaveBeenCalledTimes(3);
    expect(seen).toHaveBeenLastCalledWith(100);
  });

  it('keypad enters an exact fractional Target (e.g. 142.5)', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    ['1', '4', '2', '.', '5'].forEach((k) => key(root, k));
    expect(seen).toHaveBeenLastCalledWith(142.5);
  });

  it('ignores a second decimal point so the draft stays a valid number', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    ['1', '.', '5', '.'].forEach((k) => key(root, k));
    expect(seen).toHaveBeenLastCalledWith(1.5);
  });

  it('plus/minus steppers nudge the Target by a whole kg and emit', () => {
    // The achievable Total grid is integers (smallest Plate 0.5 x 2 Sides = 1 kg),
    // so the sensible step is 1 kg.
    const { el, root } = mountEntry();
    el.display(100); // silent seed
    const seen = targetSpy(el);
    tap(root, '[data-step="inc"]');
    expect(seen).toHaveBeenLastCalledWith(101);
    tap(root, '[data-step="dec"]');
    expect(seen).toHaveBeenLastCalledWith(100);
  });

  it('defaults the Target to the Bar weight and steps relative to it, not zero', () => {
    // You load a bar UP from its own weight, so the starter value is the Bar weight,
    // not 0 -- otherwise you would hold + just to reach the empty Bar.
    const { el, root } = mountEntry();
    const value = root.querySelector<HTMLElement>('[data-value]')!;
    expect(value.textContent).toBe(String(DEFAULT_BAR_KG));
    expect(value.classList.contains('empty')).toBe(false); // a real value, not a placeholder
    const seen = targetSpy(el);
    tap(root, '[data-step="inc"]');
    expect(seen).toHaveBeenLastCalledWith(DEFAULT_BAR_KG + 1);
    tap(root, '[data-step="dec"]');
    tap(root, '[data-step="dec"]');
    expect(seen).toHaveBeenLastCalledWith(DEFAULT_BAR_KG - 1); // steps below the Bar too
  });

  it('a typed digit replaces the seeded default rather than appending to it', () => {
    // The default Bar weight is pristine: tapping 5 yields 5, not 205.
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    key(root, '5');
    expect(seen).toHaveBeenLastCalledWith(5);
  });

  it('del on the untouched default clears to no Target (the default is a placeholder)', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    key(root, 'del');
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('drops a lone leading zero so the shown value matches the Target (0 then 5 -> 5)', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    key(root, '0');
    key(root, '5');
    expect(seen).toHaveBeenLastCalledWith(5);
    expect(root.querySelector('[data-value]')!.textContent).toBe('5');
  });

  it('steps cleanly from a fractional value without float fuzz', () => {
    const { el, root } = mountEntry();
    el.display(142.5);
    const seen = targetSpy(el);
    tap(root, '[data-step="inc"]');
    expect(seen).toHaveBeenLastCalledWith(143.5);
  });

  it('steps correctly from a mid-entry trailing-decimal draft (142. -> 143)', () => {
    const { el, root } = mountEntry();
    ['1', '4', '2', '.'].forEach((k) => key(root, k)); // draft "142." emits 142
    const seen = targetSpy(el);
    tap(root, '[data-step="inc"]');
    expect(seen).toHaveBeenLastCalledWith(143);
  });

  it('reflects the keypad open state via aria-expanded', () => {
    const { root } = mountEntry();
    const value = root.querySelector<HTMLElement>('[data-value]')!;
    expect(value.getAttribute('aria-expanded')).toBe('false');
    tap(root, '[data-value]');
    expect(value.getAttribute('aria-expanded')).toBe('true');
  });

  it('never steps the Target below zero', () => {
    const { el, root } = mountEntry();
    el.display(0);
    const seen = targetSpy(el);
    tap(root, '[data-step="dec"]');
    expect(seen).toHaveBeenLastCalledWith(0);
  });

  it('reports an empty field as a null Target, never NaN', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    key(root, '5');
    key(root, 'del'); // back to empty
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('clear empties the field and emits null', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    ['1', '0'].forEach((k) => key(root, k));
    tap(root, '[data-key="clear"]');
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('tapping the value opens the keypad', () => {
    const { root } = mountEntry();
    const keypad = root.querySelector<HTMLElement>('[data-keypad]')!;
    expect(keypad.hidden).toBe(true);
    tap(root, '[data-value]');
    expect(keypad.hidden).toBe(false);
  });

  it('anchors the empty-field default and the steppers at the chosen Bar, not just 20', () => {
    // RBAR-15: the Bar is now a lifter choice. The entry seeds its pristine default
    // to the Bar weight and steps from it (you load a bar UP from its own weight), so
    // a 15 kg Bar must show 15 as the anchor and step from 15 -- not the 20 kg default.
    const { el, root } = mountEntry();
    el.barKg = 15;
    const value = root.querySelector<HTMLElement>('[data-value]')!;
    expect(value.textContent).toBe('15');
    expect(value.classList.contains('empty')).toBe(false); // a real seeded value
    const seen = targetSpy(el);
    tap(root, '[data-step="inc"]');
    expect(seen).toHaveBeenLastCalledWith(16);
  });

  it('falls an emptied field back to the chosen Bar anchor (muted), not 20', () => {
    const { el, root } = mountEntry();
    el.barKg = 5;
    const seen = targetSpy(el);
    key(root, 'del'); // clear the pristine seed -> empty field
    expect(seen).toHaveBeenLastCalledWith(null);
    const value = root.querySelector<HTMLElement>('[data-value]')!;
    expect(value.textContent).toBe('5'); // the muted anchor follows the Bar
    expect(value.classList.contains('empty')).toBe(true);
    tap(root, '[data-step="inc"]'); // steps up from the 5 kg Bar
    expect(seen).toHaveBeenLastCalledWith(6);
  });

  it('does not stomp a real typed value when the Bar changes', () => {
    // A live Bar change must only move the anchor, never overwrite a Target the
    // lifter has already typed.
    const { el, root } = mountEntry();
    ['1', '0', '0'].forEach((k) => key(root, k)); // typed 100
    el.barKg = 15;
    const value = root.querySelector<HTMLElement>('[data-value]')!;
    expect(value.textContent).toBe('100');
  });

  it('display() seeds or clears the shown value WITHOUT emitting a target event', () => {
    // The load-bearing half of the contract (ADR-0005): the console calls display()
    // when switching back to Decode to seed the box with the carried Total, so the
    // steppers move from it. A stray target event would re-decode and stomp the
    // hand-built Side Load. Both seed and clear must stay silent.
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    el.display(50);
    expect(root.querySelector('[data-value]')!.textContent).toContain('50');
    el.display(null);
    expect(seen).not.toHaveBeenCalled();
  });
});
