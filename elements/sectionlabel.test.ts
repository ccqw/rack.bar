// RBAR-40: the section-label system. One recipe -- JetBrains Mono 600 11px, .14em
// tracking, uppercase, text-muted ink (handoff "Typography": 'section label 11px/600
// mono, .14em, uppercase') -- across every section label: console Total, entry Target,
// loaded On the bar, recents Recent, palette Add (visible since RBAR-54's head row),
// setup Bar/Collars/Plates, share Loading card, help How it works. Plus the two
// layout adoptions the ticket names: the Total row
// becomes flex space-between (toggle at the right edge, prototype L131) and the Target
// section opens with a divider (prototype L146: border-top + 15px padding).
import { describe, it, expect } from 'vitest';
import './console.ts';
import './entry.ts';
import './loaded.ts';
import './recents.ts';
import './palette.ts';
import './setup.ts';
import './share.ts';
import './help.ts';
import { VISUALLY_HIDDEN } from './sectionlabel.ts';
import { ELEIKO_KG } from '../lib/plates.ts';

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
    ['rack-palette', '.label'],
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

// RBAR-53: every section label is a real heading, so a screen reader can walk the app
// by heading navigation. The labels keep the section-label recipe (RBAR-40, tested
// above -- the selectors are class-based, so those assertions still bind); only the
// TAG changes, span/div -> h2/h3, hierarchical under the app's single h1 (app.test.ts).
describe('section labels are headings (RBAR-53)', () => {
  function shadow(tag: string): ShadowRoot {
    const el = document.createElement(tag);
    document.body.append(el);
    return el.shadowRoot!;
  }

  const HEADINGS: Array<[tag: string, selector: string, text: string]> = [
    ['rack-console', 'h2.label', 'Total'],
    ['rack-entry', 'h2.caption', 'Target'],
    ['rack-recents', 'h2.label', 'Recent'],
    ['rack-share', 'h2.label', 'Loading card'],
    ['rack-help', 'h2.heading', 'How it works'],
  ];

  it.each(HEADINGS)('%s: %s reads "%s"', (tag, selector, text) => {
    expect(shadow(tag).querySelector(selector)?.textContent).toBe(text);
  });

  it('the Setup sheet: an h2 title over h3 sections', () => {
    const root = shadow('rack-setup');
    expect(root.querySelector('h2.title')?.textContent).toBe('Setup');
    const sections = [...root.querySelectorAll('h3.section-label')].map(
      (h) => h.textContent,
    );
    expect(sections).toEqual(['Bar', 'Collars', 'Plates']);
  });

  it("the Add palette's visible head label is the h2 (RBAR-54 head row)", () => {
    const root = shadow('rack-palette');
    const h2 = root.querySelector('h2');
    expect(h2?.textContent).toBe('Add');
    // Since RBAR-54 the palette has a visible Add head row, so the heading is the
    // label itself (section-label recipe, margins pinned) -- not a clip-hidden node.
    expect(h2?.className).toBe('label');
    const rule = ruleBody('rack-palette', '.label');
    expect(rule).toContain('margin: 0');
    expect(rule).not.toContain('clip-path');
  });

  it('the On the bar heading rides the reservation: hidden empty, exposed loaded', () => {
    // Deliberate contract, not an accident of RBAR-52's slot: an empty On the bar
    // section has nothing to navigate to, so its whole row -- h2 included -- sits
    // reserved (visibility: hidden, out of the a11y tree). The heading joins heading
    // navigation the moment a Plate lands.
    const el = document.createElement('rack-loaded') as HTMLElement & {
      side: readonly unknown[];
    };
    document.body.append(el);
    const root = el.shadowRoot!;
    expect(root.querySelector('h2.label')?.textContent).toBe('On the bar');
    expect(root.querySelector('[data-onbar]')?.classList.contains('reserving')).toBe(true);
    el.side = [ELEIKO_KG[0]];
    expect(root.querySelector('[data-onbar]')?.classList.contains('reserving')).toBe(false);
    el.remove();
  });

  it('the loaded empty hint stays a plain label, not a heading', () => {
    const root = shadow('rack-loaded');
    expect(root.querySelector('[data-empty] h2')).toBeNull();
    expect(root.querySelector('[data-empty] .label')?.textContent).toBe(
      'Tap to add a pair',
    );
  });

  it('VISUALLY_HIDDEN is the clip recipe -- present to the a11y tree, never display:none', () => {
    expect(VISUALLY_HIDDEN).toContain('position: absolute');
    expect(VISUALLY_HIDDEN).toContain('clip-path');
    expect(VISUALLY_HIDDEN).not.toContain('display: none');
  });
});
