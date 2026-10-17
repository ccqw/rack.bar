import { describe, it, expect, afterEach } from 'vitest';
import './app.ts';
import { SHORT_SCREEN } from './fit.ts';

// RBAR-67's short-screen tier: on a viewport too short for the handoff's spacing (an
// iPhone SE in Safari shows 375x548), every block in the column tightens its SPACING --
// paddings, margins, gaps -- so the page still fits without scrolling. Controls keep
// their size (44px touch targets, type sizes): only the air between them shrinks.
// happy-dom never matches a height media query, so the contract is text-locked: each
// root carries one @media SHORT_SCREEN block with the tighter values.

afterEach(() => document.body.replaceChildren());

function roots(): Record<string, ShadowRoot> {
  const app = document.createElement('rack-app');
  document.body.append(app);
  const appRoot = app.shadowRoot!;
  const con = appRoot.querySelector('rack-console')!.shadowRoot!;
  return {
    app: appRoot,
    console: con,
    entry: con.querySelector('rack-entry')!.shadowRoot!,
    loaded: con.querySelector('rack-loaded')!.shadowRoot!,
    palette: con.querySelector('rack-palette')!.shadowRoot!,
  };
}

// The body of the short-screen @media block in a root's first <style>.
function shortBlock(root: ShadowRoot): string {
  const css = root.querySelector('style')!.textContent!;
  const at = css.indexOf(`@media ${SHORT_SCREEN}`);
  expect(at).toBeGreaterThanOrEqual(0);
  // The block runs to its closing brace: the first `}` at depth 0 after the opener.
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error('unterminated @media block');
}

describe('short-screen tier (RBAR-67)', () => {
  it('is a viewport-height query below the Must size (393x659 keeps the handoff spacing)', () => {
    expect(SHORT_SCREEN).toBe('(max-height: 600px)');
  });

  it('tightens the header pad and the top of main', () => {
    const block = shortBlock(roots().app);
    expect(block).toMatch(/header\s*\{\s*padding-top: 6px; padding-bottom: 6px;/);
    expect(block).toMatch(/main\s*\{\s*padding-top: 4px;/);
  });

  it('tightens the column gap, the mode track inset, and the Total head', () => {
    const block = shortBlock(roots().console);
    expect(block).toMatch(/\.stack\s*\{\s*gap: 8px;/);
    expect(block).toMatch(/\.modes\s*\{\s*padding: 1px;/);
    expect(block).toMatch(/\.readhead\s*\{\s*margin-bottom: 4px;/);
    // The segments themselves (the tappable buttons) keep their size.
    expect(block).not.toContain('.modes button');
  });

  it('tightens the Target section opener but keeps the steppers', () => {
    const block = shortBlock(roots().entry);
    expect(block).toMatch(/:host\s*\{\s*padding-top: 10px;/);
    expect(block).toMatch(/\.caption\s*\{\s*margin-bottom: 6px;/);
    expect(block).not.toContain('.step');
  });

  it('tightens the By Plates head rows', () => {
    const r = roots();
    expect(shortBlock(r.loaded)).toMatch(/\.head\s*\{\s*margin-bottom: 4px;/);
    expect(shortBlock(r.palette)).toMatch(/\.head\s*\{\s*margin-bottom: 4px;/);
  });
});
