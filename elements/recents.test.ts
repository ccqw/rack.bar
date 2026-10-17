import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { COLLAPSE_MS, LONG_PRESS_MS, MOVE_SLOP_PX, UNDO_MS } from './recents.ts';
import { removeRecent, restoreRecent } from '../lib/recents.ts';
import { lbToKg } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';

type Recents = HTMLElement & {
  targets: readonly number[];
  unit: Unit;
  target: number | null;
  readonly undoPending: boolean;
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
  it('renders one chip per Target, in order, each with its unit (RBAR-37, RBAR-58)', () => {
    const { el, root } = mountRecents();
    el.targets = [120, 100, 80];
    const labels = chips(root).map((c) => c.textContent!.trim());
    expect(labels).toEqual(['120 kg', '100 kg', '80 kg']);
    // The unit is a suffix span (smaller, dimmer), so the number still reads first.
    expect(chips(root)[0].querySelector('.fu')!.textContent).toBe(' kg');
  });

  it('keeps the Unit in the accessible name', () => {
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
    expect(chips(root).map((c) => c.textContent!.trim())).toEqual(['120 kg', '100 kg']);
  });

  it('strips float fuzz from a fractional chip face', () => {
    const { el, root } = mountRecents();
    el.targets = [60.5];
    expect(chips(root)[0].textContent!.trim()).toBe('60.5 kg');
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

  it('also matches a Target that reads the same in the display Unit (RBAR-60)', () => {
    const { el, root } = mountRecents();
    el.targets = [25.4]; // 56 lb, stored canonically to 2 dp
    el.unit = 'lb';
    el.target = 25.5; // re-expressed as its 25.5 kg load: still reads 56 lb
    expect(selected(root)).toEqual([true]);
    el.unit = 'kg'; // in kg the two read 25.4 vs 25.5 -- different Targets
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

// RBAR-73: remove a Recent without an x. A long-press (or the context-menu key / a
// right-click) opens a one-item "Remove" popover on the chip; Delete/Backspace on a
// focused chip removes it at once. The removed chip's slot turns into an Undo chip for
// UNDO_MS, in place -- no new row (ADR-0013). The element emits the intent; the console
// owns the list (ADR-0009), so these tests echo it back the way the console does.
describe('<rack-recents> (remove + undo, RBAR-73)', () => {
  type Ev = { target: number; index: number };
  // Mount with a console-like owner: recentremove / recentrestore are applied with the
  // pure core and fed straight back, synchronously, as <rack-console> does.
  function owned(list: number[]) {
    const { el, root } = mountRecents();
    el.targets = list;
    const removed: Ev[] = [];
    const restored: Ev[] = [];
    el.addEventListener('recentremove', (e) => {
      const d = (e as CustomEvent<Ev>).detail;
      removed.push(d);
      el.targets = removeRecent(el.targets, d.target);
    });
    el.addEventListener('recentrestore', (e) => {
      const d = (e as CustomEvent<Ev>).detail;
      restored.push(d);
      el.targets = restoreRecent(el.targets, d.target, d.index);
    });
    return { el, root, removed, restored };
  }
  const faces = (root: ShadowRoot) => chips(root).map((c) => c.textContent!.trim());
  const undoBtn = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('[data-undo]');
  const menu = (root: ShadowRoot) => root.querySelector<HTMLElement>('[data-menu]')!;
  const removeItem = (root: ShadowRoot) =>
    root.querySelector<HTMLButtonElement>('[data-menu-remove]')!;
  const pointer = (type: string, x = 10, y = 10) =>
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
    });
  const del = (key = 'Delete') =>
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('a long-press (>= LONG_PRESS_MS, still) opens the Remove popover and does not load the Target', () => {
    const { el, root } = owned([120, 100, 80]);
    const applied = vi.fn();
    el.addEventListener('recentapply', applied);
    const chip = chips(root)[1];
    chip.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menu(root).hidden).toBe(false);
    expect(menu(root).getAttribute('aria-label')).toBe('Recent 100 kg');
    chip.dispatchEvent(pointer('pointerup'));
    chip.click(); // the click a release fires after a long-press is swallowed
    expect(applied).not.toHaveBeenCalled();
  });

  it('a short tap still loads the Target and opens no popover', () => {
    const { el, root } = owned([120, 100]);
    const applied = vi.fn();
    el.addEventListener('recentapply', applied);
    const chip = chips(root)[0];
    chip.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS / 3);
    chip.dispatchEvent(pointer('pointerup'));
    chip.click();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(applied).toHaveBeenCalledTimes(1);
    expect(menu(root).hidden).toBe(true);
  });

  it('a press that moves past the slop (a rail scroll) never opens the popover', () => {
    const { root } = owned([120, 100]);
    const chip = chips(root)[0];
    chip.dispatchEvent(pointer('pointerdown', 10, 10));
    chip.dispatchEvent(pointer('pointermove', 10 + MOVE_SLOP_PX + 1, 10));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(menu(root).hidden).toBe(true);
  });

  it('a jitter inside the slop still counts as holding still', () => {
    const { root } = owned([120, 100]);
    const chip = chips(root)[0];
    chip.dispatchEvent(pointer('pointerdown', 10, 10));
    chip.dispatchEvent(pointer('pointermove', 13, 12));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menu(root).hidden).toBe(false);
  });

  it('a pointercancel (the browser took the gesture as a scroll) or a rail scroll cancels the hold', () => {
    const { root } = owned([120, 100]);
    const chip = chips(root)[0];
    chip.dispatchEvent(pointer('pointerdown'));
    chip.dispatchEvent(pointer('pointercancel'));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(menu(root).hidden).toBe(true);

    chip.dispatchEvent(pointer('pointerdown'));
    root.querySelector('[data-rail]')!.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(menu(root).hidden).toBe(true);
  });

  it('shows the press-and-hold fill while held, and drops it on release', () => {
    const { root } = owned([120]);
    const chip = chips(root)[0];
    chip.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS / 2);
    expect(chip.classList.contains('holding')).toBe(true);
    chip.dispatchEvent(pointer('pointerup'));
    expect(chip.classList.contains('holding')).toBe(false);
  });

  it('Remove drops the chip, leaves an Undo in its slot, and Undo restores it in place', () => {
    const { root, removed, restored } = owned([120, 100, 80]);
    chips(root)[1].dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    removeItem(root).click();
    expect(removed).toEqual([{ target: 100, index: 1 }]);
    expect(faces(root)).toEqual(['120 kg', '80 kg']);
    expect(menu(root).hidden).toBe(true);
    // The Undo sits where the chip was: between 120 and 80 in the rail.
    const rail = [...root.querySelector('[data-rail]')!.children].map(
      (c) => (c as HTMLElement).dataset.target ?? 'undo',
    );
    expect(rail).toEqual(['120', 'undo', '80']);
    expect(undoBtn(root)!.getAttribute('aria-label')).toBe('Undo remove 100 kg');
    undoBtn(root)!.click();
    expect(restored).toEqual([{ target: 100, index: 1 }]);
    expect(faces(root)).toEqual(['120 kg', '100 kg', '80 kg']);
    expect(undoBtn(root)).toBeNull();
    expect(root.activeElement).toBe(chips(root)[1]); // focus lands on the restored chip
  });

  it('the Undo lapses after UNDO_MS: its slot collapses (COLLAPSE_MS), leaving the removal final', () => {
    const { root, restored } = owned([120, 100]);
    chips(root)[0].dispatchEvent(del());
    expect(undoBtn(root)).not.toBeNull();
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(undoBtn(root)!.classList.contains('collapsing')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(undoBtn(root)!.classList.contains('collapsing')).toBe(true); // the transition
    vi.advanceTimersByTime(COLLAPSE_MS);
    expect(undoBtn(root)).toBeNull();
    expect(faces(root)).toEqual(['100 kg']);
    expect(restored).toEqual([]);
  });

  it('Delete or Backspace on a focused chip removes it, and focus moves to the Undo', () => {
    for (const key of ['Delete', 'Backspace']) {
      const { root, removed } = owned([120, 100]);
      const docKeys = vi.fn();
      document.addEventListener('keydown', docKeys);
      chips(root)[0].focus();
      const ev = del(key);
      chips(root)[0].dispatchEvent(ev);
      document.removeEventListener('keydown', docKeys);
      expect(removed).toEqual([{ target: 120, index: 0 }]);
      expect(ev.defaultPrevented).toBe(true);
      // Claimed: an open keypad's document listener never also sees it as a digit delete.
      expect(docKeys).not.toHaveBeenCalled();
      expect(root.activeElement).toBe(undoBtn(root));
      document.body.innerHTML = '';
    }
  });

  it('the context-menu key / right-click opens the popover with focus on Remove; Escape closes it back to the chip', () => {
    const { root } = owned([120, 100]);
    const chip = chips(root)[1];
    chip.focus();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    chip.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // no native menu / iOS callout
    expect(menu(root).hidden).toBe(false);
    expect(root.activeElement).toBe(removeItem(root));
    removeItem(root).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(menu(root).hidden).toBe(true);
    expect(root.activeElement).toBe(chip);
  });

  it('a tap outside closes the popover without removing anything', () => {
    const { root, removed } = owned([120, 100]);
    chips(root)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menu(root).hidden).toBe(false);
    document.body.dispatchEvent(pointer('pointerdown'));
    expect(menu(root).hidden).toBe(true);
    expect(removed).toEqual([]);
  });

  it('removing the last chip keeps the row up for its Undo, then hides it', () => {
    const { el, root } = owned([100]);
    chips(root)[0].dispatchEvent(del());
    expect(chips(root)).toHaveLength(0);
    expect(el.hidden).toBe(false);
    expect(el.undoPending).toBe(true);
    vi.advanceTimersByTime(UNDO_MS + COLLAPSE_MS);
    expect(el.hidden).toBe(true);
    expect(el.undoPending).toBe(false);
  });

  it('a lapsing Undo never un-hides a row its owner hid (By Plates)', () => {
    const { el, root } = owned([120, 100]);
    chips(root)[0].dispatchEvent(del());
    el.hidden = true; // the console switched to By Plates
    vi.advanceTimersByTime(UNDO_MS + COLLAPSE_MS);
    expect(el.hidden).toBe(true);
  });

  it('a new history (a fresh commit) finalizes the pending Undos with the same collapse', () => {
    const { el, root } = owned([120, 100]);
    chips(root)[0].dispatchEvent(del());
    expect(undoBtn(root)).not.toBeNull();
    el.targets = [90, 100];
    expect(undoBtn(root)!.classList.contains('collapsing')).toBe(true); // no jump
    vi.advanceTimersByTime(COLLAPSE_MS);
    expect(undoBtn(root)).toBeNull();
    expect(faces(root)).toEqual(['90 kg', '100 kg']);
  });

  // The rail's slot structure, left to right: a chip's kg, or "undo:<kg>" for a slot
  // holding an Undo (its aria-label names the removed Target).
  const layout = (root: ShadowRoot) =>
    [...root.querySelector('[data-rail]')!.children].map((c) => {
      const b = c as HTMLElement;
      return b.dataset.target ?? `undo:${b.getAttribute('aria-label')!.replace(/\D+$/, '').replace(/^\D+/, '')}`;
    });

  it('rapid removals never move a chip: each removed slot becomes its own Undo, in place', () => {
    const { root, removed } = owned([120, 100, 80, 60]);
    chips(root)[1].dispatchEvent(del()); // 100
    expect(layout(root)).toEqual(['120', 'undo:100', '80', '60']);
    vi.advanceTimersByTime(UNDO_MS - 100);
    chips(root)[2].dispatchEvent(del()); // 60 (the third live chip)
    expect(layout(root)).toEqual(['120', 'undo:100', '80', 'undo:60']);
    chips(root)[0].dispatchEvent(del()); // 120
    expect(layout(root)).toEqual(['undo:120', 'undo:100', '80', 'undo:60']);
    // The console got each at its LIST index at the time (live chips before it).
    expect(removed).toEqual([
      { target: 100, index: 1 },
      { target: 60, index: 2 },
      { target: 120, index: 0 },
    ]);
    expect(faces(root)).toEqual(['80 kg']);
  });

  it('only the slot just removed fades in; the Undos already showing never re-blink', () => {
    const { el, root } = owned([120, 100, 80]);
    chips(root)[0].dispatchEvent(del()); // 120
    chips(root)[0].dispatchEvent(del()); // 100
    const fresh = () =>
      [...root.querySelectorAll<HTMLElement>('[data-undo]')].map((u) => u.classList.contains('fresh'));
    expect(fresh()).toEqual([false, true]);
    el.target = 80; // a re-render (the console feeds the Target on every keystroke)
    expect(fresh()).toEqual([false, true]);
  });

  it('a re-render mid-collapse never rebuilds the collapsing slots; the plain list follows', () => {
    const { el, root } = owned([120, 100]);
    chips(root)[0].dispatchEvent(del());
    vi.advanceTimersByTime(UNDO_MS);
    const collapsing = undoBtn(root)!;
    expect(collapsing.classList.contains('collapsing')).toBe(true);
    el.target = 100; // the console re-renders during the 200 ms
    el.unit = 'lb';
    expect(undoBtn(root)).toBe(collapsing); // same node: the transition keeps running
    vi.advanceTimersByTime(COLLAPSE_MS);
    expect(undoBtn(root)).toBeNull();
    expect(chips(root)[0].classList.contains('selected')).toBe(true); // caught up
  });

  it('the shared timer restarts on every removal; all slots collapse together after the last', () => {
    const { root } = owned([120, 100, 80]);
    chips(root)[0].dispatchEvent(del());
    vi.advanceTimersByTime(UNDO_MS - 100);
    chips(root)[0].dispatchEvent(del()); // 100, 4.9 s into the first window
    vi.advanceTimersByTime(UNDO_MS - 1); // well past the FIRST removal's 5 s
    expect(layout(root)).toEqual(['undo:120', 'undo:100', '80']);
    expect(root.querySelectorAll('.undo.collapsing')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(root.querySelectorAll('.undo.collapsing')).toHaveLength(2); // together
    vi.advanceTimersByTime(COLLAPSE_MS);
    expect(layout(root)).toEqual(['80']);
  });

  it('each Undo restores its own Target in its original slot while others stay pending', () => {
    const { root, restored } = owned([120, 100, 80, 60]);
    chips(root)[0].dispatchEvent(del()); // 120
    chips(root)[1].dispatchEvent(del()); // 80
    chips(root)[1].dispatchEvent(del()); // 60
    expect(layout(root)).toEqual(['undo:120', '100', 'undo:80', 'undo:60']);
    root.querySelector<HTMLButtonElement>('[data-undo][data-slot="2"]')!.click(); // 80
    expect(layout(root)).toEqual(['undo:120', '100', '80', 'undo:60']);
    expect(restored).toEqual([{ target: 80, index: 1 }]);
    expect(root.activeElement).toBe(chips(root)[1]);
    root.querySelector<HTMLButtonElement>('[data-undo][data-slot="0"]')!.click(); // 120
    expect(layout(root)).toEqual(['120', '100', '80', 'undo:60']);
    expect(restored.at(-1)).toEqual({ target: 120, index: 0 });
    root.querySelector<HTMLButtonElement>('[data-undo][data-slot="3"]')!.click(); // 60
    expect(layout(root)).toEqual(['120', '100', '80', '60']);
    expect(restored.at(-1)).toEqual({ target: 60, index: 3 });
  });

  it('Delete on the next chip works from the keyboard without focus jumping (Tab past the Undo)', () => {
    const { root, removed } = owned([120, 100, 80]);
    chips(root)[0].focus();
    chips(root)[0].dispatchEvent(del());
    expect(root.activeElement).toBe(undoBtn(root)); // slot 0
    chips(root)[0].focus(); // Tab: the next chip (100), still in its own slot
    chips(root)[0].dispatchEvent(del());
    expect(root.activeElement).toBe(
      root.querySelector('[data-undo][data-slot="1"]'),
    );
    expect(removed.map((r) => r.target)).toEqual([120, 100]);
    expect(layout(root)).toEqual(['undo:120', 'undo:100', '80']);
  });

  it('Backspace on the Undo chip is claimed too, and a held (repeating) key removes one chip only', () => {
    const { root, removed } = owned([120, 100, 80]);
    const docKeys = vi.fn();
    document.addEventListener('keydown', docKeys);
    chips(root)[0].dispatchEvent(del('Backspace'));
    const repeat = new KeyboardEvent('keydown', {
      key: 'Backspace', bubbles: true, composed: true, cancelable: true, repeat: true,
    });
    undoBtn(root)!.dispatchEvent(repeat); // auto-repeat lands on the focused Undo
    chips(root)[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, composed: true, repeat: true }),
    );
    document.removeEventListener('keydown', docKeys);
    expect(removed.map((r) => r.target)).toEqual([120]);
    expect(repeat.defaultPrevented).toBe(true);
    expect(docKeys).not.toHaveBeenCalled(); // an open keypad never sees it as a digit delete
  });

  it('Tab out of the popover closes it', () => {
    const { root } = owned([120, 100]);
    chips(root)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menu(root).hidden).toBe(false);
    removeItem(root).dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: chips(root)[1] }),
    );
    expect(menu(root).hidden).toBe(true);
  });

  it('a blur to the page (Safari, a tap on Remove) keeps the popover open so Remove still lands', () => {
    const { root, removed } = owned([120, 100]);
    chips(root)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    removeItem(root).dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: null }),
    );
    expect(menu(root).hidden).toBe(false);
    removeItem(root).click();
    expect(removed.map((r) => r.target)).toEqual([120]);
  });

  it('a long-press release with no click (iOS) never swallows a later keyboard activation', () => {
    const { el, root } = owned([120, 100]);
    const applied = vi.fn();
    el.addEventListener('recentapply', applied);
    const chip = chips(root)[0];
    chip.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    chip.dispatchEvent(pointer('pointerup')); // no click follows
    vi.advanceTimersByTime(1);
    removeItem(root).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    chips(root)[0].click(); // Enter/Space: a click with no pointerdown before it
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('when the Undo lapses, keyboard focus moves to the chip now in its slot', () => {
    const { root } = owned([120, 100]);
    chips(root)[0].focus();
    chips(root)[0].dispatchEvent(del());
    expect(root.activeElement).toBe(undoBtn(root));
    vi.advanceTimersByTime(UNDO_MS + COLLAPSE_MS);
    expect(root.activeElement).toBe(chips(root)[0]);
    expect(chips(root)[0].dataset.target).toBe('100');
  });

  it('tells screen readers how to remove, and announces a removal and its undo', () => {
    const { root } = owned([120]);
    const chip = chips(root)[0];
    const hint = root.getElementById(chip.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toMatch(/hold/i);
    expect(hint.textContent).toMatch(/Delete/);
    expect(chip.getAttribute('aria-keyshortcuts')).toBe('Delete');
    chip.dispatchEvent(del());
    const live = root.querySelector('[data-recents-announce]')!;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toBe('Removed 120 kg');
    undoBtn(root)!.click();
    expect(live.textContent).toBe('Restored 120 kg');
  });
});
