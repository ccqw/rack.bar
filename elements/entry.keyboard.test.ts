import { describe, it, expect, vi, beforeEach } from 'vitest';
import './entry.ts';
import './console.ts';
import { lbToKg } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';

// Physical keyboard input for the Target keypad (RBAR-49). While the sheet is open,
// physical keys drive the SAME press()/closeKeypad() path as taps, so these cases mirror
// the tap-path oracle set in entry.test.ts with real KeyboardEvents in place of clicks.

type Entry = HTMLElement & { unit: Unit };

// Each case starts from an empty body: removing the previous case's elements runs their
// disconnectedCallback, so no stale document keydown listener leaks between cases.
beforeEach(() => {
  document.body.innerHTML = '';
});

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

function closeSpy(el: HTMLElement): ReturnType<typeof vi.fn> {
  const seen = vi.fn();
  el.addEventListener('keypadclose', (e) =>
    seen((e as CustomEvent<{ target: number | null }>).detail.target),
  );
  return seen;
}

function sheet(root: ShadowRoot): HTMLElement {
  return root.querySelector<HTMLElement>('[data-sheet]')!;
}

function openSheet(root: ShadowRoot): void {
  root.querySelector<HTMLButtonElement>('[data-value]')!.click();
}

function shown(root: ShadowRoot): string {
  return root.querySelector('[data-value-num]')!.textContent ?? '';
}

// Dispatch a real keydown the way a browser does: cancelable, bubbling, composed (so a
// key on a focused shadow button reaches document). Returns the event so a case can
// check whether the handler claimed it (defaultPrevented) or let it pass through.
function keydown(
  k: string,
  init: KeyboardEventInit = {},
  on: EventTarget = document.body,
): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  on.dispatchEvent(e);
  return e;
}

function typeKeys(keys: string[]): void {
  keys.forEach((k) => keydown(k));
}

describe('<rack-entry> physical keyboard (RBAR-49)', () => {
  it('1 4 2 . 5 Enter produces Target 142.5 and commits it on close', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    const closed = closeSpy(el);
    openSheet(root);
    typeKeys(['1', '4', '2', '.', '5', 'Enter']);
    expect(seen).toHaveBeenCalledTimes(5); // one emit per keystroke, like taps
    expect(seen).toHaveBeenLastCalledWith(142.5);
    expect(sheet(root).hidden).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenLastCalledWith(142.5);
  });

  it('claims each mapped key (preventDefault) so the browser does not also act on it', () => {
    const { root } = mountEntry();
    openSheet(root);
    expect(keydown('7').defaultPrevented).toBe(true);
    expect(keydown('.').defaultPrevented).toBe(true);
    expect(keydown('Backspace').defaultPrevented).toBe(true);
    expect(keydown('Enter').defaultPrevented).toBe(true);
  });

  it('every digit 0-9 maps to its keypad key', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    typeKeys(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    expect(shown(root)).toBe('1234567890');
    expect(seen).toHaveBeenLastCalledWith(1234567890);
  });

  it('ignores a second decimal point, exactly like the tap path', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    typeKeys(['1', '.', '5', '.']);
    expect(seen).toHaveBeenLastCalledWith(1.5);
  });

  it('the first digit replaces the seeded Bar default rather than appending', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    keydown('5');
    expect(seen).toHaveBeenLastCalledWith(5);
    expect(shown(root)).toBe('5');
  });

  it('Backspace on the pristine default discards the whole draft (mirrors del)', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    keydown('Backspace');
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('Backspace on a real value deletes one character', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    typeKeys(['1', '4', '2', '.', '5', 'Backspace']);
    expect(shown(root)).toBe('142.');
    expect(seen).toHaveBeenLastCalledWith(142);
  });

  it('reopening a typed value: the next digit replaces it (handoff 5)', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    typeKeys(['1', '0', '0', 'Enter']);
    openSheet(root);
    keydown('5');
    expect(seen).toHaveBeenLastCalledWith(5);
    expect(shown(root)).toBe('5');
  });

  it('reopening a typed value: Backspace deletes one char, not the whole field', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    typeKeys(['1', '4', '2', '.', '5', 'Enter']);
    openSheet(root);
    keydown('Backspace');
    expect(shown(root)).toBe('142.');
    expect(seen).toHaveBeenLastCalledWith(142);
  });

  it('Escape is Done too: it closes and commits the Target', () => {
    const { root, el } = mountEntry();
    const closed = closeSpy(el);
    openSheet(root);
    typeKeys(['1', '0', '0']);
    const e = keydown('Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(sheet(root).hidden).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenLastCalledWith(100);
  });

  it('Enter on an idle peek of the untouched default commits null (pristine)', () => {
    const { root, el } = mountEntry();
    const closed = closeSpy(el);
    openSheet(root);
    keydown('Enter');
    expect(closed).toHaveBeenLastCalledWith(null);
  });

  it('Escape after reopening a typed value without typing still commits it', () => {
    const { root, el } = mountEntry();
    const closed = closeSpy(el);
    openSheet(root);
    typeKeys(['1', '0', '0', 'Enter']);
    openSheet(root);
    keydown('Escape');
    expect(closed).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenLastCalledWith(100);
  });

  it('types in the display Unit: 3 1 5 Enter in lb commits the canonical kg', () => {
    const { el, root } = mountEntry();
    const closed = closeSpy(el);
    el.unit = 'lb';
    openSheet(root);
    typeKeys(['3', '1', '5', 'Enter']);
    expect(closed).toHaveBeenLastCalledWith(lbToKg(315));
  });

  it('a digit typed with the sheet CLOSED does nothing (no ghost entry)', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    const closed = closeSpy(el);
    const e = keydown('5');
    expect(e.defaultPrevented).toBe(false);
    expect(keydown('Enter').defaultPrevented).toBe(false);
    expect(keydown('Escape').defaultPrevented).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(sheet(root).hidden).toBe(true);
  });

  it('stops listening once the sheet closes (no entry after Done)', () => {
    const { el, root } = mountEntry();
    openSheet(root);
    typeKeys(['1', '0', '0', 'Enter']);
    const seen = targetSpy(el);
    const e = keydown('5');
    expect(e.defaultPrevented).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    expect(shown(root)).toBe('100');
  });

  it('stops listening once the element is removed while the sheet is open', () => {
    const { el, root } = mountEntry();
    openSheet(root);
    const seen = targetSpy(el);
    el.remove();
    expect(keydown('5').defaultPrevented).toBe(false);
    expect(seen).not.toHaveBeenCalled();
  });

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
  ] as const)('%s-held keys pass through untouched (browser shortcuts win)', (_, mod) => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    const closed = closeSpy(el);
    openSheet(root);
    for (const k of ['r', '1', '.', 'Backspace', 'Enter', 'Escape']) {
      expect(keydown(k, mod).defaultPrevented).toBe(false);
    }
    expect(seen).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(sheet(root).hidden).toBe(false);
  });

  it('ignores unmapped keys (letters, Space, arrows) and lets them pass through', () => {
    // ArrowUp/ArrowDown are deliberately NOT stepper nudges in this slice (RBAR-49
    // scope call): the on-screen +/- steppers stay the only nudge affordance.
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    for (const k of ['a', ' ', 'ArrowUp', 'ArrowDown', 'Tab', ',']) {
      expect(keydown(k).defaultPrevented).toBe(false);
    }
    expect(seen).not.toHaveBeenCalled();
    expect(sheet(root).hidden).toBe(false);
  });

  it('a held-key autorepeat still routes through press (Backspace repeat deletes)', () => {
    const { root } = mountEntry();
    openSheet(root);
    typeKeys(['1', '2', '3']);
    keydown('Backspace', { repeat: true });
    keydown('Backspace', { repeat: true });
    expect(shown(root)).toBe('1');
  });

  // A browser activates a focused <button> on Enter/Space as the key's DEFAULT action
  // (a synthetic click); happy-dom does not, so the cases below model it: the native
  // click runs only when the handler left the keydown un-prevented.
  function keyOnFocused(btn: HTMLButtonElement, k: string): KeyboardEvent {
    btn.focus();
    const e = keydown(k, {}, btn);
    if ((k === 'Enter' || k === ' ') && !e.defaultPrevented) btn.click();
    return e;
  }

  it('Enter with an on-screen key focused is Done, not a second press of that key', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    const closed = closeSpy(el);
    openSheet(root);
    const five = root.querySelector<HTMLButtonElement>('[data-key="5"]')!;
    five.click(); // mouse tap leaves the key focused (as Chrome does)
    keyOnFocused(five, 'Enter');
    expect(seen).toHaveBeenCalledTimes(1); // the tap only -- no native re-press
    expect(sheet(root).hidden).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenLastCalledWith(5);
  });

  it('Enter with the value button focused closes once (no close-then-reopen toggle)', () => {
    const { el, root } = mountEntry();
    const closed = closeSpy(el);
    const value = root.querySelector<HTMLButtonElement>('[data-value]')!;
    value.click(); // open; the value button keeps focus
    keydown('7', {}, value);
    keyOnFocused(value, 'Enter');
    expect(sheet(root).hidden).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenLastCalledWith(7);
  });

  it('Space on a focused key is left to the button: exactly one press', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    const five = root.querySelector<HTMLButtonElement>('[data-key="5"]')!;
    keyOnFocused(five, ' ');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(shown(root)).toBe('5');
  });

  it('a digit typed with an on-screen key focused enters once', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    const five = root.querySelector<HTMLButtonElement>('[data-key="5"]')!;
    keyOnFocused(five, '3');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(shown(root)).toBe('3');
  });

  it('Enter on a focused control OUTSIDE the entry is left to that control', () => {
    const { el, root } = mountEntry();
    const closed = closeSpy(el);
    const other = document.createElement('button');
    const otherClick = vi.fn();
    other.addEventListener('click', otherClick);
    document.body.append(other);
    openSheet(root);
    keyOnFocused(other, 'Enter');
    expect(otherClick).toHaveBeenCalledTimes(1);
    expect(sheet(root).hidden).toBe(false);
    expect(closed).not.toHaveBeenCalled();
  });

  it('keys typed into a text field elsewhere are left to that field', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    const field = document.createElement('input');
    document.body.append(field);
    openSheet(root);
    field.focus();
    for (const k of ['5', 'Backspace', 'Enter']) {
      expect(keydown(k, {}, field).defaultPrevented).toBe(false);
    }
    expect(seen).not.toHaveBeenCalled();
    expect(sheet(root).hidden).toBe(false);
  });
});

describe('<rack-console> physical keyboard commits to Recents (RBAR-49)', () => {
  it('typing 1 4 2 . 5 Enter lands 142.5 in Recents, exactly like the tap path', () => {
    const el = document.createElement('rack-console');
    document.body.append(el);
    const entryRoot = el.shadowRoot!.querySelector('rack-entry')!.shadowRoot!;
    entryRoot.querySelector<HTMLButtonElement>('[data-value]')!.click(); // open
    typeKeys(['1', '4', '2', '.', '5', 'Enter']);
    const recents = el.shadowRoot!.querySelector('rack-recents')!;
    const chips = [...recents.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-target]')];
    expect(chips.map((c) => Number(c.dataset.target))).toEqual([142.5]);
  });
});
