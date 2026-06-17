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
  });
});
