// <rack-setup>'s Pairs of Plates on Hand section (RBAR-72 slice 2, ADR-0016).
import { describe, it, expect, vi } from 'vitest';
import './setup.ts';
import type { PlatesOnHand } from '../lib/platesonhand.ts';

type Setup = HTMLElement & {
  plateSet: string;
  platesOnHand: PlatesOnHand;
  open(): void;
  close(): void;
};

function mount(onHand: PlatesOnHand = {}, set = 'comp'): { el: Setup; root: ShadowRoot } {
  const el = document.createElement('rack-setup') as Setup;
  document.body.append(el);
  el.plateSet = set;
  el.platesOnHand = onHand;
  el.open();
  return { el, root: el.shadowRoot! };
}

const tiles = (root: ShadowRoot) => [...root.querySelectorAll<HTMLButtonElement>('[data-face]')];
const tile = (root: ShadowRoot, face: string) =>
  root.querySelector<HTMLButtonElement>(`[data-face="${face}"]`)!;
const row = (root: ShadowRoot) => root.querySelector<HTMLElement>('[data-pairs-row]')!;
const choice = (root: ShadowRoot, n: string) =>
  root.querySelector<HTMLButtonElement>(`[data-pairs="${n}"]`)!;
const reset = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('[data-pairs-reset]')!;

function spy(el: HTMLElement, type: string): ReturnType<typeof vi.fn> {
  const seen = vi.fn();
  el.addEventListener(type, (e) => seen((e as CustomEvent).detail));
  return seen;
}

describe('<rack-setup> Pairs of Plates on Hand (RBAR-72)', () => {
  it('titles the section exactly, with All plates at its right, and no other copy', () => {
    const { root } = mount();
    const heading = root.querySelector('#onhand-heading')!;
    expect(heading.textContent).toBe('Pairs of Plates on Hand');
    const labelRow = heading.parentElement!;
    expect(labelRow.lastElementChild).toBe(reset(root));
    expect(reset(root).textContent).toBe('All plates');
    // Nothing but the tiles and the (hidden) pair row follow the title row.
    expect(labelRow.nextElementSibling?.hasAttribute('data-onhand-tiles')).toBe(true);
    expect(labelRow.nextElementSibling?.nextElementSibling).toBe(row(root));
    expect(row(root).nextElementSibling).toBeNull();
  });

  it('shows one tile per Competition size in its Plate color, each reading all', () => {
    const { root } = mount();
    expect(tiles(root).map((t) => t.dataset.face)).toEqual([
      '25', '20', '15', '10', '5', '2.5', '2', '1.5', '1', '0.5',
    ]);
    expect(tile(root, '15').getAttribute('style')).toContain('--rack-plate-yellow');
    expect(tiles(root).every((t) => t.querySelector('.state')!.textContent === 'all')).toBe(true);
    expect(tile(root, '25').getAttribute('aria-label')).toBe('25 kg red: all');
    expect(row(root).hidden).toBe(true);
    expect(reset(root).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the Training sizes on Training', () => {
    const { root } = mount({}, 'training');
    expect(tiles(root).map((t) => t.dataset.face)).toEqual(['45', '35', '25', '10', '5', '2.5']);
    expect(tile(root, '45').getAttribute('aria-label')).toBe('45 lb iron: all');
  });

  it('a tile reads its limit: 1 pair, N pairs, none (dimmed and struck)', () => {
    const { root } = mount({ comp: { '25': 1, '20': 3, '0.5': 0 } });
    expect(tile(root, '25').querySelector('.state')!.textContent).toBe('1 pair');
    expect(tile(root, '25').dataset.state).toBe('limited');
    expect(tile(root, '20').querySelector('.state')!.textContent).toBe('3 pairs');
    expect(tile(root, '0.5').querySelector('.state')!.textContent).toBe('none');
    expect(tile(root, '0.5').dataset.state).toBe('none');
    expect(tile(root, '0.5').getAttribute('aria-label')).toBe('0.5 kg white: none');
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.size\[data-state="none"\] \{ opacity: \.5; \}/);
    expect(css).toMatch(/\.size\[data-state="none"\] \.face \{ text-decoration: line-through; \}/);
    expect(reset(root).getAttribute('aria-disabled')).toBe('false');
  });

  it('only the active set limits show: Training limits never touch Competition', () => {
    const { root } = mount({ training: { '45': 0 } });
    expect(tile(root, '25').dataset.state).toBe('all');
    expect(reset(root).getAttribute('aria-disabled')).toBe('true');
  });

  it('tapping a tile opens its None / 1 / 2 / 3 / 4 / All row; tapping it again closes it', () => {
    const { root } = mount({ comp: { '15': 2 } });
    tile(root, '15').click();
    expect(row(root).hidden).toBe(false);
    expect(tile(root, '15').getAttribute('aria-expanded')).toBe('true');
    expect([...row(root).querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'None', '1', '2', '3', '4', 'All',
    ]);
    expect(choice(root, '2').getAttribute('aria-pressed')).toBe('true');
    expect(choice(root, 'all').getAttribute('aria-pressed')).toBe('false');
    expect(row(root).getAttribute('aria-label')).toBe('Pairs of 15 kg yellow on hand');
    tile(root, '25').click();
    expect(tile(root, '15').getAttribute('aria-expanded')).toBe('false');
    expect(choice(root, 'all').getAttribute('aria-pressed')).toBe('true');
    tile(root, '25').click();
    expect(row(root).hidden).toBe(true);
  });

  it('a count emits pairschange with the face and pairs; All emits null', () => {
    const { el, root } = mount();
    const seen = spy(el, 'pairschange');
    tile(root, '25').click();
    choice(root, '1').click();
    choice(root, '0').click();
    choice(root, 'all').click();
    expect(seen.mock.calls.map((c) => c[0])).toEqual([
      { face: '25', pairs: 1 },
      { face: '25', pairs: 0 },
      { face: '25', pairs: null },
    ]);
  });

  it('an echoed limit re-syncs in place, keeping the row open and focus on the count', () => {
    const { el, root } = mount();
    tile(root, '25').click();
    choice(root, '1').focus();
    el.platesOnHand = { comp: { '25': 1 } };
    expect(choice(root, '1').getAttribute('aria-pressed')).toBe('true');
    expect(root.activeElement).toBe(choice(root, '1'));
    expect(tile(root, '25').querySelector('.state')!.textContent).toBe('1 pair');
  });

  it('All plates emits pairsreset only while a size is limited', () => {
    const { el, root } = mount();
    const seen = spy(el, 'pairsreset');
    reset(root).click();
    expect(seen).not.toHaveBeenCalled();
    el.platesOnHand = { comp: { '10': 0 } };
    reset(root).click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('closing the sheet or switching sets closes the open row', () => {
    const { el, root } = mount();
    tile(root, '25').click();
    el.close();
    expect(row(root).hidden).toBe(true);
    el.open();
    tile(root, '25').click();
    el.plateSet = 'training';
    expect(row(root).hidden).toBe(true);
    expect(tiles(root)).toHaveLength(6);
  });

  it('opening a row focuses the size\'s current count; Escape or a re-tap closes it back to the tile', () => {
    const { root } = mount({ comp: { '20': 3 } });
    tile(root, '20').click();
    expect(root.activeElement).toBe(choice(root, '3'));
    choice(root, '3').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(row(root).hidden).toBe(true);
    expect(root.activeElement).toBe(tile(root, '20'));
    tile(root, '25').click();
    expect(root.activeElement).toBe(choice(root, 'all'));
    tile(root, '25').click();
    expect(row(root).hidden).toBe(true);
    expect(root.activeElement).toBe(tile(root, '25'));
  });

  it('Escape in the row closes only the row, not the sheet', () => {
    const { el, root } = mount();
    const closed = vi.fn();
    el.addEventListener('close', closed);
    tile(root, '25').click();
    choice(root, 'all').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(closed).not.toHaveBeenCalled();
    expect(el.hidden).toBe(false);
  });

  it('re-assigning the same set keeps an open row open', () => {
    const { el, root } = mount();
    tile(root, '25').click();
    el.plateSet = 'comp';
    expect(row(root).hidden).toBe(false);
  });

  it('All plates has a 44px hit area around its small label', () => {
    const { root } = mount();
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.pairs-reset::after \{ content: ''; position: absolute; inset: -10px -12px; \}/);
  });

  it('the sheet scrolls inside itself rather than growing the page (ADR-0013)', () => {
    const { root } = mount();
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.panel \{[^}]*overflow-y: auto;/);
    expect(css).toMatch(/\.panel \{[^}]*max-height:/);
  });
});
