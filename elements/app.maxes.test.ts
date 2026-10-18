// Saved maxes through the whole app (RBAR-84, ADR-0020): the lift row in the keypad, the
// Maxes sheet behind its two doors (Setup's Maxes row, the keypad's "+" / long-press),
// persistence under rackbar.maxes, and the "80% Squat" chip.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import './app.ts';
import { MAXES_KEY } from './maxes.ts';

const FOUR = [
  { name: 'Squat', value: 140, unit: 'kg' },
  { name: 'Bench', value: 85, unit: 'kg' },
  { name: 'Deadlift', value: 170, unit: 'kg' },
  { name: 'Press', value: 55, unit: 'kg' },
];

function mountApp(maxes: unknown[] | null = FOUR): ShadowRoot {
  localStorage.clear();
  if (maxes) localStorage.setItem(MAXES_KEY, JSON.stringify(maxes));
  document.body.innerHTML = '';
  const el = document.createElement('rack-app');
  document.body.append(el);
  return el.shadowRoot!;
}
const con = (r: ShadowRoot) => r.querySelector('rack-console')!.shadowRoot!;
const entry = (r: ShadowRoot) => con(r).querySelector('rack-entry:not([data-working])')!.shadowRoot!;
const sheet = (r: ShadowRoot) => r.querySelector('rack-maxes') as HTMLElement;
const sheetRoot = (r: ShadowRoot) => sheet(r).shadowRoot!;
const setupRoot = (r: ShadowRoot) => r.querySelector('rack-setup')!.shadowRoot!;
const click = (root: ShadowRoot, sel: string) => root.querySelector<HTMLElement>(sel)!.click();
const key = (r: ShadowRoot, k: string) => click(entry(r), `[data-key="${k}"]`);
const liftNames = (r: ShadowRoot) =>
  [...entry(r).querySelectorAll<HTMLElement>('[data-lift]')].map((b) => b.dataset.lift);
const chip = (r: ShadowRoot) => {
  const a = con(r).querySelector<HTMLElement>('[data-asked]')!;
  return a.hidden ? null : a.textContent!.replace(/\s+/g, ' ').trim();
};
const stored = () => JSON.parse(localStorage.getItem(MAXES_KEY) ?? 'null');

function openPad(r: ShadowRoot): void {
  click(con(r), '[data-total-tap]');
}
function typeKeys(root: ShadowRoot, keys: string): void {
  for (const k of keys) click(root, `[data-key="${k}"]`);
}

beforeEach(() => vi.useRealTimers());

describe('saved maxes (RBAR-84)', () => {
  it('the keypad shows a chip per saved max, then "+", and the first run offers "+ Add a lift"', () => {
    const r = mountApp();
    openPad(r);
    expect(liftNames(r)).toEqual(['Squat', 'Bench', 'Deadlift', 'Press']);
    expect(entry(r).querySelector('[data-lift-add]')!.getAttribute('aria-label')).toBe('Add a lift');
    const fresh = mountApp(null);
    openPad(fresh);
    expect(liftNames(fresh)).toEqual([]);
    expect(entry(fresh).querySelector('[data-lift-add]')!.textContent).toContain('Add a lift');
  });

  it('80% Squat makes a 112 kg Target, read "Squat 140 = 112 kg" in the keypad and as a quiet chip', () => {
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Squat"]');
    key(r, '8');
    key(r, '0');
    expect(entry(r).querySelector('[data-live]')!.textContent).toBe('80');
    expect(entry(r).querySelector('[data-live-u]')!.textContent).toBe('%');
    expect(entry(r).querySelector('[data-live-sec]')!.textContent).toBe('Squat 140 = 112 kg');
    click(entry(r), '[data-done]');
    expect(chip(r)).toBe('80% Squat');
    expect(con(r).querySelector('[data-asked]')!.classList.contains('exact')).toBe(true);
    // The Target joins Recents at its exact kg.
    expect(JSON.parse(localStorage.getItem('rackbar.recents')!)).toEqual([112]);
  });

  it('a miss turns the chip dashed and names the Target: "82.5% Squat = 115.5 kg"', () => {
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Squat"]');
    typeKeys(entry(r), '82.5');
    click(entry(r), '[data-done]');
    expect(chip(r)).toBe('82.5% Squat = 115.5 kg');
    expect(con(r).querySelector('[data-asked]')!.classList.contains('exact')).toBe(false);
  });

  it('a percent the keypad does not take (0, past 150) leaves the Target as it was', () => {
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Squat"]');
    typeKeys(entry(r), '80');
    typeKeys(entry(r), '0'); // 800%
    expect(entry(r).querySelector('[data-live-sec]')!.textContent).toBe('Squat 140 = ...');
    click(entry(r), '[data-done]');
    expect(chip(r)).toBe('80% Squat');
  });

  it('tapping another lift moves the same percent onto it; tapping the picked lift types a weight again', () => {
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Squat"]');
    typeKeys(entry(r), '80');
    click(entry(r), '[data-lift="Deadlift"]');
    expect(entry(r).querySelector('[data-live-sec]')!.textContent).toBe('Deadlift 170 = 136 kg');
    click(entry(r), '[data-lift="Deadlift"]');
    expect(entry(r).querySelector('[data-live-u]')!.textContent).toBe('kg');
    typeKeys(entry(r), '100');
    click(entry(r), '[data-done]');
    expect(chip(r)).toBeNull(); // a typed weight: no link, exact, no chip
  });

  it('Setup has a Maxes row summing them up, and it opens the Maxes sheet on its list', () => {
    const r = mountApp();
    click(r, '[data-setup-pill]');
    expect(setupRoot(r).querySelector('[data-maxes-sum]')!.textContent).toBe(
      'Squat 140 \u00B7 Bench 85 \u00B7 Deadlift 170 \u00B7 Press 55',
    );
    click(setupRoot(r), '[data-maxes-row]');
    expect(sheet(r).hidden).toBe(false);
    const rows = [...sheetRoot(r).querySelectorAll('[data-act="edit"] .n')].map((n) => n.textContent);
    expect(rows).toEqual(['Squat', 'Bench', 'Deadlift', 'Press']);
    expect(sheetRoot(r).querySelector('[data-act="add"]')).not.toBeNull();
  });

  it('a new PR from Setup retypes the max, persists it, and a linked Target follows it', () => {
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Squat"]');
    typeKeys(entry(r), '80');
    click(entry(r), '[data-done]');
    click(r, '[data-setup-pill]');
    click(setupRoot(r), '[data-maxes-row]');
    click(sheetRoot(r), '[data-act="edit"][data-i="0"]');
    typeKeys(sheetRoot(r), '145');
    click(sheetRoot(r), '[data-act="save"]');
    expect(stored()[0]).toEqual({ name: 'Squat', value: 145, unit: 'kg' });
    // Back on the list, Setup's summary follows.
    expect(sheetRoot(r).querySelector('[data-act="done"]')).not.toBeNull();
    expect(setupRoot(r).querySelector('[data-maxes-sum]')!.textContent).toContain('Squat 145');
    // 80% of 145 = 116 kg, exact.
    expect(chip(r)).toBe('80% Squat');
    expect(con(r).querySelector('[data-total-num]')!.textContent).toBe('116');
  });

  it('"+" in the keypad opens the add form; Save stores the lift and returns with it picked', () => {
    const r = mountApp([{ name: 'Squat', value: 140, unit: 'kg' }]);
    openPad(r);
    click(entry(r), '[data-lift-add]');
    expect(sheet(r).hidden).toBe(false);
    const save = sheetRoot(r).querySelector<HTMLButtonElement>('[data-save]')!;
    expect(save.disabled).toBe(true);
    // Squat is saved already, so it is not offered again.
    const names = [...sheetRoot(r).querySelectorAll<HTMLElement>('[data-act="name"]')].map((b) => b.dataset.n);
    expect(names).toEqual(['Bench', 'Deadlift', 'Press']);
    click(sheetRoot(r), '[data-act="name"][data-n="Bench"]');
    typeKeys(sheetRoot(r), '85');
    expect(sheetRoot(r).querySelector<HTMLButtonElement>('[data-save]')!.disabled).toBe(false);
    click(sheetRoot(r), '[data-act="save"]');
    expect(sheet(r).hidden).toBe(true);
    expect(stored()).toEqual([
      { name: 'Squat', value: 140, unit: 'kg' },
      { name: 'Bench', value: 85, unit: 'kg' },
    ]);
    expect(entry(r).querySelector('[data-lift="Bench"]')!.getAttribute('aria-pressed')).toBe('true');
    key(r, '5');
    key(r, '0');
    expect(entry(r).querySelector('[data-live-sec]')!.textContent).toBe('Bench 85 = 42.5 kg');
  });

  it('a Custom name is typed; a max keeps the Unit it was typed in', () => {
    const r = mountApp([]);
    click(con(r), '[data-unit="lb"]');
    openPad(r);
    click(entry(r), '[data-lift-add]');
    click(sheetRoot(r), '[data-act="custom"]');
    const input = sheetRoot(r).querySelector<HTMLInputElement>('[data-name]')!;
    input.value = 'Front squat';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    typeKeys(sheetRoot(r), '225');
    click(sheetRoot(r), '[data-act="save"]');
    expect(stored()).toEqual([{ name: 'Front squat', value: 225, unit: 'lb' }]);
    click(con(r), '[data-unit="kg"]');
    expect(entry(r).querySelector('[data-lift="Front squat"] b')!.textContent).toBe('102.1');
  });

  it('a long-press on a lift opens its edit form; Remove keeps the Target, drops the link, and Undo restores both', async () => {
    vi.useFakeTimers();
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Press"]');
    typeKeys(entry(r), '100');
    const press = entry(r).querySelector<HTMLElement>('[data-lift="Press"]')!;
    press.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(600);
    expect(sheet(r).hidden).toBe(false);
    click(sheetRoot(r), '[data-act="remove"]');
    expect(sheet(r).hidden).toBe(true);
    expect(stored().map((m: { name: string }) => m.name)).toEqual(['Squat', 'Bench', 'Deadlift']);
    // The keypad is back to typing a weight: the percent readout went with the lift.
    expect(entry(r).querySelector('[data-live-u]')!.textContent).toBe('kg');
    expect(entry(r).querySelector('[data-live]')!.textContent).toBe('55');
    // Undo sits in the removed chip's slot, inside the open keypad.
    expect(entry(r).querySelector('[data-lift-undo]')!.textContent).toContain('Press');
    click(entry(r), '[data-done]');
    expect(chip(r)).toBeNull(); // the link is gone; 55 kg is still the Target, exact
    expect(con(r).querySelector('[data-total-num]')!.textContent).toBe('55');
    openPad(r);
    expect(entry(r).querySelector('[data-lift-undo]')).toBeNull(); // closed = final
    vi.useRealTimers();
  });

  it('Undo in the keypad puts the lift back in its slot and relinks the Target', async () => {
    vi.useFakeTimers();
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Bench"]');
    typeKeys(entry(r), '50');
    entry(r)
      .querySelector('[data-lift="Bench"]')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    click(sheetRoot(r), '[data-act="remove"]');
    click(entry(r), '[data-lift-undo]');
    expect(liftNames(r)).toEqual(['Squat', 'Bench', 'Deadlift', 'Press']);
    expect(stored()[1]).toEqual({ name: 'Bench', value: 85, unit: 'kg' });
    click(entry(r), '[data-done]');
    expect(chip(r)).toBe('50% Bench = 42.5 kg');
    vi.useRealTimers();
  });

  it('removing from Setup leaves an Undo row in the list until the sheet closes', () => {
    const r = mountApp();
    click(r, '[data-setup-pill]');
    click(setupRoot(r), '[data-maxes-row]');
    click(sheetRoot(r), '[data-act="edit"][data-i="3"]');
    click(sheetRoot(r), '[data-act="remove"]');
    expect(sheetRoot(r).querySelector('.row.gone')!.textContent).toContain('Press');
    click(sheetRoot(r), '[data-act="undo"]');
    expect(stored()).toEqual(FOUR);
    click(sheetRoot(r), '[data-act="done"]');
    expect(sheet(r).hidden).toBe(true);
  });

  it('removing the linked lift from Setup drops the chip at once; its Undo brings it back; a later re-add does not', () => {
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Squat"]');
    typeKeys(entry(r), '80');
    click(entry(r), '[data-done]');
    click(r, '[data-setup-pill]');
    click(setupRoot(r), '[data-maxes-row]');
    click(sheetRoot(r), '[data-act="edit"][data-i="0"]');
    click(sheetRoot(r), '[data-act="remove"]');
    expect(chip(r)).toBeNull();
    click(sheetRoot(r), '[data-act="undo"]');
    expect(chip(r)).toBe('80% Squat');
    // Remove it for good, then add a new Squat: a new max, so the Target stays put.
    click(sheetRoot(r), '[data-act="edit"][data-i="0"]');
    click(sheetRoot(r), '[data-act="remove"]');
    click(sheetRoot(r), '[data-act="done"]');
    click(setupRoot(r), '[data-maxes-row]');
    click(sheetRoot(r), '[data-act="add"]');
    click(sheetRoot(r), '[data-act="name"][data-n="Squat"]');
    typeKeys(sheetRoot(r), '150');
    click(sheetRoot(r), '[data-act="save"]');
    expect(chip(r)).toBeNull();
    expect(con(r).querySelector('[data-total-num]')!.textContent).toBe('112');
  });

  it('at six lifts there is no add control, in the keypad or the sheet', () => {
    const six = [...FOUR, { name: 'Clean', value: 100, unit: 'kg' }, { name: 'Snatch', value: 80, unit: 'kg' }];
    const r = mountApp(six);
    openPad(r);
    expect(liftNames(r)).toHaveLength(6);
    expect(entry(r).querySelector('[data-lift-add]')).toBeNull();
    click(r, '[data-setup-pill]');
    click(setupRoot(r), '[data-maxes-row]');
    expect(sheetRoot(r).querySelector('[data-act="add"]')).toBeNull();
  });

  it('picking a lift keeps keyboard focus on its chip, though the row is rebuilt', () => {
    const r = mountApp();
    openPad(r);
    const squat = entry(r).querySelector<HTMLElement>('[data-lift="Squat"]')!;
    squat.focus();
    squat.click();
    const now = entry(r).activeElement as HTMLElement;
    expect(now.dataset.lift).toBe('Squat');
    expect(now.getAttribute('aria-pressed')).toBe('true');
  });

  it('a stepper nudge drops the link', () => {
    const r = mountApp();
    openPad(r);
    click(entry(r), '[data-lift="Squat"]');
    typeKeys(entry(r), '80');
    click(entry(r), '[data-done]');
    click(con(r), '[data-hero-step="inc"]');
    expect(chip(r)).toBeNull();
  });
});
