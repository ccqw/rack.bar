import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './share.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { loadingSummary } from '../lib/summary.ts';

type Share = HTMLElement & {
  load: LoadSummary;
  plateSet: string;
  open(): void;
  close(): void;
};

const eleiko = (kg: number) => ELEIKO_KG.find((x) => x.kg === kg)!;

const LOADED: LoadSummary = {
  side: [eleiko(25), eleiko(25), eleiko(15), eleiko(2.5)],
  barKg: 20,
  collarKg: 0,
  unit: 'kg',
};

const BARE: LoadSummary = {
  side: [],
  barKg: 20,
  collarKg: 0,
  unit: 'kg',
};

function mount(load: LoadSummary = LOADED): { el: Share; root: ShadowRoot } {
  const el = document.createElement('rack-share') as Share;
  el.load = load;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

describe('<rack-share>', () => {
  it('is hidden until opened, shown on open(), hidden again on close()', () => {
    const { el } = mount();
    expect(el.hidden).toBe(true);
    el.open();
    expect(el.hidden).toBe(false);
    el.close();
    expect(el.hidden).toBe(true);
  });

  it('derives + shows the Total in the display Unit and the secondary in the other', () => {
    // 20 Bar + 2 x (25 + 15) = 100 kg, derived from the rig + Side Load (not stored).
    const { el, root } = mount({
      side: [eleiko(25), eleiko(15)],
      barKg: 20,
      collarKg: 0,
      unit: 'lb',
    });
    el.open();
    expect(root.querySelector('[data-total]')!.textContent!.trim()).toBe('220 lb');
    expect(root.querySelector('[data-secondary]')!.textContent!.trim()).toBe('100 kg');
  });

  it('renders one colour chip per Side group, count always shown (RBAR-44)', () => {
    const { el, root } = mount();
    el.open();
    const chips = [...root.querySelectorAll('[data-chip]')].map((c) =>
      c.textContent!.trim(),
    );
    // Prototype L888: singles read '1x 15', never a bare face.
    expect(chips).toEqual(['2x 25', '1x 15', '1x 2.5']);
    // chips carry the plate colour for the fill
    const first = root.querySelector('[data-chip]') as HTMLElement;
    expect(first.dataset.color).toBe('red');
  });

  it('shows the bare-bar state instead of chips when the Side is empty', () => {
    const { el, root } = mount(BARE);
    el.open();
    expect(root.querySelectorAll('[data-chip]')).toHaveLength(0);
    expect(root.querySelector('[data-bare]')!.textContent).toContain('Bare bar');
  });

  it('captions the dual-unit Bar + set name + per side, Collars only when fitted', () => {
    const none = mount(LOADED);
    none.el.open();
    // Prototype L891 + L304: '{kg} kg / {lb} lb bar - {setName} - per side'.
    const cap = none.root.querySelector('[data-caption]')!.textContent!;
    expect(cap).toContain('20 kg / 44 lb bar');
    expect(cap).toContain('Competition');
    expect(cap).toContain('per side');
    expect(cap).not.toContain('collar');

    const withCollar = mount({ ...LOADED, collarKg: 2.5 });
    withCollar.el.open();
    expect(withCollar.root.querySelector('[data-caption]')!.textContent).toContain(
      'collars 2.5 kg',
    );
  });

  it('captions the active plate set (Training reads its name + iron Bar)', () => {
    const { el, root } = mount();
    el.plateSet = 'training';
    el.open();
    const cap = root.querySelector('[data-caption]')!.textContent!;
    expect(cap).toContain('Training');
    expect(cap).toContain('lb bar');
  });

  it('Copy writes the plain-text summary to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { el, root } = mount();
    el.open();
    const copy = root.querySelector('[data-copy]') as HTMLButtonElement;
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    // The copied text carries the same set name the caption shows (ADR-0011 no-drift).
    expect(writeText).toHaveBeenCalledWith(loadingSummary(LOADED, 'Competition'));
    expect(copy.textContent).toContain('Copied');
    vi.unstubAllGlobals();
  });

  it('does not falsely claim a copy when the clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { el, root } = mount();
    el.open();
    const copy = root.querySelector('[data-copy]') as HTMLButtonElement;
    const before = copy.textContent;
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(copy.textContent).toBe(before);
    expect(copy.textContent).not.toContain('Copied');
    vi.unstubAllGlobals();
  });

  it('the Close button dismisses and emits close', () => {
    const { el, root } = mount();
    el.open();
    const seen = vi.fn();
    el.addEventListener('close', seen);
    (root.querySelector('[data-close]') as HTMLButtonElement).click();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(el.hidden).toBe(true);
  });

  it('a scrim tap dismisses; a tap inside the card does not', () => {
    const { el, root } = mount();
    el.open();
    (root.querySelector('[data-card]') as HTMLElement).click();
    expect(el.hidden).toBe(false); // inside the card: stays open
    (root.querySelector('[data-scrim]') as HTMLElement).click();
    expect(el.hidden).toBe(true); // the scrim: closes
  });

  it('a clipboard write that resolves after close does not re-label the hidden card', async () => {
    // A real ordering on a slow/permission-prompted clipboard: copy, then close before
    // the write settles. The late confirm must not flip a closed card to "Copied".
    let resolveWrite!: () => void;
    const writeText = vi.fn(() => new Promise<void>((r) => (resolveWrite = r)));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { el, root } = mount();
    el.open();
    const copy = root.querySelector('[data-copy]') as HTMLButtonElement;
    copy.click(); // write is in flight
    el.close(); // lifter dismisses before it settles
    resolveWrite(); // now the write resolves
    await Promise.resolve();
    await Promise.resolve();
    expect(copy.textContent).toBe('Copy summary'); // not "Copied"
    expect(el.hidden).toBe(true);
    vi.unstubAllGlobals();
  });

  describe('the Copied confirmation reverts', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('flips back to the Copy label after a short delay', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const { el, root } = mount();
      el.open();
      const copy = root.querySelector('[data-copy]') as HTMLButtonElement;
      const label = copy.textContent;
      copy.click();
      await vi.advanceTimersByTimeAsync(0); // let the write resolve
      expect(copy.textContent).toContain('Copied');
      await vi.advanceTimersByTimeAsync(1600);
      expect(copy.textContent).toBe(label);
      vi.unstubAllGlobals();
    });
  });
});

describe('<rack-share> (card fidelity, RBAR-44)', () => {
  // Prototype L286-308. happy-dom computes no layout, so text-lock the rule bodies
  // (the RBAR-39/RBAR-42 idiom); the rendered check is the browser pass.
  function rule(root: ShadowRoot, selector: string): string {
    const css = root.querySelector('style')!.textContent!;
    const start = css.indexOf(selector);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('puts the wordmark and the Loading-card label in one space-between header row', () => {
    const { root } = mount();
    const head = root.querySelector('[data-head]')!;
    expect(head.querySelector('.wordmark')).not.toBeNull();
    expect(head.querySelector('.label')!.textContent).toBe('Loading card');
    const headRule = rule(root, '.head {');
    expect(headRule).toContain('display: flex');
    expect(headRule).toContain('justify-content: space-between');
  });

  it('lays Copy and Close out as one action row: Copy grows, Close does not', () => {
    const { root } = mount();
    const actions = rule(root, '.actions {');
    expect(actions).toContain('display: flex');
    expect(actions).toContain('gap: 9px');
    expect(actions).not.toContain('column');
    expect(rule(root, '.copy {')).toContain('flex: 1');
    expect(rule(root, '.close {')).toContain('flex: none');
  });

  it('gives both action buttons the 13px radius, 12px pad, and a 44px touch floor', () => {
    const { root } = mount();
    for (const sel of ['.copy {', '.close {']) {
      const r = rule(root, sel);
      expect(r).toContain('border-radius: 13px');
      expect(r).toContain('padding: 12px');
      expect(r).toContain('min-height: 44px');
    }
    // Copy is the accent action; Close is the quiet outline.
    expect(rule(root, '.copy {')).toContain('var(--rack-accent)');
    expect(rule(root, '.close {')).toContain('var(--rack-border-strong)');
  });

  it('sets the secondary line in Hanken 500 13px, not mono (prototype L292)', () => {
    const { root } = mount();
    const sec = rule(root, '.secondary {');
    expect(sec).toContain('var(--rack-font)');
    expect(sec).not.toContain('var(--rack-font-num)');
    expect(sec).toContain('font-size: 13px');
  });

  it('sets the caption in mono 600 11px .06em (prototype L304)', () => {
    const { root } = mount();
    const cap = rule(root, '.caption {');
    expect(cap).toContain('var(--rack-font-num)');
    expect(cap).toContain('font-size: 11px');
    expect(cap).toContain('font-weight: 600');
    expect(cap).toContain('letter-spacing: .06em');
  });
});

describe('<rack-share> (numeric typography, RBAR-39)', () => {
  // Prototype L291: the share total is Hanken 800 52px -.03em tnum with an 18px/700
  // text-dim unit suffix. happy-dom computes no layout, so text-lock the rule bodies;
  // the rendered check is the browser pass.
  function rule(root: ShadowRoot, selector: string): string {
    const css = root.querySelector('style')!.textContent!;
    const start = css.indexOf(selector);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('sets the card total in Hanken 800 52px -.03em with tabular figures', () => {
    const { root } = mount();
    const total = rule(root, '.total {');
    expect(total).toContain('var(--rack-font)');
    expect(total).not.toContain('var(--rack-font-num)');
    expect(total).toContain('font-weight: 800');
    expect(total).toContain('font-size: 52px');
    expect(total).toContain('letter-spacing: -.03em');
    expect(total).toContain('tabular-nums');
  });

  it('splits the total into a value and a small dim unit suffix (18px/700)', () => {
    const { el, root } = mount();
    el.open();
    // LOADED: 20 Bar + 2 x (25+25+15+2.5) = 155 kg
    expect(root.querySelector('[data-total-num]')!.textContent).toBe('155');
    expect(root.querySelector('[data-total-unit]')!.textContent).toBe(' kg');
    const tu = rule(root, '.total .tu');
    expect(tu).toContain('font-size: 18px');
    expect(tu).toContain('font-weight: 700');
    expect(tu).toContain('var(--rack-text-dim)');
  });

  it('renders the suffix in the display Unit (lb load reads " lb")', () => {
    const { el, root } = mount({ ...LOADED, unit: 'lb' });
    el.open();
    expect(root.querySelector('[data-total-unit]')!.textContent).toBe(' lb');
  });
});
