import { describe, it, expect, vi, beforeEach } from 'vitest';
import './entry.ts';
import './console.ts';
import { lbToKg } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';

// Physical keyboard input for the Target keypad (RBAR-49). While the sheet is open,
// physical keys drive the SAME press()/step()/closeKeypad() paths as taps, so these
// cases mirror the tap-path oracle set in entry.test.ts with real KeyboardEvents in
// place of clicks.

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
    for (const k of ['r', '1', '.', ',', 'Backspace', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown']) {
      expect(keydown(k, mod).defaultPrevented).toBe(false);
    }
    expect(seen).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(sheet(root).hidden).toBe(false);
  });

  it('ignores unmapped keys (letters, Space, Tab, side arrows) and lets them pass through', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    for (const k of ['a', ' ', 'ArrowLeft', 'ArrowRight', 'Tab', 'PageUp']) {
      expect(keydown(k).defaultPrevented).toBe(false);
    }
    expect(seen).not.toHaveBeenCalled();
    expect(sheet(root).hidden).toBe(false);
  });

  it('drops a lone leading zero, like the tap path (0 then 5 -> 5)', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    typeKeys(['0', '5']);
    expect(shown(root)).toBe('5');
    expect(seen).toHaveBeenLastCalledWith(5);
  });

  it('a decimal typed first starts a fresh 0. draft', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    openSheet(root);
    typeKeys(['.', '5']);
    expect(shown(root)).toBe('0.5');
    expect(seen).toHaveBeenLastCalledWith(0.5);
  });

  it('after a Unit switch the first digit replaces the converted draft (RBAR-38)', () => {
    const { el, root } = mountEntry();
    openSheet(root);
    typeKeys(['1', '0', '0']);
    el.unit = 'lb'; // reformats to 220
    const seen = targetSpy(el);
    keydown('3');
    expect(shown(root)).toBe('3');
    expect(seen).toHaveBeenLastCalledWith(lbToKg(3));
  });

  it('after a Unit switch Backspace discards the converted draft whole (RBAR-38)', () => {
    const { el, root } = mountEntry();
    openSheet(root);
    typeKeys(['1', '0', '0']);
    el.unit = 'lb';
    const seen = targetSpy(el);
    keydown('Backspace');
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('Enter after a Unit switch commits the canonical Target, drift-free (RBAR-38)', () => {
    const { el, root } = mountEntry();
    const closed = closeSpy(el);
    openSheet(root);
    typeKeys(['1', '0', '0']);
    el.unit = 'lb'; // shows 220
    keydown('Enter');
    expect(closed).toHaveBeenLastCalledWith(100);
  });

  it('Enter on a display()-seeded value commits null (an idle peek)', () => {
    const { el, root } = mountEntry();
    (el as Entry & { display(v: number | null): void }).display(120);
    const closed = closeSpy(el);
    openSheet(root);
    keydown('Enter');
    expect(closed).toHaveBeenLastCalledWith(null);
  });

  it('Enter on an emptied field commits null', () => {
    const { el, root } = mountEntry();
    const closed = closeSpy(el);
    openSheet(root);
    typeKeys(['5', 'Backspace', 'Enter']);
    expect(closed).toHaveBeenLastCalledWith(null);
  });

  describe('ArrowUp / ArrowDown nudge like the +/- steppers (grid snap, RBAR-38)', () => {
    type Seeded = Entry & { display(v: number | null): void; barKg: number };

    function seeded(value: number | null, unit: Unit = 'kg', barKg?: number) {
      const { el, root } = mountEntry();
      const e = el as Seeded;
      if (barKg !== undefined) e.barKg = barKg;
      e.unit = unit;
      if (value !== null) e.display(value);
      openSheet(root);
      return { el: e, root, seen: targetSpy(el) };
    }

    it('claims the arrows so the page does not scroll', () => {
      seeded(100);
      expect(keydown('ArrowUp').defaultPrevented).toBe(true);
      expect(keydown('ArrowDown').defaultPrevented).toBe(true);
    });

    it('kg: on-grid 142 steps a whole kg up / down', () => {
      const { seen } = seeded(142);
      keydown('ArrowUp');
      expect(seen).toHaveBeenLastCalledWith(143);
      keydown('ArrowDown');
      keydown('ArrowDown');
      expect(seen).toHaveBeenLastCalledWith(141);
    });

    it('kg: off-grid 142.5 snaps up to 143 and down to 142', () => {
      const up = seeded(142.5);
      keydown('ArrowUp');
      expect(up.seen).toHaveBeenLastCalledWith(143);
      document.body.innerHTML = '';
      const down = seeded(142.5);
      keydown('ArrowDown');
      expect(down.seen).toHaveBeenLastCalledWith(142);
    });

    it('lb: off-grid 137 snaps up to 140 and down to 135', () => {
      const up = seeded(lbToKg(137), 'lb');
      keydown('ArrowUp');
      expect(up.seen).toHaveBeenLastCalledWith(lbToKg(140));
      document.body.innerHTML = '';
      const down = seeded(lbToKg(137), 'lb');
      keydown('ArrowDown');
      expect(down.seen).toHaveBeenLastCalledWith(lbToKg(135));
    });

    it('Comp (20 kg Bar): steps from the Bar anchor in kg and snaps 44 lb in lb', () => {
      const kg = seeded(null);
      keydown('ArrowUp');
      expect(kg.seen).toHaveBeenLastCalledWith(21);
      document.body.innerHTML = '';
      const lb = seeded(null, 'lb'); // the 20 kg anchor reads 44 lb, off the 5 lb grid
      keydown('ArrowUp');
      expect(lb.seen).toHaveBeenLastCalledWith(lbToKg(45));
      keydown('ArrowDown');
      expect(lb.seen).toHaveBeenLastCalledWith(lbToKg(40));
    });

    it('Training (45 lb Bar): steps the on-grid 45 lb anchor to 50 / 40', () => {
      const lb = seeded(null, 'lb', lbToKg(45));
      keydown('ArrowUp');
      expect(lb.seen).toHaveBeenLastCalledWith(lbToKg(50));
      keydown('ArrowDown');
      keydown('ArrowDown');
      expect(lb.seen).toHaveBeenLastCalledWith(lbToKg(40));
    });

    it('Training (45 lb Bar) in kg: the 20.41 kg anchor snaps up to 21 and down to 20', () => {
      const up = seeded(null, 'kg', lbToKg(45));
      keydown('ArrowUp');
      expect(up.seen).toHaveBeenLastCalledWith(21);
      document.body.innerHTML = '';
      const down = seeded(null, 'kg', lbToKg(45));
      keydown('ArrowDown');
      expect(down.seen).toHaveBeenLastCalledWith(20);
    });

    it.each([
      ['kg', 100, 100],
      ['lb', lbToKg(225), lbToKg(225)],
    ] as const)('%s: up then down returns to the same grid value', (unit, seed, back) => {
      const { seen } = seeded(seed, unit);
      keydown('ArrowUp');
      keydown('ArrowDown');
      expect(seen).toHaveBeenCalledTimes(2);
      expect(seen).toHaveBeenLastCalledWith(back);
    });

    it.each(['kg', 'lb'] as const)('%s: never steps below zero', (unit) => {
      const { seen } = seeded(0, unit);
      keydown('ArrowDown');
      expect(seen).toHaveBeenLastCalledWith(0);
    });

    it('steps a mid-entry trailing-decimal draft like the stepper (142. -> 143)', () => {
      const { seen } = seeded(null);
      typeKeys(['1', '4', '2', '.', 'ArrowUp']);
      expect(seen).toHaveBeenLastCalledWith(143);
    });

    it('a digit after a nudge appends to the stepped value, as after a tap', () => {
      const { root } = seeded(100);
      typeKeys(['ArrowUp', '5']);
      expect(shown(root)).toBe('1015');
    });

    it('a nudge makes the seed a real value: Enter then commits it, not null', () => {
      const { el } = seeded(null);
      const closed = closeSpy(el);
      typeKeys(['ArrowUp', 'Enter']);
      expect(closed).toHaveBeenLastCalledWith(21);
    });

    it('Shift+Arrow passes through (no big-step variant)', () => {
      const { seen } = seeded(100);
      expect(keydown('ArrowUp', { shiftKey: true }).defaultPrevented).toBe(false);
      expect(keydown('ArrowDown', { shiftKey: true }).defaultPrevented).toBe(false);
      expect(seen).not.toHaveBeenCalled();
    });

    it('arrows do nothing with the sheet closed', () => {
      const { el } = mountEntry();
      const seen = targetSpy(el);
      expect(keydown('ArrowUp').defaultPrevented).toBe(false);
      expect(keydown('ArrowDown').defaultPrevented).toBe(false);
      expect(seen).not.toHaveBeenCalled();
    });
  });

  describe('comma is the decimal key too (comma-locale keyboards / numpads)', () => {
    it('1 4 2 , 5 Enter commits 142.5, same as with a period', () => {
      const { el, root } = mountEntry();
      const seen = targetSpy(el);
      const closed = closeSpy(el);
      openSheet(root);
      typeKeys(['1', '4', '2']);
      expect(keydown(',').defaultPrevented).toBe(true); // claimed like '.'
      typeKeys(['5', 'Enter']);
      expect(seen).toHaveBeenLastCalledWith(142.5);
      expect(closed).toHaveBeenLastCalledWith(142.5);
    });

    it('shows the separator as a period in the draft', () => {
      const { root } = mountEntry();
      openSheet(root);
      typeKeys(['1', ',', '5']);
      expect(shown(root)).toBe('1.5');
    });

    it.each([
      [',', ','],
      [',', '.'],
      ['.', ','],
    ])('a second separator (%s then %s) is ignored exactly like a second . tap', (a, b) => {
      const { el, root } = mountEntry();
      const seen = targetSpy(el);
      openSheet(root);
      typeKeys(['1', a, '5', b]);
      expect(shown(root)).toBe('1.5');
      expect(seen).toHaveBeenCalledTimes(4); // the ignored separator still emits, as a tap does
      expect(seen).toHaveBeenLastCalledWith(1.5);
    });

    it('a comma typed first starts a fresh 0. draft, like a first period', () => {
      const { root } = mountEntry();
      openSheet(root);
      typeKeys([',', '5']);
      expect(shown(root)).toBe('0.5');
    });
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

  it('Enter with a stepper focused is Done, not another nudge', () => {
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    const closed = closeSpy(el);
    openSheet(root);
    const inc = root.querySelector<HTMLButtonElement>('[data-step="inc"]')!;
    inc.click(); // 20 -> 21, focus stays on +
    keyOnFocused(inc, 'Enter');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenLastCalledWith(21);
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
    for (const k of ['5', ',', 'Backspace', 'ArrowUp', 'Enter']) {
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

  it.each(['data-share', 'data-fullscreen'])(
    'a modal opened over the sheet ([%s]) takes the keys: the Target behind is inert',
    (attr) => {
      const el = document.createElement('rack-console');
      document.body.append(el);
      const shadow = el.shadowRoot!;
      const entry = shadow.querySelector('rack-entry')! as HTMLElement;
      entry.shadowRoot!.querySelector<HTMLButtonElement>('[data-value]')!.click(); // open
      shadow.querySelector<HTMLButtonElement>(`[${attr}]`)!.click(); // modal over the pad
      const seen = targetSpy(entry);
      const closed = closeSpy(entry);
      for (const k of ['5', ',', 'Backspace', 'ArrowUp', 'Escape', 'Enter']) {
        expect(keydown(k).defaultPrevented).toBe(false);
      }
      expect(seen).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      expect(entry.shadowRoot!.querySelector<HTMLElement>('[data-sheet]')!.hidden).toBe(false);
    },
  );

  it('keys reach the pad again once the modal over it closes', () => {
    const el = document.createElement('rack-console');
    document.body.append(el);
    const shadow = el.shadowRoot!;
    const entry = shadow.querySelector('rack-entry')! as HTMLElement;
    entry.shadowRoot!.querySelector<HTMLButtonElement>('[data-value]')!.click(); // open
    shadow.querySelector<HTMLButtonElement>('[data-fullscreen]')!.click();
    (shadow.querySelector('rack-fullscreen') as HTMLElement & { close(): void }).close();
    const seen = targetSpy(entry);
    keydown('5');
    expect(seen).toHaveBeenLastCalledWith(5);
  });

  it('a sheet left open across a switch to By Plates takes no keys there', () => {
    // The mode toggle stays tappable above the open sheet (no scrim); By Plates hides the
    // whole entry without closing the pad, so its listener must not edit or commit.
    const el = document.createElement('rack-console');
    document.body.append(el);
    const shadow = el.shadowRoot!;
    const entry = shadow.querySelector('rack-entry')!;
    entry.shadowRoot!.querySelector<HTMLButtonElement>('[data-value]')!.click(); // open
    shadow.querySelector<HTMLButtonElement>('[data-mode="encode"]')!.click();
    const seen = targetSpy(entry as HTMLElement);
    const closed = closeSpy(entry as HTMLElement);
    for (const k of ['5', ',', 'ArrowUp', 'Enter']) {
      expect(keydown(k).defaultPrevented).toBe(false);
    }
    expect(seen).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    const recents = shadow.querySelector('rack-recents')!;
    expect(recents.shadowRoot!.querySelectorAll('[data-target]')).toHaveLength(0);
  });
});
