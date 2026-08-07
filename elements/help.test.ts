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

  it('links the button to the popover as a disclosure (aria-controls)', () => {
    const { root } = mountHelp();
    const id = popover(root).id;
    expect(id).toBeTruthy();
    expect(toggleBtn(root).getAttribute('aria-controls')).toBe(id);
    // It is a static explainer with no interactive content -- a disclosure, not a dialog.
    expect(popover(root).getAttribute('role')).not.toBe('dialog');
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

  it('stays consistent across a disconnect-while-open then reconnect', () => {
    const { el, root } = mountHelp();
    toggleBtn(root).click(); // open
    expect(popover(root).hidden).toBe(false);
    el.remove(); // disconnect while open
    document.body.append(el); // reconnect rebuilds the markup closed
    expect(popover(el.shadowRoot!).hidden).toBe(true);
    // A single toggle must open it -- the flag didn't desync into a no-op first tap.
    toggleBtn(el.shadowRoot!).click();
    expect(popover(el.shadowRoot!).hidden).toBe(false);
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

// RBAR-45: help fidelity locks. The idle button chip (prototype helpBtnStyle L916),
// the popover card radius (L84), the popIn drop (L22), and the two-tier body ink
// (L86-87) are handoff values; lock them so a refactor cannot drift them.
describe('<rack-help> fidelity (RBAR-45)', () => {
  function rule(root: ShadowRoot, selector: string): string {
    const css = root.querySelector('style')!.textContent!;
    const start = css.indexOf(selector);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('the idle toggle is a raised chip: active fill, muted border, secondary ink', () => {
    const { root } = mountHelp();
    const t = rule(root, '.toggle {');
    expect(t).toContain('background: var(--rack-active)');
    expect(t).toContain('var(--rack-border-muted)');
    expect(t).toContain('color: var(--rack-text-secondary)');
  });

  it('the open toggle keeps the accent treatment', () => {
    const { root } = mountHelp();
    const open = rule(root, '.toggle[aria-expanded="true"]');
    expect(open).toContain('var(--rack-accent)');
  });

  it('the popover card rounds at the sheet-control radius', () => {
    const { root } = mountHelp();
    expect(rule(root, '.popover {')).toContain('var(--rack-radius-sheet-control)');
  });

  it('the pop-in animation drops in from -6px at .97 scale', () => {
    const { root } = mountHelp();
    const css = root.querySelector('style')!.textContent!;
    expect(css).toContain('translateY(-6px) scale(.97)');
    expect(rule(root, '.popover {')).toContain('animation: rack-pop .16s');
  });

  it('the body ink is two-tier: running copy popover-ink, strong full white', () => {
    const { root } = mountHelp();
    expect(rule(root, '.step .body {')).toContain('var(--rack-popover-ink)');
    expect(rule(root, '.step .body strong')).toContain('var(--rack-text)');
  });
});
