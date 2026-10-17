// <rack-ways>, the Another way sheet (RBAR-66): draws the ways it is fed and emits
// intent. The console wiring is in console.ways.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import './ways.ts';
import { ELEIKO_KG, IRON_LB } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

type Ways = HTMLElement & {
  ways: readonly (readonly Plate[])[];
  index: number;
  heading: string;
  open(): void;
  close(): void;
};
const kg = (w: number) => ELEIKO_KG.find((p) => p.kg === w)!;
const lb = (f: string) => IRON_LB.find((p) => p.label === f)!;

function mount(): Ways {
  const el = document.createElement('rack-ways') as Ways;
  document.body.append(el);
  return el;
}
const rows = (el: Ways) => [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-way]')];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('<rack-ways> (RBAR-66)', () => {
  it('is closed until opened, and a scrim tap or Done closes it with a close event', () => {
    const el = mount();
    expect(el.hidden).toBe(true);
    let closed = 0;
    el.addEventListener('close', () => closed++);
    el.open();
    el.shadowRoot!.querySelector<HTMLElement>('[data-panel]')!.click();
    expect(el.hidden).toBe(false); // a tap inside the panel does not dismiss
    el.shadowRoot!.querySelector<HTMLElement>('[data-scrim]')!.click();
    expect(el.hidden).toBe(true);
    el.open();
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-done]')!.click();
    expect(el.hidden).toBe(true);
    expect(closed).toBe(2);
  });

  it('draws each way as colored mini Plates with its count; the selected one is checked', () => {
    const el = mount();
    el.ways = [
      [kg(25), kg(25), kg(10)],
      [kg(20), kg(15), kg(5), kg(0.5)],
    ];
    el.index = 1;
    const [a, b] = rows(el);
    expect(a.getAttribute('role')).toBe('radio');
    expect(a.getAttribute('aria-checked')).toBe('false');
    expect(b.getAttribute('aria-checked')).toBe('true');
    expect(a.getAttribute('aria-label')).toBe('25 kg + 25 kg + 10 kg, 3 per side');
    const chips = [...b.querySelectorAll<HTMLElement>('.mc')];
    expect(chips.map((c) => c.textContent)).toEqual(['20', '15', '5', '.5']);
    expect(chips.map((c) => c.classList.contains('dark'))).toEqual([false, true, true, true]);
    expect(chips[0].getAttribute('style')).toContain('var(--rack-plate-blue)');
    expect(b.querySelector('.count')!.textContent).toBe('4 per side');
  });

  it('names iron Plates by their lb stamp', () => {
    const el = mount();
    el.ways = [[lb('45'), lb('10'), lb('5')]];
    expect(rows(el)[0].getAttribute('aria-label')).toBe('45 lb + 10 lb + 5 lb, 3 per side');
    expect([...rows(el)[0].querySelectorAll('.mc')].map((c) => c.textContent)).toEqual([
      '45', '10', '5',
    ]);
  });

  it('a row tap emits wayselect with its index; moving the selection keeps the focused row', () => {
    const el = mount();
    el.ways = [[kg(25)], [kg(20), kg(5)]];
    const picked: number[] = [];
    el.addEventListener('wayselect', (e) => picked.push((e as CustomEvent).detail.index));
    const row = rows(el)[1];
    row.click();
    expect(picked).toEqual([1]);
    el.index = 1;
    expect(rows(el)[1]).toBe(row); // same node: not re-rendered under the finger
    expect(row.getAttribute('aria-checked')).toBe('true');
  });

  it('Set Plate Inventory emits opensetup and closes the sheet', () => {
    const el = mount();
    el.open();
    let asked = 0;
    el.addEventListener('opensetup', () => asked++);
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-inventory]')!.click();
    expect(asked).toBe(1);
    expect(el.hidden).toBe(true);
  });
});
