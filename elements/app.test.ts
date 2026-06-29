import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './app.ts';
import { lbToKg } from '../lib/units.ts';

type WithBar = HTMLElement & { barKg: number; collarKg: number; plateSet: string };

function mountApp(): { el: HTMLElement; root: ShadowRoot } {
  const el = document.createElement('rack-app');
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

function pill(root: ShadowRoot): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('[data-setup-pill]')!;
}
function setup(
  root: ShadowRoot,
): HTMLElement & {
  barKg: number;
  collarKg: number;
  plateSet: string;
  hidden: boolean;
} {
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
// Tap a Collar tile through the real sheet DOM (RBAR-16).
function chooseCollar(root: ShadowRoot, kg: number): void {
  setup(root)
    .shadowRoot!.querySelector<HTMLButtonElement>(`[data-collar="${kg}"]`)!
    .click();
}
// The Collars whose tile currently reads as the active selection.
function pressedCollars(root: ShadowRoot): number[] {
  return [...setup(root).shadowRoot!.querySelectorAll<HTMLElement>('[data-collar]')]
    .filter((t) => t.getAttribute('aria-pressed') === 'true')
    .map((t) => Number(t.dataset.collar));
}
// The Bars whose tile currently reads as the active selection.
function pressedBars(root: ShadowRoot): number[] {
  return [...setup(root).shadowRoot!.querySelectorAll<HTMLElement>('[data-bar]')]
    .filter((t) => t.getAttribute('aria-pressed') === 'true')
    .map((t) => Number(t.dataset.bar));
}

const KEY = 'rackbar.barKg';
const COLLAR_KEY = 'rackbar.collarKg';

describe('<rack-app> (app shell + Setup wiring, RBAR-15)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

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

  it('falls back to 20 with a coherent active tile when the persisted Bar is off-menu', () => {
    // A finite, positive, but not-offered value (a hand-edited or legacy key) must not
    // load a Bar that no tile matches -- it would strand the lifter with no selection.
    for (const offMenu of ['10', '7.5']) {
      localStorage.setItem(KEY, offMenu);
      const { root } = mountApp();
      expect(consoleEl(root).barKg).toBe(20);
      expect(pill(root).textContent).toContain('20');
      expect(pressedBars(root)).toEqual([20]); // exactly one tile, the default
    }
  });

  it('ignores an off-menu barchange payload, keeping the last good Bar', () => {
    const { root } = mountApp();
    // A rogue / forward-compat event carrying a Bar no tile offers must not poison the
    // readout or storage.
    setup(root).dispatchEvent(
      new CustomEvent('barchange', {
        detail: { barKg: 10 },
        bubbles: true,
        composed: true,
      }),
    );
    expect(consoleEl(root).barKg).toBe(20);
    expect(pill(root).textContent).toContain('20');
    expect(pressedBars(root)).toEqual([20]);
    expect(localStorage.getItem(KEY)).toBeNull(); // never persisted
  });

  it('keeps the Setup sheet open after choosing a Bar', () => {
    const { root } = mountApp();
    pill(root).click();
    chooseBar(root, 15);
    expect(setup(root).hidden).toBe(false); // the lifter sees the choice land
  });

  it('survives a thrown localStorage read, falling back to the default', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });
    const { root } = mountApp();
    expect(consoleEl(root).barKg).toBe(20); // best-effort: no throw escapes init
  });

  it('keeps Setup working when a localStorage write throws (best-effort persistence)', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });
    const { root } = mountApp();
    pill(root).click();
    chooseBar(root, 15);
    expect(consoleEl(root).barKg).toBe(15); // the choice still applies this session
    expect(pill(root).textContent).toContain('15');
  });

  it('drops the pill open state when the sheet closes itself', () => {
    const { root } = mountApp();
    pill(root).click();
    expect(pill(root).getAttribute('aria-expanded')).toBe('true');
    setup(root).shadowRoot!.querySelector<HTMLButtonElement>('[data-done]')!.click();
    expect(pill(root).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('<rack-app> Collars wiring (RBAR-16, ADR-0008)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults to None (0 kg) collars, threaded to the console and sheet', () => {
    const { root } = mountApp();
    expect(consoleEl(root).collarKg).toBe(0);
    expect(setup(root).collarKg).toBe(0);
  });

  it('choosing a Collar threads it to the console and persists it', () => {
    const { root } = mountApp();
    pill(root).click();
    chooseCollar(root, 2.5);
    expect(consoleEl(root).collarKg).toBe(2.5);
    expect(localStorage.getItem(COLLAR_KEY)).toBe('2.5');
  });

  it('restores the persisted Collar on init (console and active tile)', () => {
    localStorage.setItem(COLLAR_KEY, '2.5');
    const { root } = mountApp();
    expect(consoleEl(root).collarKg).toBe(2.5);
    expect(setup(root).collarKg).toBe(2.5);
    expect(pressedCollars(root)).toEqual([2.5]);
  });

  it('falls back to None when the persisted Collar is off-menu', () => {
    // A hand-edited or legacy key carrying an unoffered collar must not strand the
    // rig on a Collar no tile matches -- it falls back to the default None.
    for (const offMenu of ['5', 'not-a-number']) {
      localStorage.setItem(COLLAR_KEY, offMenu);
      const { root } = mountApp();
      expect(consoleEl(root).collarKg).toBe(0);
      expect(pressedCollars(root)).toEqual([0]);
    }
  });

  it('ignores an off-menu collarchange payload, keeping None and not persisting', () => {
    const { root } = mountApp();
    setup(root).dispatchEvent(
      new CustomEvent('collarchange', {
        detail: { collarKg: 5 },
        bubbles: true,
        composed: true,
      }),
    );
    expect(consoleEl(root).collarKg).toBe(0);
    expect(pressedCollars(root)).toEqual([0]);
    expect(localStorage.getItem(COLLAR_KEY)).toBeNull();
  });

  it('keeps the Bar and Collar choices independent', () => {
    const { root } = mountApp();
    pill(root).click();
    chooseBar(root, 15);
    chooseCollar(root, 2.5);
    expect(consoleEl(root).barKg).toBe(15);
    expect(consoleEl(root).collarKg).toBe(2.5);
    expect(localStorage.getItem(KEY)).toBe('15');
    expect(localStorage.getItem(COLLAR_KEY)).toBe('2.5');
  });
});

describe('<rack-app> plate-set wiring (RBAR-17, ADR-0010)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const PLATESET_KEY = 'rackbar.plateSet';

  function choosePlateset(root: ShadowRoot, key: string): void {
    setup(root)
      .shadowRoot!.querySelector<HTMLButtonElement>(`[data-plateset="${key}"]`)!
      .click();
  }

  it('defaults to Competition, threaded to the console and sheet', () => {
    const { root } = mountApp();
    expect(consoleEl(root).plateSet).toBe('comp');
    expect(setup(root).plateSet).toBe('comp');
  });

  it('choosing Training swaps the Bar to 45 lb, threads the set, and persists both', () => {
    const { root } = mountApp();
    pill(root).click();
    choosePlateset(root, 'training');
    expect(consoleEl(root).plateSet).toBe('training');
    expect(consoleEl(root).barKg).toBe(lbToKg(45)); // the set's default Bar
    expect(pill(root).textContent).toContain('45'); // "45 lb bar"
    expect(localStorage.getItem(PLATESET_KEY)).toBe('training');
    expect(localStorage.getItem(KEY)).toBe(String(lbToKg(45)));
  });

  it('restores a persisted Training set on init (set + its default Bar)', () => {
    localStorage.setItem(PLATESET_KEY, 'training');
    localStorage.setItem(KEY, String(lbToKg(45)));
    const { root } = mountApp();
    expect(consoleEl(root).plateSet).toBe('training');
    expect(consoleEl(root).barKg).toBe(lbToKg(45));
    expect(pill(root).textContent).toContain('45');
  });

  it('falls back to Competition when the persisted plate set is off-menu', () => {
    localStorage.setItem(PLATESET_KEY, 'bogus');
    const { root } = mountApp();
    expect(consoleEl(root).plateSet).toBe('comp');
    expect(consoleEl(root).barKg).toBe(20);
  });

  it('keeps a switched-back Competition Bar valid (off-set kg Bar rejected on Training)', () => {
    // A persisted 15 kg Bar is valid only on Competition; if the set is Training it must
    // not load (an iron rig has no 15 kg bar), falling back to the Training default.
    localStorage.setItem(PLATESET_KEY, 'training');
    localStorage.setItem(KEY, '15');
    const { root } = mountApp();
    expect(consoleEl(root).barKg).toBe(lbToKg(45)); // 15 kg is off-menu for Training
  });
});
