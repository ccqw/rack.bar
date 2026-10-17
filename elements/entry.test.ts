import { describe, it, expect, vi } from 'vitest';
import './entry.ts';
import { DEFAULT_BAR_KG } from '../lib/plates.ts';
import { lbToKg, shownIn, format } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';

type Entry = HTMLElement & {
  display(value: number | null): void;
  retarget(kg: number): void;
  barKg: number;
  unit: Unit;
  loadLine: string | null;
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
    expect(value.querySelector('[data-value-num]')!.textContent).toBe(String(DEFAULT_BAR_KG));
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
    expect(root.querySelector('[data-value-num]')!.textContent).toBe('5');
  });

  describe('stepper grid snap (RBAR-38, prototype step() L574-591)', () => {
    // Oracle cases lifted from the handoff prototype's step(): a nudge lands on the
    // next multiple of the step grid (1 kg / 5 lb) rather than carrying an off-grid
    // fraction along -- from 142.5, + gives 143 (not 143.5) and - gives 142, so an
    // off-grid Target re-aligns on the first nudge. An on-grid value moves a whole step.

    it('kg: snaps 142.5 up to 143, not 143.5 (off-grid re-aligns)', () => {
      const { el, root } = mountEntry();
      el.display(142.5);
      const seen = targetSpy(el);
      tap(root, '[data-step="inc"]');
      expect(seen).toHaveBeenLastCalledWith(143);
    });

    it('kg: snaps 142.5 down to 142', () => {
      const { el, root } = mountEntry();
      el.display(142.5);
      const seen = targetSpy(el);
      tap(root, '[data-step="dec"]');
      expect(seen).toHaveBeenLastCalledWith(142);
    });

    it('kg: snaps 145.5 up to 146 (the live stepper bug)', () => {
      const { el, root } = mountEntry();
      el.display(145.5);
      const seen = targetSpy(el);
      tap(root, '[data-step="inc"]');
      expect(seen).toHaveBeenLastCalledWith(146);
    });

    it('kg: steps an on-grid 142 a whole step to 143 / 141', () => {
      const { el, root } = mountEntry();
      el.display(142);
      const seen = targetSpy(el);
      tap(root, '[data-step="inc"]');
      expect(seen).toHaveBeenLastCalledWith(143);
      tap(root, '[data-step="dec"]');
      tap(root, '[data-step="dec"]');
      expect(seen).toHaveBeenLastCalledWith(141);
    });

    it('kg: floors a sub-grid 0.4 at 0 stepping down, snaps to 1 stepping up', () => {
      const down = mountEntry();
      down.el.display(0.4);
      const seenDown = targetSpy(down.el);
      tap(down.root, '[data-step="dec"]');
      expect(seenDown).toHaveBeenLastCalledWith(0);
      const up = mountEntry();
      up.el.display(0.4);
      const seenUp = targetSpy(up.el);
      tap(up.root, '[data-step="inc"]');
      expect(seenUp).toHaveBeenLastCalledWith(1);
    });

    it('lb: snaps 137 up to 140 and down to 135 on the 5 lb grid', () => {
      const up = mountEntry();
      up.el.unit = 'lb';
      up.el.display(lbToKg(137)); // shows 137, off the 5 lb grid
      const seenUp = targetSpy(up.el);
      tap(up.root, '[data-step="inc"]');
      expect(seenUp).toHaveBeenLastCalledWith(lbToKg(140));
      const down = mountEntry();
      down.el.unit = 'lb';
      down.el.display(lbToKg(137));
      const seenDown = targetSpy(down.el);
      tap(down.root, '[data-step="dec"]');
      expect(seenDown).toHaveBeenLastCalledWith(lbToKg(135));
    });

    it('lb: snaps the 44 lb Bar anchor up to 45 and down to 40', () => {
      // The 20 kg Bar reads 44 lb -- itself off the 5 lb grid, so the very first
      // nudge from the seeded anchor must snap (prototype: anchor toLbWhole(barKg)).
      const up = mountEntry();
      up.el.unit = 'lb'; // pristine seed reformats to 44
      const seenUp = targetSpy(up.el);
      tap(up.root, '[data-step="inc"]');
      expect(seenUp).toHaveBeenLastCalledWith(lbToKg(45));
      const down = mountEntry();
      down.el.unit = 'lb';
      const seenDown = targetSpy(down.el);
      tap(down.root, '[data-step="dec"]');
      expect(seenDown).toHaveBeenLastCalledWith(lbToKg(40));
    });
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

  it('presents the keypad as a fixed bottom-docked sheet, out of document flow', () => {
    // RBAR-22: the keypad is a bottom sheet (position: fixed) docked to the viewport
    // bottom, NOT an inline grid -- so opening it never displaces the bar/Total/Recents.
    // happy-dom can't measure layout, so text-lock the fixed positioning + nesting; the
    // real no-displacement check is the browser pass.
    const { root } = mountEntry();
    const styleText = root.querySelector('style')!.textContent!;
    expect(styleText).toMatch(/\.sheet\s*\{[^}]*position:\s*fixed/);
    const sheet = root.querySelector<HTMLElement>('[data-sheet]')!;
    expect(sheet).not.toBeNull();
    // the keypad grid lives inside the sheet, not in the entry's normal flow
    expect(sheet.querySelector('[data-keypad]')).not.toBeNull();
  });

  it('has no dim scrim -- the bar above stays bright (prototype fidelity)', () => {
    // Caitlin's fidelity call: unlike Setup/Share, the keypad has no backdrop; the sheet
    // is the only overlay element, so there is nothing to dim/occlude the bar or catch an
    // outside tap.
    const { root } = mountEntry();
    expect(root.querySelector('[data-scrim]')).toBeNull();
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

  it('tapping the value opens the sheet; it starts closed', () => {
    const { root } = mountEntry();
    const sheet = root.querySelector<HTMLElement>('[data-sheet]')!;
    expect(sheet.hidden).toBe(true);
    tap(root, '[data-value]');
    expect(sheet.hidden).toBe(false);
  });

  it('the Done button closes the sheet and commits the Target (keypadclose)', () => {
    // Done is the dismiss (there is no scrim); closing commits to Recents (RBAR-20).
    const { el, root } = mountEntry();
    const seen = vi.fn();
    el.addEventListener('keypadclose', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    ['1', '0', '0'].forEach((k) => key(root, k)); // type 100 (sheet still closed)
    tap(root, '[data-value]'); // open
    expect(seen).not.toHaveBeenCalled();
    tap(root, '[data-done]'); // dismiss via Done
    expect(root.querySelector<HTMLElement>('[data-sheet]')!.hidden).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenLastCalledWith(100);
  });

  it('a value re-tap toggles the sheet closed and commits once', () => {
    const { el, root } = mountEntry();
    const seen = vi.fn();
    el.addEventListener('keypadclose', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    ['1', '0', '0'].forEach((k) => key(root, k));
    tap(root, '[data-value]'); // open
    tap(root, '[data-value]'); // toggle closed
    expect(root.querySelector<HTMLElement>('[data-sheet]')!.hidden).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenLastCalledWith(100);
  });

  it('re-opening the sheet on a typed value replaces it on the next key (handoff 5)', () => {
    // "First keypress after opening replaces" -- tapping the value to reopen the pad
    // treats the shown number as a fresh placeholder, so typing 5 yields 5, not 1005.
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    ['1', '0', '0'].forEach((k) => key(root, k)); // type 100 (no longer pristine)
    expect(seen).toHaveBeenLastCalledWith(100);
    tap(root, '[data-value]'); // reopen the sheet on the existing 100
    key(root, '5'); // first key after opening
    expect(seen).toHaveBeenLastCalledWith(5);
    expect(root.querySelector('[data-value-num]')!.textContent).toBe('5');
  });

  it('del after reopening a typed value deletes one char, not the whole field', () => {
    // Regression guard: replace-on-open must not turn the first del into a full wipe of a
    // real value -- del edits one character; only a genuine placeholder default (the bare
    // Bar seed) is discarded wholesale by del.
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    ['1', '4', '2', '.', '5'].forEach((k) => key(root, k)); // 142.5
    tap(root, '[data-value]'); // reopen the sheet on 142.5
    key(root, 'del'); // first key after reopening
    expect(root.querySelector('[data-value-num]')!.textContent).toBe('142.');
    expect(seen).toHaveBeenLastCalledWith(142); // "142." parses to 142
  });

  it('re-opening a typed value and closing WITHOUT typing still commits it (not null)', () => {
    // The replace-on-open flag must not corrupt the commit contract: a real typed value
    // peeked and closed is still a Target the lifter chose, so it commits (only a genuine
    // untouched seeded default carries null).
    const { el, root } = mountEntry();
    const seen = vi.fn();
    el.addEventListener('keypadclose', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    ['1', '0', '0'].forEach((k) => key(root, k)); // 100
    tap(root, '[data-value]'); // open
    tap(root, '[data-value]'); // close without typing
    expect(seen).toHaveBeenLastCalledWith(100);
  });

  it('Clear empties the field but keeps the sheet open', () => {
    // Clear (ghost footer) is an edit, not a dismiss -- the lifter keeps typing.
    const { el, root } = mountEntry();
    const seen = targetSpy(el);
    tap(root, '[data-value]'); // open
    ['1', '0'].forEach((k) => key(root, k));
    tap(root, '[data-key="clear"]');
    expect(seen).toHaveBeenLastCalledWith(null);
    expect(root.querySelector<HTMLElement>('[data-sheet]')!.hidden).toBe(false);
  });

  it('mirrors the live entry value inside the sheet as it is typed', () => {
    // The sheet covers the value behind it, so it carries its own live readout.
    const { root } = mountEntry();
    tap(root, '[data-value]'); // open
    ['4', '2'].forEach((k) => key(root, k));
    expect(root.querySelector('[data-live]')!.textContent).toBe('42');
  });

  it('shows the typed value in the OTHER unit as a secondary line (handoff 5)', () => {
    // 100 kg reads 220 lb; the secondary tracks the SAME canonical weight the big number
    // shows, so it never drifts.
    const { root } = mountEntry();
    tap(root, '[data-value]');
    ['1', '0', '0'].forEach((k) => key(root, k));
    expect(root.querySelector('[data-live-sec]')!.textContent).toBe(format(100, 'lb')); // "220 lb"
  });

  it('renders the console-fed "on the bar" load line, and hides it when null', () => {
    // The console owns decode (ADR-0005) and pushes the loadable-Total line down; null
    // (nothing decoded) hides it.
    const { el, root } = mountEntry();
    const load = root.querySelector<HTMLElement>('[data-live-load]')!;
    expect(load.hidden).toBe(true); // nothing fed yet
    el.loadLine = 'On the bar: 142 kg \u00B7 0.5 under';
    expect(load.hidden).toBe(false);
    expect(load.textContent).toBe('On the bar: 142 kg \u00B7 0.5 under');
    el.loadLine = null;
    expect(load.hidden).toBe(true);
  });

  it('anchors the empty-field default and the steppers at the chosen Bar, not just 20', () => {
    // RBAR-15: the Bar is now a lifter choice. The entry seeds its pristine default
    // to the Bar weight and steps from it (you load a bar UP from its own weight), so
    // a 15 kg Bar must show 15 as the anchor and step from 15 -- not the 20 kg default.
    const { el, root } = mountEntry();
    el.barKg = 15;
    const value = root.querySelector<HTMLElement>('[data-value]')!;
    expect(value.querySelector('[data-value-num]')!.textContent).toBe('15');
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
    expect(value.querySelector('[data-value-num]')!.textContent).toBe('5'); // the muted anchor follows the Bar
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
    expect(value.querySelector('[data-value-num]')!.textContent).toBe('100');
  });

  it('emits keypadclose with the current Target when the keypad closes (commit point)', () => {
    // Closing the keypad is a Target commit -- the console pushes it onto Recents
    // (RBAR-20). The event fires only on the open->closed transition, carrying the
    // Target shown, so opening the pad does not push and closing it does.
    const { el, root } = mountEntry();
    const seen = vi.fn();
    el.addEventListener('keypadclose', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    ['1', '0', '0'].forEach((k) => key(root, k)); // type 100 (keypad still closed)
    tap(root, '[data-value]'); // open the keypad
    expect(seen).not.toHaveBeenCalled(); // opening must not commit
    tap(root, '[data-value]'); // close it
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenLastCalledWith(100);
  });

  it('keypadclose carries null on an idle peek of the untouched default (pristine)', () => {
    // Opening then closing the keypad without typing must not commit the seeded Bar
    // weight -- it is a value the lifter never chose, so it would litter Recents.
    const { el, root } = mountEntry();
    const seen = vi.fn();
    el.addEventListener('keypadclose', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    tap(root, '[data-value]'); // open on the pristine default
    tap(root, '[data-value]'); // close without typing
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('keypadclose carries null when the field still holds a display()-seeded value', () => {
    // A value seeded via display() (a re-applied chip, a mode-switch carry) is pristine
    // too: an idle peek-and-close must not re-commit it.
    const { el, root } = mountEntry();
    el.display(120);
    const seen = vi.fn();
    el.addEventListener('keypadclose', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    tap(root, '[data-value]'); // open
    tap(root, '[data-value]'); // close, untouched
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('keypadclose carries a null Target when the field is empty on close', () => {
    const { el, root } = mountEntry();
    const seen = vi.fn();
    el.addEventListener('keypadclose', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    tap(root, '[data-value]'); // open
    tap(root, '[data-key="clear"]'); // empty the field
    tap(root, '[data-value]'); // close
    expect(seen).toHaveBeenLastCalledWith(null);
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

  describe('display Unit (RBAR-17, ADR-0010)', () => {
    function valueText(root: ShadowRoot): string {
      return root.querySelector<HTMLElement>('[data-value-num]')!.textContent ?? '';
    }

    it('captions the field "Target" -- the Unit moved into the value suffix (RBAR-39)', () => {
      const { el, root } = mountEntry();
      expect(root.querySelector('[data-caption]')!.textContent).toBe('Target');
      el.unit = 'lb';
      expect(root.querySelector('[data-caption]')!.textContent).toBe('Target');
    });

    it('renders the unit suffix in the active Unit (kg -> lb)', () => {
      const { el, root } = mountEntry();
      expect(root.querySelector('[data-value-unit]')!.textContent).toBe(' kg');
      el.unit = 'lb';
      expect(root.querySelector('[data-value-unit]')!.textContent).toBe(' lb');
    });

    it('shows the seeded Bar anchor in the active Unit (20 kg -> 44 lb)', () => {
      const { el, root } = mountEntry();
      el.unit = 'lb';
      expect(valueText(root)).toBe('44'); // toLbWhole(20)
    });

    it('parses a typed lb entry to a canonical kg Target', () => {
      const { el, root } = mountEntry();
      el.unit = 'lb';
      const seen = targetSpy(el);
      ['1', '3', '5'].forEach((k) => key(root, k));
      expect(seen).toHaveBeenLastCalledWith(lbToKg(135));
    });

    it('steps by 5 lb in lb mode (the US-gym increment)', () => {
      const { el, root } = mountEntry();
      el.unit = 'lb';
      el.display(lbToKg(135)); // shows 135
      const seen = targetSpy(el);
      tap(root, '[data-step="inc"]');
      expect(valueText(root)).toBe('140');
      expect(seen).toHaveBeenLastCalledWith(lbToKg(140));
    });

    it('reformats the SAME canonical weight on a Unit switch (no re-parse)', () => {
      const { el, root } = mountEntry();
      ['1', '0', '0'].forEach((k) => key(root, k)); // 100 kg
      el.unit = 'lb';
      expect(valueText(root)).toBe(String(shownIn(100, 'lb'))); // 220
    });

    it('round-trips kg -> lb -> kg without drift (canonical preserved)', () => {
      const { el, root } = mountEntry();
      ['1', '0', '0'].forEach((k) => key(root, k)); // 100 kg
      el.unit = 'lb'; // shows 220
      el.unit = 'kg'; // must return to 100, not 99.79 (220 lb re-parsed)
      expect(valueText(root)).toBe('100');
    });

    it('seeds display() in the active Unit', () => {
      const { el, root } = mountEntry();
      el.unit = 'lb';
      el.display(lbToKg(225));
      expect(valueText(root)).toBe('225');
    });

    describe('a Unit switch re-pristines the draft (RBAR-38, prototype setUnit L561-567)', () => {
      // The converted draft is a REFORMAT of a weight the lifter already chose, not a
      // fresh entry -- so the next keypress starts over instead of appending to it.

      it('the first keypad key after a Unit switch REPLACES the converted draft', () => {
        const { el, root } = mountEntry();
        ['1', '0', '0'].forEach((k) => key(root, k)); // 100 kg
        el.unit = 'lb'; // reformats to 220
        const seen = targetSpy(el);
        key(root, '3'); // must yield 3, not 2203
        expect(valueText(root)).toBe('3');
        expect(seen).toHaveBeenLastCalledWith(lbToKg(3));
      });

      it('del after a Unit switch discards the converted draft whole', () => {
        // Prototype press(): del on a fresh (re-pristined) draft clears it outright.
        const { el, root } = mountEntry();
        ['1', '0', '0'].forEach((k) => key(root, k));
        el.unit = 'lb';
        const seen = targetSpy(el);
        key(root, 'del');
        expect(seen).toHaveBeenLastCalledWith(null);
        expect(root.querySelector('[data-value]')!.classList.contains('empty')).toBe(true);
      });

      it('keypadclose after a Unit switch commits the canonical Target, drift-free', () => {
        // The lifter typed this weight; the toggle only re-dressed it -- so type ->
        // toggle -> Done must still commit (the prototype's close pushes srcKg
        // regardless of pristine). And it commits the CANONICAL kg: 100, never the
        // re-parsed rounded draft (draftToKg("220", lb) ~ 99.79).
        const { el, root } = mountEntry();
        ['1', '0', '0'].forEach((k) => key(root, k));
        el.unit = 'lb'; // shows 220
        const seen = vi.fn();
        el.addEventListener('keypadclose', (e) =>
          seen((e as CustomEvent<{ target: number | null }>).detail.target),
        );
        tap(root, '[data-value]'); // open
        tap(root, '[data-value]'); // close untouched
        expect(seen).toHaveBeenLastCalledWith(100);
      });

      it('keypadclose after toggling a SEEDED default still carries null', () => {
        // The re-pristine must not make a seed committable: the Bar anchor reformatted
        // to lb is still a weight the lifter never chose.
        const { el, root } = mountEntry();
        el.unit = 'lb'; // the pristine 20 kg seed re-dresses to 44
        const seen = vi.fn();
        el.addEventListener('keypadclose', (e) =>
          seen((e as CustomEvent<{ target: number | null }>).detail.target),
        );
        tap(root, '[data-value]'); // open
        tap(root, '[data-value]'); // close untouched
        expect(seen).toHaveBeenLastCalledWith(null);
      });

      it('keypadclose after toggling a display()-seeded value still carries null', () => {
        // A mode-switch carry (display()) stays an idle peek across a Unit toggle.
        const { el, root } = mountEntry();
        el.display(120);
        el.unit = 'lb';
        const seen = vi.fn();
        el.addEventListener('keypadclose', (e) =>
          seen((e as CustomEvent<{ target: number | null }>).detail.target),
        );
        tap(root, '[data-value]'); // open
        tap(root, '[data-value]'); // close untouched
        expect(seen).toHaveBeenLastCalledWith(null);
      });

      it('a Bar change does not stomp a toggled TYPED Target that matches the anchor', () => {
        // Typed 20 on the 20 kg Bar, toggled to lb: the field reads "44" -- the same
        // text as the Bar anchor. Picking another Bar must not mistake it for a seed
        // and re-seed the field while the Target stands.
        const { el, root } = mountEntry();
        ['2', '0'].forEach((k) => key(root, k)); // a deliberate empty-bar Target
        el.unit = 'lb'; // shows 44, same as the anchor text
        el.barKg = 15;
        expect(valueText(root)).toBe('44'); // the typed Target survives
      });

      it('a decimal point as the first key after a Unit switch starts a fresh draft', () => {
        const { el, root } = mountEntry();
        ['1', '0', '0'].forEach((k) => key(root, k));
        el.unit = 'lb'; // 220, re-pristined
        const seen = targetSpy(el);
        key(root, '.');
        expect(valueText(root)).toBe('0.'); // replaced, not "220."
        expect(seen).toHaveBeenLastCalledWith(0);
      });

      it('a stepper nudge after a Unit switch makes the value real again (commits on close)', () => {
        // The re-pristine must not swallow a genuine follow-up edit: nudging after a
        // toggle is a real choice, so closing the pad commits it.
        const { el, root } = mountEntry();
        ['1', '0', '0'].forEach((k) => key(root, k));
        el.unit = 'lb'; // 220, re-pristined
        tap(root, '[data-step="inc"]'); // 225 -- a real edit
        const seen = vi.fn();
        el.addEventListener('keypadclose', (e) =>
          seen((e as CustomEvent<{ target: number | null }>).detail.target),
        );
        tap(root, '[data-value]'); // open
        tap(root, '[data-value]'); // close
        expect(seen).toHaveBeenLastCalledWith(lbToKg(225));
      });
    });
  });
});

describe('<rack-entry> (numeric typography, RBAR-39)', () => {
  // The handoff sets every display number in Hanken (mono is reserved for labels,
  // plate numerals, and unit toggles) with explicit tabular figures -- Hanken is
  // proportional, so without tnum the digits jitter as the value changes. happy-dom
  // computes no layout, so these text-lock the rule bodies; the rendered check is
  // the browser pass.
  function rule(root: ShadowRoot, selector: string): string {
    const css = root.querySelector('style')!.textContent!;
    const start = css.indexOf(selector);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('sets the Target value in Hanken 700 30px with tabular figures (prototype L150)', () => {
    const { root } = mountEntry();
    const value = rule(root, '.value {');
    expect(value).toContain('var(--rack-font)');
    expect(value).not.toContain('var(--rack-font-num)');
    expect(value).toContain('font-weight: 700');
    expect(value).toContain('font-size: 30px');
    expect(value).toContain('line-height: 1.2');
    expect(value).toContain('tabular-nums');
  });

  it('renders the Target unit as a small dim suffix (15px/600, text-dim)', () => {
    const { root } = mountEntry();
    const vu = rule(root, '.value .vu');
    expect(vu).toContain('font-size: 15px');
    expect(vu).toContain('font-weight: 600');
    expect(vu).toContain('var(--rack-text-dim)');
  });

  it('rolls the Target value on change, never the suffix', () => {
    const { root } = mountEntry();
    key(root, '5'); // 20 -> 5: a real change, the roll arms
    expect(root.querySelector('[data-value-num]')!.classList.contains('roll')).toBe(true);
    expect(root.querySelector('[data-value-unit]')!.classList.contains('roll')).toBe(false);
  });

  it('sets the keypad live number in Hanken 800 46px -.02em with tabular figures (prototype L231)', () => {
    const { root } = mountEntry();
    const live = rule(root, '.live-num {');
    expect(live).toContain('var(--rack-font)');
    expect(live).not.toContain('var(--rack-font-num)');
    expect(live).toContain('font-weight: 800');
    expect(live).toContain('font-size: 46px');
    expect(live).toContain('letter-spacing: -.02em');
    expect(live).toContain('tabular-nums');
  });

  it('sets the keypad live unit suffix small and dim (18px/700, text-dim)', () => {
    const { root } = mountEntry();
    const liveU = rule(root, '.live-u {');
    expect(liveU).toContain('font-size: 18px');
    expect(liveU).toContain('font-weight: 700');
    expect(liveU).toContain('var(--rack-text-dim)');
  });

  it('rolls the keypad live number on change (numRoll, prototype entryNumStyle)', () => {
    const { root } = mountEntry();
    tap(root, '[data-value]'); // open the sheet
    key(root, '4'); // 20 -> 4: the live readout rolls
    expect(root.querySelector('[data-live]')!.classList.contains('roll')).toBe(true);
  });
});

// RBAR-53: the keypad sheet participates in the announcement layer. Its "On the bar"
// load line is a polite status region (active only while the sheet shows), and the
// sheet's open edge is announced to the console via `keypadopen` -- the console's cue
// to hand the single announcement source over to the sheet.
describe('keypad sheet announcements (RBAR-53)', () => {
  it('dispatches keypadopen when the sheet opens, and only then', () => {
    const { el, root } = mountEntry();
    const seen = vi.fn();
    el.addEventListener('keypadopen', seen);
    tap(root, '[data-value]'); // open
    expect(seen).toHaveBeenCalledTimes(1);
    tap(root, '[data-value]'); // a re-tap closes -- no second open
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('the load line is a polite status region that hides while empty', () => {
    const { el, root } = mountEntry();
    const line = root.querySelector<HTMLElement>('[data-live-load]')!;
    expect(line.getAttribute('role')).toBe('status');
    expect(line.hidden).toBe(true); // nothing decoded yet
    el.loadLine = 'On the bar: 100 kg \u00B7 2.5 under';
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe('On the bar: 100 kg \u00B7 2.5 under');
    el.loadLine = null;
    expect(line.hidden).toBe(true);
  });

  it('re-setting an unchanged load line does not touch the region (no re-announce)', () => {
    // Deliberately the EXACT variant: since RBAR-46 that state re-renders as the
    // dedicated svg+text line, so the idempotence guard must key off the fed string,
    // not the (now diverged) rendered DOM.
    const { el, root } = mountEntry();
    el.loadLine = 'On the bar: 100 kg \u00B7 exact';
    const line = root.querySelector<HTMLElement>('[data-live-load]')!;
    const mo = new MutationObserver(() => {});
    mo.observe(line, { childList: true, characterData: true, subtree: true });
    el.loadLine = 'On the bar: 100 kg \u00B7 exact'; // the same text again
    const records = mo.takeRecords();
    mo.disconnect();
    expect(records.length).toBe(0);
  });
});

// RBAR-46: keypad surface fidelity. The keys sit RAISED off the sunken sheet, the
// footer matches the prototype's compact metrics, the sheet consumes the shared shadow
// token and eases in with a fade, the exact state gets its dedicated line back, and the
// delete key wears the handoff's backspace glyph (as an inline SVG -- ASCII source).
// happy-dom computes no layout, so the metric checks text-lock the rule bodies; the
// rendered check is the browser pass.
describe('keypad surface fidelity (RBAR-46)', () => {
  // `occurrence` picks a later match when the selector text nests inside an earlier
  // rule head (".done {" is the tail of ".clear, .done {").
  function rule(root: ShadowRoot, selector: string, occurrence = 0): string {
    const css = root.querySelector('style')!.textContent!;
    let start = -1;
    for (let i = 0; i <= occurrence; i++) start = css.indexOf(selector, start + 1);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('raises the keys off the sheet: raised fill, 13px radius, 44px, mono 600 20px', () => {
    const { root } = mountEntry();
    const key = rule(root, '.key {');
    expect(key).toContain('background: var(--rack-raised)'); // no longer transparent
    expect(key).toContain('border-radius: var(--rack-radius-sheet-control)');
    expect(key).toContain('min-height: 44px'); // prototype height IS the touch floor
    expect(key).toContain('font-size: 20px');
    expect(key).toContain('font-weight: 600');
  });

  it('sets the footer at 42px on the sheet-control radius (prototype L244-245)', () => {
    const { root } = mountEntry();
    const shared = rule(root, '.clear, .done');
    expect(shared).toContain('min-height: 42px');
    expect(shared).toContain('border-radius: var(--rack-radius-sheet-control)');
    const clear = rule(root, '.clear {');
    expect(clear).toContain('font-size: 13px');
    expect(clear).toContain('font-weight: 600');
    const done = rule(root, '.done {', 1); // occurrence 0 is inside ".clear, .done {"
    expect(done).toContain('font-size: 14px');
    expect(done).toContain('font-weight: 700');
  });

  it('lifts the sheet with the shared --rack-shadow-sheet token, not a literal', () => {
    const { root } = mountEntry();
    const sheet = rule(root, '.sheet {');
    expect(sheet).toContain('box-shadow: var(--rack-shadow-sheet)');
  });

  it('eases the sheet in with a .2s ease-out fade; the rise is reduced-motion-gated', () => {
    const { root } = mountEntry();
    const css = root.querySelector('style')!.textContent!;
    // everyone gets the opacity fade (not motion) ...
    expect(rule(root, '.sheet {')).toContain('animation: rack-sheet-fade .2s ease-out');
    // ... only a no-preference lifter gets the translate rise, fade included
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.sheet \{ animation: rack-sheet-rise \.2s ease-out; \}/,
    );
    expect(css).toMatch(/rack-sheet-rise \{\s*from \{ transform: translateY\(100%\); opacity: 0; \}/);
  });

  it('shows the dedicated exact line when the Total lands exactly (prototype L235)', () => {
    const { el, root } = mountEntry();
    el.loadLine = 'On the bar: 100 kg \u00B7 exact';
    const line = root.querySelector<HTMLElement>('[data-live-load]')!;
    expect(line.hidden).toBe(false);
    expect(line.classList.contains('exact')).toBe(true);
    expect(line.textContent).toBe('exact'); // the announcement is just "exact"
    const check = line.querySelector('svg')!; // the checkmark drawing, decorative
    expect(check).not.toBeNull();
    expect(check.getAttribute('aria-hidden')).toBe('true');
  });

  it('returns to the accent delta line when the Total moves off exact', () => {
    const { el, root } = mountEntry();
    el.loadLine = 'On the bar: 100 kg \u00B7 exact';
    el.loadLine = 'On the bar: 101 kg \u00B7 1 over';
    const line = root.querySelector<HTMLElement>('[data-live-load]')!;
    expect(line.classList.contains('exact')).toBe(false);
    expect(line.textContent).toBe('On the bar: 101 kg \u00B7 1 over');
    expect(line.querySelector('svg')).toBeNull();
  });

  it('styles the exact line as the quiet mono confirmation (section-label recipe)', () => {
    const { root } = mountEntry();
    const exact = rule(root, '.sub .load.exact');
    expect(exact).toContain('font-size: 11px');
    expect(exact).toContain('letter-spacing: .14em');
    expect(exact).toContain('text-transform: uppercase');
    expect(exact).toContain('var(--rack-text-muted)'); // the 9aa1a9 tier
  });

  it('renders the delete key face as an inline SVG, keeping its "Delete" label', () => {
    const { root } = mountEntry();
    const del = root.querySelector<HTMLButtonElement>('[data-key="del"]')!;
    expect(del.getAttribute('aria-label')).toBe('Delete'); // the announcement, unchanged
    const icon = del.querySelector('svg')!;
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-hidden')).toBe('true'); // decorative drawing
    expect(del.textContent!.trim()).toBe(''); // no "del" text on the face anymore
  });
});

// RBAR-60: an Exact unit toggle re-expresses the lifter's Target as its load (55 lb
// typed = 24.95 kg; the 25 kg load reads 55 lb too). retarget is a REFORMAT of the
// lifter's own value -- silent, and the RBAR-38 commit contract still decides closes.
describe('<rack-entry> retarget (RBAR-60)', () => {
  const shown = (root: ShadowRoot) =>
    root.querySelector<HTMLElement>('[data-value-num]')!.textContent;
  function closeSpy(el: HTMLElement): ReturnType<typeof vi.fn> {
    const seen = vi.fn();
    el.addEventListener('keypadclose', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    return seen;
  }

  it('re-expresses a typed Target without emitting target', () => {
    const { el, root } = mountEntry();
    el.unit = 'lb';
    ['5', '5'].forEach((k) => key(root, k));
    const seen = targetSpy(el);
    el.retarget(25);
    expect(shown(root)).toBe('55'); // still reads 55 in lb
    expect(seen).not.toHaveBeenCalled(); // the console decodes it itself
  });

  it('then reads the new kg in the new unit once the unit flips', () => {
    const { el, root } = mountEntry();
    el.unit = 'lb';
    ['5', '5'].forEach((k) => key(root, k));
    el.retarget(25); // the console calls this before render flips the unit
    el.unit = 'kg';
    expect(shown(root)).toBe('25'); // not 24.95
  });

  it('commits the NEW kg on close after a typed Target is retargeted', () => {
    const { el, root } = mountEntry();
    const seen = closeSpy(el);
    el.unit = 'lb';
    ['5', '5'].forEach((k) => key(root, k));
    el.retarget(25);
    el.unit = 'kg';
    tap(root, '[data-value]'); // open
    tap(root, '[data-value]'); // close -> commit
    expect(seen).toHaveBeenLastCalledWith(25);
  });

  it('keeps a display()-seeded Target a seed: close still commits null', () => {
    // A Recent chip tap seeds via display(); an Exact toggle after it must not turn an
    // idle peek into a Recents entry.
    const { el, root } = mountEntry();
    const seen = closeSpy(el);
    el.unit = 'lb';
    el.display(lbToKg(55));
    el.retarget(25);
    el.unit = 'kg';
    tap(root, '[data-value]'); // open
    tap(root, '[data-value]'); // close
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('is a no-op on an empty field', () => {
    const { el, root } = mountEntry();
    const seen = closeSpy(el);
    key(root, 'clear'); // empty the field (a fresh entry is seeded with the Bar)
    el.retarget(25);
    expect(root.querySelector('[data-value]')!.classList.contains('empty')).toBe(true);
    tap(root, '[data-value]');
    tap(root, '[data-value]');
    expect(seen).toHaveBeenLastCalledWith(null);
  });
});

// RBAR-74 (the RBAR-48a metrics sweep): the Target row and the keypad sheet's lines,
// matched to the handoff prototype. Text locks on the rule bodies (happy-dom computes
// no layout); the rendered check is the browser pass and scripts/fit-check.js.
describe('<rack-entry> metrics sweep (RBAR-74)', () => {
  function rule(root: ShadowRoot, selector: string): string {
    const css = root.querySelector('style')!.textContent!;
    const start = css.indexOf(selector);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('draws the steppers as 44px circles (prototype L149/L151)', () => {
    const { root } = mountEntry();
    const step = rule(root, '.step {');
    expect(step).toContain('width: 44px');
    expect(step).toContain('height: 44px');
    expect(step).not.toContain('52px');
  });

  it('faces the steppers with a matched pair of SVG glyphs, not text characters', () => {
    const { root } = mountEntry();
    const dec = root.querySelector('[data-step="dec"]')!;
    const inc = root.querySelector('[data-step="inc"]')!;
    expect(dec.textContent!.trim()).toBe('');
    expect(inc.textContent!.trim()).toBe('');
    const dSvg = dec.querySelector('svg')!;
    const iSvg = inc.querySelector('svg')!;
    expect(dSvg.getAttribute('aria-hidden')).toBe('true');
    expect(iSvg.getAttribute('aria-hidden')).toBe('true');
    // The pair: the same box and the same stroke; plus is minus with a vertical bar.
    expect(iSvg.getAttribute('width')).toBe(dSvg.getAttribute('width'));
    expect(iSvg.getAttribute('viewBox')).toBe(dSvg.getAttribute('viewBox'));
    const dPath = dSvg.querySelector('path')!;
    const iPath = iSvg.querySelector('path')!;
    expect(iPath.getAttribute('stroke-width')).toBe(dPath.getAttribute('stroke-width'));
    expect(iPath.getAttribute('stroke-linecap')).toBe(dPath.getAttribute('stroke-linecap'));
    expect(iPath.getAttribute('d')!.startsWith(dPath.getAttribute('d')!)).toBe(true);
    expect(iPath.getAttribute('d')).not.toBe(dPath.getAttribute('d'));
  });

  it('spaces the Target row 10px apart (prototype L148)', () => {
    const { root } = mountEntry();
    expect(rule(root, '.row {')).toContain('gap: 10px');
  });

  it('inks the Target value #cfd3d8 on a 3px pad (prototype L150)', () => {
    const { root } = mountEntry();
    const value = rule(root, '.value {');
    expect(value).toContain('color: var(--rack-text-target)');
    expect(value).toContain('padding: 3px 0');
  });

  it('sets the keypad secondary line in Hanken 500 13px, 6px under the number (prototype L232-L233)', () => {
    const { root } = mountEntry();
    expect(rule(root, '.live {')).toContain('margin-bottom: 0');
    const sub = rule(root, '.sub {');
    expect(sub).toContain('font-family: var(--rack-font);');
    expect(sub).not.toContain('var(--rack-font-num)');
    expect(sub).toContain('font-weight: 500');
    expect(sub).toContain('font-size: 13px');
    expect(sub).toContain('margin-top: 6px');
    expect(sub).toContain('gap: 3px');
    // The readout block's 15px bottom margin (prototype L230) separates it from the keys.
    expect(sub).toContain('margin-bottom: 15px');
  });

  it('sets the keypad "On the bar" line in Hanken 600 11px accent (prototype L234)', () => {
    const { root } = mountEntry();
    const load = rule(root, '.sub .load {');
    expect(load).toContain('font-family: var(--rack-font);');
    expect(load).toContain('font-weight: 600');
    expect(load).toContain('font-size: 11px');
    expect(load).toContain('color: var(--rack-accent)');
  });

  it('opens the Target section 15px under the round-up row (prototype L146)', () => {
    const { root } = mountEntry();
    // The console column's 12px gap + 3px = the prototype's 15px margin-top.
    expect(rule(root, ':host {')).toContain('margin-top: 3px');
  });
});
