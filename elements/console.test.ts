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

describe('<rack-console> (Decode walking skeleton)', () => {
  it('decodes an exact Target into discs and the achieved Total', () => {
    const el = mountConsole();
    type(el, '100');
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    expect(total(el)).toContain('100');
  });

  it('shows the bare Bar and Total 20 for an empty Target', () => {
    const el = mountConsole();
    type(el, '');
    expect(discs(el).length).toBe(0);
    expect(total(el)).toContain('20');
  });

  it('renders no discs for an off-grid Target it cannot build exactly', () => {
    const el = mountConsole();
    type(el, '100.5');
    expect(discs(el).length).toBe(0);
  });
});
