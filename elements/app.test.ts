import { describe, it, expect, beforeEach } from 'vitest';
import './app.ts';

type WithBar = HTMLElement & { barKg: number };

function mountApp(): { el: HTMLElement; root: ShadowRoot } {
  const el = document.createElement('rack-app');
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

function pill(root: ShadowRoot): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('[data-setup-pill]')!;
}
function setup(root: ShadowRoot): HTMLElement & { barKg: number; hidden: boolean } {
  return root.querySelector('rack-setup')!;
}
function consoleEl(root: ShadowRoot): WithBar {
  return root.querySelector('rack-console') as WithBar;
}
// Tap a Bar tile through the real sheet DOM, the path a lifter takes.
function chooseBar(root: ShadowRoot, kg: number): void {
  setup(root)
    .shadowRoot!.querySelector<HTMLButtonElement>(`[data-bar="${kg}"]`)!
    .click();
}

const KEY = 'rackbar.barKg';

describe('<rack-app> (app shell + Setup wiring, RBAR-15)', () => {
  beforeEach(() => localStorage.clear());

  it('renders the wordmark and a Setup pill defaulting to the 20 kg Bar', () => {
    const { root } = mountApp();
    expect(root.textContent).toContain('rack.bar');
    expect(pill(root).textContent).toContain('20');
    expect(pill(root).textContent!.toLowerCase()).toContain('bar');
  });

  it('opens the Setup sheet from the pill, reflecting the open state', () => {
    const { root } = mountApp();
    expect(setup(root).hidden).toBe(true);
    expect(pill(root).getAttribute('aria-expanded')).toBe('false');
    pill(root).click();
    expect(setup(root).hidden).toBe(false);
    expect(pill(root).getAttribute('aria-expanded')).toBe('true');
  });

  it('choosing a Bar updates the pill, the console, and persists to localStorage', () => {
    const { root } = mountApp();
    pill(root).click();
    chooseBar(root, 15);
    expect(pill(root).textContent).toContain('15');
    expect(consoleEl(root).barKg).toBe(15);
    expect(localStorage.getItem(KEY)).toBe('15');
  });

  it('restores the persisted Bar on init (pill, console, and active tile)', () => {
    localStorage.setItem(KEY, '15');
    const { root } = mountApp();
    expect(pill(root).textContent).toContain('15');
    expect(consoleEl(root).barKg).toBe(15);
    expect(setup(root).barKg).toBe(15);
  });

  it('falls back to the 20 kg default when nothing is persisted', () => {
    const { root } = mountApp();
    expect(consoleEl(root).barKg).toBe(20);
  });

  it('falls back to the 20 kg default when the persisted value is garbage', () => {
    localStorage.setItem(KEY, 'not-a-number');
    const { root } = mountApp();
    expect(consoleEl(root).barKg).toBe(20);
  });

  it('drops the pill open state when the sheet closes itself', () => {
    const { root } = mountApp();
    pill(root).click();
    expect(pill(root).getAttribute('aria-expanded')).toBe('true');
    setup(root).shadowRoot!.querySelector<HTMLButtonElement>('[data-done]')!.click();
    expect(pill(root).getAttribute('aria-expanded')).toBe('false');
  });
});
