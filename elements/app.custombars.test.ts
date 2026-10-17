// RBAR-76 (ADR-0017): <rack-app> owns the custom Bars -- persisted under
// `rackbar.customBars` (validated on read, ADR-0007), fed down to Setup, and accepted as
// the chosen Bar (`rackbar.barKg`) on every set. Driven through the real Setup DOM.
import { describe, it, expect, beforeEach } from 'vitest';
import './app.ts';
import { lbToKg } from '../lib/units.ts';

type Con = HTMLElement & { barKg: number; collarKg: number; plateSet: string };
const KEY = 'rackbar.customBars';
const BAR_KEY = 'rackbar.barKg';

function mountApp(): ShadowRoot {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = '';
  const el = document.createElement('rack-app');
  document.body.append(el);
  return el.shadowRoot!;
}
const setupRoot = (root: ShadowRoot) => root.querySelector('rack-setup')!.shadowRoot!;
const con = (root: ShadowRoot) => root.querySelector('rack-console') as Con;
const pill = (root: ShadowRoot) => root.querySelector('[data-pill-label]')!.textContent;
const words = (root: ShadowRoot) =>
  [...setupRoot(root).querySelectorAll('[data-bar] .word')].map((w) => w.textContent);
const pressed = (root: ShadowRoot) =>
  [...setupRoot(root).querySelectorAll<HTMLElement>('[data-bar][aria-pressed="true"]')].map(
    (t) => t.querySelector('.word')!.textContent,
  );
function addBar(root: ShadowRoot, text: string, unit: 'kg' | 'lb'): void {
  const s = setupRoot(root);
  s.querySelector<HTMLButtonElement>('[data-bar-add]')!.click();
  s.querySelector<HTMLButtonElement>(`[data-bar-unit="${unit}"]`)!.click();
  s.querySelector<HTMLInputElement>('[data-bar-input]')!.value = text;
  s.querySelector<HTMLButtonElement>('[data-bar-save]')!.click();
}
const del = (root: ShadowRoot, label: string) =>
  [...setupRoot(root).querySelectorAll<HTMLElement>('[data-custom]')]
    .find((t) => t.querySelector('.word')!.textContent === label)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, composed: true }));
const chooseSet = (root: ShadowRoot, key: string) =>
  setupRoot(root).querySelector<HTMLButtonElement>(`[data-plateset="${key}"]`)!.click();

beforeEach(() => localStorage.clear());

describe('<rack-app> custom Bars (RBAR-76, ADR-0017)', () => {
  it('adding a custom Bar stores the stamp as typed, selects it, and threads its kg to the console', () => {
    const root = mountApp();
    addBar(root, '35', 'lb');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([{ value: 35, unit: 'lb' }]);
    expect(con(root).barKg).toBe(lbToKg(35));
    expect(localStorage.getItem(BAR_KEY)).toBe(String(lbToKg(35)));
    expect(pill(root)).toBe('35 lb bar \u00B7 Comp');
    expect(words(root)).toEqual(['20 kg', '15 kg', '5 kg', '35 lb']);
    expect(pressed(root)).toEqual(['35 lb']);
  });

  it('a custom Bar and its selection survive a reload', () => {
    addBar(mountApp(), '7', 'kg');
    const root = mountApp();
    expect(words(root)).toEqual(['20 kg', '15 kg', '5 kg', '7 kg']);
    expect(con(root).barKg).toBe(7);
    expect(pill(root)).toBe('7 kg bar \u00B7 Comp');
  });

  it('shows custom Bars on every set; a set switch still lands on the set\'s default', () => {
    const root = mountApp();
    addBar(root, '15.9', 'kg');
    chooseSet(root, 'training');
    expect(words(root)).toEqual(['45 lb', '20 kg', '15.9 kg']);
    expect(con(root).barKg).toBe(lbToKg(45));
    setupRoot(root).querySelector<HTMLButtonElement>('[data-bar="15.9"]')!.click();
    expect(con(root).barKg).toBe(15.9);
    expect(pill(root)).toBe('15.9 kg bar \u00B7 Training');
    expect(mountApp() && con(document.querySelector('rack-app')!.shadowRoot!).barKg).toBe(15.9);
  });

  it('adding a weight the set already offers just selects that Bar (nothing stored)', () => {
    const root = mountApp();
    setupRoot(root).querySelector<HTMLButtonElement>('[data-bar="15"]')!.click();
    addBar(root, '20', 'kg');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(con(root).barKg).toBe(20);
    expect(words(root)).toEqual(['20 kg', '15 kg', '5 kg']);
  });

  it('adding a duplicate custom weight selects the existing custom Bar', () => {
    const root = mountApp();
    addBar(root, '35', 'lb');
    setupRoot(root).querySelector<HTMLButtonElement>('[data-bar="20"]')!.click();
    addBar(root, '35.00', 'lb');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    expect(con(root).barKg).toBe(lbToKg(35));
  });

  it('removing the chosen custom Bar falls back to the set\'s default Bar', () => {
    const root = mountApp();
    addBar(root, '35', 'lb');
    del(root, '35 lb');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([]);
    expect(con(root).barKg).toBe(20);
    expect(localStorage.getItem(BAR_KEY)).toBe('20');
    expect(pill(root)).toBe('20 kg bar \u00B7 Comp');
    expect(pressed(root)).toEqual(['20 kg']);
  });

  it('removing a custom Bar that is not chosen keeps the chosen Bar', () => {
    const root = mountApp();
    addBar(root, '35', 'lb');
    setupRoot(root).querySelector<HTMLButtonElement>('[data-bar="15"]')!.click();
    del(root, '35 lb');
    expect(con(root).barKg).toBe(15);
  });

  it('Undo puts the Bar back in place and re-selects it if it was chosen', () => {
    const root = mountApp();
    addBar(root, '35', 'lb');
    addBar(root, '7', 'kg');
    del(root, '35 lb');
    expect(words(root)).toEqual(['20 kg', '15 kg', '5 kg', '7 kg']);
    expect(con(root).barKg).toBe(7);
    setupRoot(root).querySelector<HTMLButtonElement>('[data-bar-undo]')!.click();
    expect(words(root)).toEqual(['20 kg', '15 kg', '5 kg', '35 lb', '7 kg']);
    expect(con(root).barKg).toBe(7); // 35 lb was not chosen: no re-select
    del(root, '7 kg');
    expect(con(root).barKg).toBe(20);
    setupRoot(root).querySelector<HTMLButtonElement>('[data-bar-undo]')!.click();
    expect(con(root).barKg).toBe(7);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([
      { value: 35, unit: 'lb' },
      { value: 7, unit: 'kg' },
    ]);
  });

  it('a corrupt stored list means no custom Bars, and a stored custom Bar choice falls back', () => {
    for (const junk of ['{', 'null', '[{"value":"x"}]', '[{"value":500,"unit":"kg"}]']) {
      localStorage.setItem(KEY, junk);
      localStorage.setItem(BAR_KEY, '500');
      const root = mountApp();
      expect(words(root)).toEqual(['20 kg', '15 kg', '5 kg']);
      expect(con(root).barKg).toBe(20);
    }
  });

  it('ignores a malformed baradd payload', () => {
    const root = mountApp();
    root.querySelector('rack-setup')!.dispatchEvent(
      new CustomEvent('baradd', { detail: { value: 999, unit: 'kg' } }),
    );
    root.querySelector('rack-setup')!.dispatchEvent(new CustomEvent('baradd', { detail: null }));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(con(root).barKg).toBe(20);
  });
});
