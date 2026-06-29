import { describe, it, expect } from 'vitest';
import './help.ts';

type Help = HTMLElement & { open(): void; close(): void };

function mountHelp(): { el: Help; root: ShadowRoot } {
  const el = document.createElement('rack-help') as Help;
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

function toggleBtn(root: ShadowRoot): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('[data-help-toggle]')!;
}
function popover(root: ShadowRoot): HTMLElement {
  return root.querySelector<HTMLElement>('[data-help-popover]')!;
}

describe('<rack-help> (the how-it-works popover, RBAR-21)', () => {
  it('starts closed: popover hidden, button not expanded', () => {
    const { root } = mountHelp();
    expect(popover(root).hidden).toBe(true);
    expect(toggleBtn(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('a tap on the help button opens the popover', () => {
    const { root } = mountHelp();
    toggleBtn(root).click();
    expect(popover(root).hidden).toBe(false);
    expect(toggleBtn(root).getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a numbered 2-step explainer naming the real mode labels', () => {
    const { root } = mountHelp();
    toggleBtn(root).click();
    const steps = popover(root).querySelectorAll('[data-help-step]');
    expect(steps).toHaveLength(2);
    const text = popover(root).textContent ?? '';
    // The explainer must name the modes with the words the toggle actually shows
    // ("By Weight" / "By Plates"), and use glossary terms (Target, Plates, Side).
    expect(text).toContain('By Weight');
    expect(text).toContain('By Plates');
    expect(text).toContain('Side');
  });

  it('a second tap on the button closes it again', () => {
    const { root } = mountHelp();
    toggleBtn(root).click();
    expect(popover(root).hidden).toBe(false);
    toggleBtn(root).click();
    expect(popover(root).hidden).toBe(true);
    expect(toggleBtn(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('a tap outside the element closes an open popover', () => {
    const { root } = mountHelp();
    toggleBtn(root).click();
    expect(popover(root).hidden).toBe(false);
    document.body.click();
    expect(popover(root).hidden).toBe(true);
  });

  it('a tap inside the popover leaves it open', () => {
    const { root } = mountHelp();
    toggleBtn(root).click();
    popover(root).click();
    expect(popover(root).hidden).toBe(false);
  });

  it('Escape closes an open popover', () => {
    const { el, root } = mountHelp();
    toggleBtn(root).click();
    expect(popover(root).hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popover(root).hidden).toBe(true);
    // and the (now-closed) element no longer leaks a document listener that fires
    el.open();
    expect(popover(root).hidden).toBe(false);
  });

  it('open() / close() are programmatic and emit nothing surprising', () => {
    const { el, root } = mountHelp();
    el.open();
    expect(popover(root).hidden).toBe(false);
    el.close();
    expect(popover(root).hidden).toBe(true);
  });

  it('drops its document listener when disconnected (no dangling close)', () => {
    const { el, root } = mountHelp();
    toggleBtn(root).click();
    el.remove();
    // A stray outside click after teardown must not throw or touch the detached node.
    expect(() => document.body.click()).not.toThrow();
    expect(popover(root).hidden).toBe(false);
  });
});
