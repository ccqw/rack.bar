// RBAR-76 (ADR-0017): custom Bars in the Setup sheet. The sheet renders the app's
// `customBars` after the set's own Bars, offers a "+" tile that swaps the Bar row for a
// weight + kg|lb entry, and removes a custom Bar by long-press (or Delete), with Undo in
// its slot (the RBAR-73 pattern). It only emits intents (baradd / barremove /
// barrestore); the app owns the list.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './setup.ts';
import { lbToKg } from '../lib/units.ts';

type Stamp = { value: number; unit: 'kg' | 'lb' };
type Setup = HTMLElement & {
  barKg: number;
  plateSet: string;
  customBars: readonly Stamp[];
  open(): void;
  close(): void;
};

function mount(): { el: Setup; root: ShadowRoot } {
  // A fresh document per test: a focused tile left behind by the last test would leave
  // happy-dom's activeElement pointing into a detached tree.
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = '';
  const el = document.createElement('rack-setup') as Setup;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}
const tile = (root: ShadowRoot, kg: number) =>
  root.querySelector<HTMLButtonElement>(`[data-bar="${kg}"]`)!;
const addTile = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('[data-bar-add]');
const customTiles = (root: ShadowRoot) => [
  ...root.querySelectorAll<HTMLButtonElement>('[data-custom]'),
];
const input = (root: ShadowRoot) => root.querySelector<HTMLInputElement>('[data-bar-input]')!;
const unitBtn = (root: ShadowRoot, u: string) =>
  root.querySelector<HTMLButtonElement>(`[data-bar-unit="${u}"]`)!;
const save = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('[data-bar-save]')!;
const menu = (root: ShadowRoot) => root.querySelector<HTMLElement>('[data-bar-menu]')!;
const word = (t: Element) => t.querySelector('.word')!.textContent;
function spy(el: HTMLElement, type: string): ReturnType<typeof vi.fn> {
  const seen = vi.fn();
  el.addEventListener(type, (e) => seen((e as CustomEvent).detail));
  return seen;
}
const del = (t: HTMLElement) =>
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, composed: true }));
function longPress(t: HTMLElement): void {
  t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0 }));
  vi.advanceTimersByTime(600);
  t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}
// The Bar row, left to right: each tile's kg, 'undo' or 'add'.
const row = (root: ShadowRoot) =>
  [...root.querySelector('[data-bar-tiles]')!.children].map((c) =>
    c.hasAttribute('data-bar-undo')
      ? 'undo'
      : c.hasAttribute('data-bar-add')
        ? 'add'
        : (c as HTMLElement).dataset.bar,
  );

describe('<rack-setup> custom Bars (RBAR-76, ADR-0017)', () => {
  it('renders custom Bars after the set\'s own, labelled as typed, with the other Unit below', () => {
    const { el, root } = mount();
    el.customBars = [
      { value: 35, unit: 'lb' },
      { value: 7, unit: 'kg' },
    ];
    const tiles = [...root.querySelectorAll<HTMLElement>('[data-bar]')];
    expect(tiles.map(word)).toEqual(['20 kg', '15 kg', '5 kg', '35 lb', '7 kg']);
    expect(tiles[3]!.dataset.bar).toBe(String(lbToKg(35)));
    expect(tiles[3]!.querySelector('.csub')!.textContent).toBe('15.88 kg');
    expect(tiles[4]!.querySelector('.csub')!.textContent).toBe('15 lb');
    expect(tiles[3]!.getAttribute('aria-label')).toBe('35 lb Bar (15.88 kg), custom');
    expect(customTiles(root).map((t) => t.dataset.custom)).toEqual(['0', '1']);
    expect(row(root)).toEqual(['20', '15', '5', String(lbToKg(35)), '7', 'add']);
  });

  it('shows the custom Bars on every set; one that matches a set\'s own Bar is not repeated', () => {
    const { el, root } = mount();
    el.customBars = [
      { value: 45, unit: 'lb' },
      { value: 25, unit: 'kg' },
    ];
    expect(customTiles(root).map(word)).toEqual(['45 lb', '25 kg']);
    el.plateSet = 'training';
    // 45 lb is Training's own Bar: one tile, the built-in.
    expect(root.querySelectorAll(`[data-bar="${lbToKg(45)}"]`)).toHaveLength(1);
    expect(customTiles(root).map((t) => t.dataset.custom)).toEqual(['1']);
  });

  it('reflects a custom barKg onto its tile', () => {
    const { el, root } = mount();
    el.customBars = [{ value: 35, unit: 'lb' }];
    el.barKg = lbToKg(35);
    expect(customTiles(root)[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(tile(root, 20).getAttribute('aria-pressed')).toBe('false');
  });

  it('offers a "+" tile until there are 3 custom Bars', () => {
    const { el, root } = mount();
    expect(addTile(root)!.getAttribute('aria-label')).toBe('Add a Bar');
    el.customBars = [
      { value: 35, unit: 'lb' },
      { value: 7, unit: 'kg' },
    ];
    expect(addTile(root)).not.toBeNull();
    el.customBars = [...el.customBars, { value: 25, unit: 'kg' }];
    expect(addTile(root)).toBeNull();
  });

  it('"+" swaps the Bar row for a weight entry in the set\'s Unit, focused', () => {
    const { el, root } = mount();
    addTile(root)!.click();
    expect(root.activeElement).toBe(input(root));
    expect(input(root).getAttribute('inputmode')).toBe('decimal');
    expect(unitBtn(root, 'kg').getAttribute('aria-pressed')).toBe('true');
    expect(unitBtn(root, 'lb').getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelectorAll('[data-bar]')).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('[data-bar-cancel]')!.click();
    el.plateSet = 'training';
    addTile(root)!.click();
    expect(unitBtn(root, 'lb').getAttribute('aria-pressed')).toBe('true');
  });

  it('adds the stamp as typed in the chosen Unit (baradd) and returns to the tiles', () => {
    const { el, root } = mount();
    const added = spy(el, 'baradd');
    addTile(root)!.click();
    unitBtn(root, 'lb').click();
    expect(unitBtn(root, 'lb').getAttribute('aria-pressed')).toBe('true');
    input(root).value = '35';
    save(root).click();
    expect(added).toHaveBeenCalledWith({ value: 35, unit: 'lb' });
    expect(root.querySelector('[data-bar-input]')).toBeNull();
    expect(tile(root, 20)).toBeTruthy();
  });

  it('submits on Enter (the form submit), and accepts a comma decimal', () => {
    const { el, root } = mount();
    const added = spy(el, 'baradd');
    addTile(root)!.click();
    input(root).value = '15,9';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(added).toHaveBeenCalledWith({ value: 15.9, unit: 'kg' });
  });

  it('refuses an out-of-range or malformed weight: no event, the field flags it, the hint says why', () => {
    const { el, root } = mount();
    const added = spy(el, 'baradd');
    addTile(root)!.click();
    const hint = root.querySelector<HTMLElement>('[data-bar-hint]')!;
    expect(hint.textContent).toBe('Up to 50 kg');
    // Each failure names its own cause (RBAR-76 review): an in-range number with too
    // many decimals is not blamed on the range.
    const cases: [string, string][] = [
      ['', 'Enter a number, like 15 or 15.5'],
      ['abc', 'Enter a number, like 15 or 15.5'],
      ['1e1', 'Enter a number, like 15 or 15.5'],
      ['35.555', 'Up to 2 decimals'],
      ['7.125', 'Up to 2 decimals'],
      ['0', 'Enter 0.01 to 50 kg'],
      ['51', 'Enter 0.01 to 50 kg'],
    ];
    for (const [bad, why] of cases) {
      input(root).value = bad;
      save(root).click();
      expect(input(root).getAttribute('aria-invalid')).toBe('true');
      expect(hint.textContent).toBe(why);
      expect(hint.classList.contains('bad')).toBe(true);
    }
    expect(added).not.toHaveBeenCalled();
    unitBtn(root, 'lb').click();
    expect(hint.textContent).toBe('Up to 110 lb');
    expect(input(root).hasAttribute('aria-invalid')).toBe(false);
  });

  it('accepts a trailing dot ("35." is 35)', () => {
    const { el, root } = mount();
    const added = spy(el, 'baradd');
    addTile(root)!.click();
    unitBtn(root, 'lb').click();
    input(root).value = '35.';
    save(root).click();
    expect(added).toHaveBeenCalledWith({ value: 35, unit: 'lb' });
  });

  it('a custom Bar the set hides takes no slot there: "+" counts the custom tiles shown', () => {
    const { el, root } = mount();
    // 45 lb is Training's own Bar: three custom Bars on Comp, two custom tiles on Training.
    el.customBars = [
      { value: 45, unit: 'lb' },
      { value: 35, unit: 'lb' },
      { value: 25, unit: 'kg' },
    ];
    expect(addTile(root)).toBeNull();
    el.plateSet = 'training';
    expect(customTiles(root)).toHaveLength(2);
    expect(addTile(root)).not.toBeNull();
  });

  it('refuses, with a hint naming the set, an add that would give another set a 4th custom Bar', () => {
    const { el, root } = mount();
    const added = spy(el, 'baradd');
    el.customBars = [
      { value: 45, unit: 'lb' },
      { value: 35, unit: 'lb' },
      { value: 25, unit: 'kg' },
    ];
    el.plateSet = 'training';
    addTile(root)!.click();
    input(root).value = '15';
    save(root).click(); // 15 lb would be Comp's 4th custom tile
    expect(added).not.toHaveBeenCalled();
    expect(input(root).getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('[data-bar-hint]')!.textContent).toBe(
      'Comp has 3 custom Bars: remove one there',
    );
    unitBtn(root, 'kg').click();
    input(root).value = '15'; // 15 kg is Comp's own Bar: shown on Training only, so it fits
    save(root).click();
    expect(added).toHaveBeenCalledWith({ value: 15, unit: 'kg' });
  });

  it('Cancel and Escape return to the tiles without adding, focus back on "+"', () => {
    const { el, root } = mount();
    const added = spy(el, 'baradd');
    addTile(root)!.click();
    root.querySelector<HTMLButtonElement>('[data-bar-cancel]')!.click();
    expect(root.querySelector('[data-bar-input]')).toBeNull();
    expect(root.activeElement).toBe(addTile(root));
    addTile(root)!.click();
    input(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('[data-bar-input]')).toBeNull();
    expect(added).not.toHaveBeenCalled();
  });

  it('closing the sheet drops an open entry', () => {
    const { el, root } = mount();
    el.open();
    addTile(root)!.click();
    el.close();
    expect(root.querySelector('[data-bar-input]')).toBeNull();
  });
});

describe('<rack-setup> removing a custom Bar (RBAR-76; the RBAR-73 long-press pattern)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a long-press opens Remove; Remove emits barremove and leaves Undo in its slot', () => {
    const { el, root } = mount();
    el.customBars = [
      { value: 35, unit: 'lb' },
      { value: 7, unit: 'kg' },
    ];
    const removed = spy(el, 'barremove');
    const chose = spy(el, 'barchange');
    const t = customTiles(root)[0]!;
    longPress(t);
    t.click(); // the release's click must not also choose the Bar
    expect(chose).not.toHaveBeenCalled();
    expect(menu(root).hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-bar-menu-remove]')!.click();
    expect(removed).toHaveBeenCalledWith({ index: 0 });
    expect(menu(root).hidden).toBe(true);
    // The app echoes the shorter list; the Undo holds the removed Bar's slot, focused.
    el.customBars = [{ value: 7, unit: 'kg' }];
    expect(row(root)).toEqual(['20', '15', '5', 'undo', '7']);
    expect(root.activeElement).toBe(root.querySelector('[data-bar-undo]'));
  });

  it('a right-click (contextmenu) opens the same Remove', () => {
    const { el, root } = mount();
    el.customBars = [{ value: 35, unit: 'lb' }];
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    customTiles(root)[0]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(menu(root).hidden).toBe(false);
    menu(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu(root).hidden).toBe(true);
  });

  it('a short tap still chooses the custom Bar; a long-press on a built-in Bar does nothing', () => {
    const { el, root } = mount();
    el.customBars = [{ value: 35, unit: 'lb' }];
    const chose = spy(el, 'barchange');
    customTiles(root)[0]!.click();
    expect(chose).toHaveBeenLastCalledWith({ barKg: lbToKg(35) });
    longPress(tile(root, 20));
    expect(menu(root).hidden).toBe(true);
  });

  it('Undo restores the Bar at its place, re-selecting it if it was the chosen Bar', () => {
    const { el, root } = mount();
    el.customBars = [
      { value: 35, unit: 'lb' },
      { value: 7, unit: 'kg' },
    ];
    el.barKg = 7;
    const restored = spy(el, 'barrestore');
    del(customTiles(root)[1]!);
    el.customBars = [{ value: 35, unit: 'lb' }];
    el.barKg = 20;
    root.querySelector<HTMLButtonElement>('[data-bar-undo]')!.click();
    expect(restored).toHaveBeenCalledWith({ value: 7, unit: 'kg', index: 1, select: true });
    expect(root.querySelector('[data-bar-undo]')).toBeNull();
  });

  it('hides "+" while an Undo is pending; the Undo lapses after its window', () => {
    const { el, root } = mount();
    el.customBars = [{ value: 35, unit: 'lb' }];
    del(customTiles(root)[0]!);
    el.customBars = [];
    expect(addTile(root)).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(root.querySelector('[data-bar-undo]')).toBeNull();
    expect(addTile(root)).not.toBeNull();
  });

  // RBAR-76 review (WCAG 2.4.3): when the Undo lapses, focus stays in the dialog, on
  // the custom tile now in that slot, else "+" (as rack-recents' finishCollapse).
  it('when the Undo lapses, focus moves to the tile now in its slot, or to "+"', () => {
    const { el, root } = mount();
    el.customBars = [
      { value: 35, unit: 'lb' },
      { value: 7, unit: 'kg' },
    ];
    del(customTiles(root)[0]!);
    el.customBars = [{ value: 7, unit: 'kg' }];
    expect(root.activeElement).toBe(root.querySelector('[data-bar-undo]'));
    vi.advanceTimersByTime(5000);
    expect(root.activeElement).toBe(customTiles(root)[0]);
    del(customTiles(root)[0]!);
    el.customBars = [];
    vi.advanceTimersByTime(5000);
    expect(root.activeElement).toBe(addTile(root));
  });

  it('closing the sheet ends a pending Undo', () => {
    const { el, root } = mount();
    el.customBars = [{ value: 35, unit: 'lb' }];
    el.open();
    del(customTiles(root)[0]!);
    el.customBars = [];
    el.close();
    expect(root.querySelector('[data-bar-undo]')).toBeNull();
  });

  it('a pointer move past the slop is a scroll, not a long-press', () => {
    const { el, root } = mount();
    el.customBars = [{ value: 35, unit: 'lb' }];
    const t = customTiles(root)[0]!;
    t.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
    );
    t.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 30, clientY: 10 }));
    vi.advanceTimersByTime(600);
    expect(menu(root).hidden).toBe(true);
  });
});
