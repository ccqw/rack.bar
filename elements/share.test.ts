import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './share.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { loadingSummary } from '../lib/summary.ts';

type Share = HTMLElement & {
  load: LoadSummary;
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

  it('renders one colour chip per Side group, as N x face', () => {
    const { el, root } = mount();
    el.open();
    const chips = [...root.querySelectorAll('[data-chip]')].map((c) =>
      c.textContent!.trim(),
    );
    expect(chips).toEqual(['2x 25', '15', '2.5']);
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

  it('captions the rig config, naming Collars only when fitted', () => {
    const none = mount(LOADED);
    none.el.open();
    expect(none.root.querySelector('[data-caption]')!.textContent).toContain('20 kg');
    expect(none.root.querySelector('[data-caption]')!.textContent).not.toContain('collar');

    const withCollar = mount({ ...LOADED, collarKg: 2.5 });
    withCollar.el.open();
    expect(withCollar.root.querySelector('[data-caption]')!.textContent).toContain(
      'collars 2.5 kg',
    );
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
    expect(writeText).toHaveBeenCalledWith(loadingSummary(LOADED));
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
