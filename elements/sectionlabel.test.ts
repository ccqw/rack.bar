// RBAR-40: the section-label system. One recipe -- JetBrains Mono 600 11px, .14em
// tracking, uppercase, text-muted ink (handoff "Typography": 'section label 11px/600
// mono, .14em, uppercase') -- across every section label: console Total, entry Target,
// loaded On the bar, recents Recent, setup Bar/Collars/Plates, share Loading card,
// help How it works. Plus the two layout adoptions the ticket names: the Total row
// becomes flex space-between (toggle at the right edge, prototype L131) and the Target
// section opens with a divider (prototype L146: border-top + 15px padding).
import { describe, it, expect } from 'vitest';
import './console.ts';
import './entry.ts';
import './loaded.ts';
import './recents.ts';
import './setup.ts';
import './share.ts';
import './help.ts';

// Mount the element and slice one rule body out of its shadow stylesheet, so a
// sibling rule using the same declaration cannot false-pass (console.test idiom).
function ruleBody(tag: string, selector: string): string {
  const el = document.createElement(tag);
  document.body.append(el);
  const css = el.shadowRoot!.querySelector('style')!.textContent!;
  const start = css.indexOf(`${selector} {`);
  expect(start, `${tag} styles ${selector}`).toBeGreaterThan(-1);
  el.remove();
  return css.slice(start, css.indexOf('}', start));
}

describe('section-label system (RBAR-40)', () => {
  // Every section label shares the one recipe.
  const SITES: Array<[tag: string, selector: string]> = [
    ['rack-console', '.readout .label'],
    ['rack-entry', '.caption'],
    ['rack-loaded', '.label'],
    ['rack-recents', '.label'],
    ['rack-setup', '.section-label'],
    ['rack-share', '.label'],
    ['rack-help', '.heading'],
  ];

  it.each(SITES)('%s %s uses the section-label recipe', (tag, selector) => {
    const rule = ruleBody(tag, selector);
    expect(rule).toContain('var(--rack-font-num)'); // JetBrains Mono
    expect(rule).toContain('font-size: 11px');
    expect(rule).toContain('font-weight: 600');
    expect(rule).toContain('letter-spacing: .14em');
    expect(rule).toContain('text-transform: uppercase');
    expect(rule).toContain('var(--rack-text-muted)'); // #9aa1a9 ink (RBAR-34 tier)
  });

  it('lays the Total row out space-between: label left, unit toggle right', () => {
    // Prototype L131: the Total label and the kg/lb segmented toggle sit at the row's
    // edges -- not centered with a gap.
    const rule = ruleBody('rack-console', '.readhead');
    expect(rule).toContain('justify-content: space-between');
  });

  it('opens the Target section with the spec divider', () => {
    // Prototype L146: the Target block starts with a 1px hairline + 15px padding.
    const rule = ruleBody('rack-entry', ':host');
    expect(rule).toContain('border-top: 1px solid var(--rack-divider)');
    expect(rule).toContain('padding-top: 15px');
  });

  it('keeps the Target caption a bare "Target" -- the unit rides the value suffix', () => {
    // RBAR-39 moved the unit into the value's dim suffix; the label restyle must not
    // re-add it.
    const el = document.createElement('rack-entry');
    document.body.append(el);
    const caption = el.shadowRoot!.querySelector('[data-caption]')!;
    expect(caption.textContent).toBe('Target');
    el.remove();
  });
});
