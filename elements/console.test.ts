import { describe, it, expect } from 'vitest';
import './console.ts';

function mountConsole(): HTMLElement {
  const el = document.createElement('rack-console');
  document.body.append(el);
  return el;
}

function type(el: HTMLElement, value: string): void {
  const input = el
    .shadowRoot!.querySelector('rack-entry')!
    .shadowRoot!.querySelector('input')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function discs(el: HTMLElement): HTMLElement[] {
  return [
    ...el
      .shadowRoot!.querySelector('rack-sleeve')!
      .shadowRoot!.querySelectorAll<HTMLElement>('.disc'),
  ];
}

function total(el: HTMLElement): string {
  return el.shadowRoot!.querySelector('[data-total]')!.textContent ?? '';
}

function delta(el: HTMLElement): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('[data-delta]')!;
}

function over(el: HTMLElement): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>('[data-over]')!;
}

describe('<rack-console> (Decode: at-or-under + delta)', () => {
  it('decodes an exact Target into discs and the achieved Total, with no delta note', () => {
    const el = mountConsole();
    type(el, '100');
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    expect(total(el)).toContain('100');
    expect(delta(el).hidden).toBe(true);
  });

  it('shows the bare Bar and Total 20 for an empty Target', () => {
    const el = mountConsole();
    type(el, '');
    expect(discs(el).length).toBe(0);
    expect(total(el)).toContain('20');
    expect(delta(el).hidden).toBe(true);
  });

  it('rounds an off-grid Target down and renders how far under it landed', () => {
    const el = mountConsole();
    type(el, '100.5');
    // Nearest at-or-under is 100 -> the same 25 + 15 Side Load is shown.
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    expect(total(el)).toContain('100');
    const note = delta(el);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('0.5');
    expect(note.textContent!.toLowerCase()).toContain('under');
  });

  it('floors a sub-Bar Target at the bare Bar and flags it', () => {
    const el = mountConsole();
    type(el, '10');
    expect(discs(el).length).toBe(0);
    expect(total(el)).toContain('20');
    const note = delta(el);
    expect(note.hidden).toBe(false);
    expect(note.textContent!.toLowerCase()).toContain('bar');
    // A sub-Bar Target already sits above the Target -- no round-up to offer.
    expect(over(el).hidden).toBe(true);
  });

  describe('over-target opt-in (ADR-0003, RBAR-11)', () => {
    it('offers the over option as an explicit opt-in, primary still selected', () => {
      const el = mountConsole();
      type(el, '100.5');
      // The at-or-under primary renders by default -- over is never auto-selected.
      expect(total(el)).toContain('100');
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
      // The opt-in control surfaces the over Total and its positive delta.
      const opt = over(el);
      expect(opt.hidden).toBe(false);
      expect(opt.textContent).toContain('101');
      expect(opt.textContent).toContain('0.5');
    });

    it('renders the over Side Load and Total when the opt-in is chosen', () => {
      const el = mountConsole();
      type(el, '100.5');
      over(el).click();
      expect(total(el)).toContain('101');
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15', '0.5']);
      const note = delta(el);
      expect(note.hidden).toBe(false);
      expect(note.textContent!.toLowerCase()).toContain('over');
    });

    it('toggles back to the at-or-under primary from the over option', () => {
      const el = mountConsole();
      type(el, '100.5');
      over(el).click(); // -> over (101)
      over(el).click(); // -> back to primary (100)
      expect(total(el)).toContain('100');
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    });

    it('hides the over option for an exactly achievable Target', () => {
      const el = mountConsole();
      type(el, '100');
      expect(over(el).hidden).toBe(true);
    });

    it('resets to the primary (clearing any over choice) when the Target changes', () => {
      const el = mountConsole();
      type(el, '100.5');
      over(el).click(); // chose over (101)
      type(el, '100'); // exact Target -> primary, no over
      expect(total(el)).toContain('100');
      expect(over(el).hidden).toBe(true);
    });
  });
});
