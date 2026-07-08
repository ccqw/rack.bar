// RBAR-42: plate-color fills. Handoff "Plate palette": 'Disc fill is a soft top-lit
// gradient: linear-gradient(180deg, color-mix(in srgb, <hex> 95%, #fff), <hex>)'. One
// shared recipe (elements/discfill.ts) now feeds every gradient surface -- the sleeve
// discs, the palette keys, the loaded chips -- so the fill cannot drift per-site. The
// share chip is the DELIBERATE exception: the prototype (L889) fills it flat and leans
// on a stronger 1.5px ring instead, so it must NOT pick up the gradient.
import { describe, it, expect } from 'vitest';
import './palette.ts';
import './loaded.ts';
import './share.ts';
import './sleeve.ts';

const GRADIENT =
  'linear-gradient(180deg, color-mix(in srgb, var(--disc) 95%, #fff), var(--disc))';

// Mount the element and slice one rule body out of its shadow stylesheet, so a
// sibling rule using the same declaration cannot false-pass (sectionlabel.test idiom).
function ruleBody(tag: string, selector: string): string {
  const el = document.createElement(tag);
  document.body.append(el);
  const css = el.shadowRoot!.querySelector('style')!.textContent!;
  const start = css.indexOf(`${selector} {`);
  expect(start, `${tag} styles ${selector}`).toBeGreaterThan(-1);
  el.remove();
  return css.slice(start, css.indexOf('}', start));
}

describe('plate-color fills (RBAR-42)', () => {
  describe('palette keys (prototype L831)', () => {
    it('fills each key with the shared top-lit gradient, no border, its own lift', () => {
      const key = ruleBody('rack-palette', '.key');
      expect(key).toContain(GRADIENT);
      expect(key).toContain('border: none');
      expect(key).toContain('border-radius: 12px');
      expect(key).toContain(
        'box-shadow: inset 0 0 0 1px rgba(255,255,255,.1), 0 1px 3px rgba(0,0,0,.2)',
      );
    });

    it('sets the key face in Hanken 700 15px (not the mono numeral face)', () => {
      const key = ruleBody('rack-palette', '.key');
      expect(key).toContain('var(--rack-font)');
      expect(key).not.toContain('var(--rack-font-num)');
      expect(key).toContain('font-size: 15px');
      expect(key).toContain('font-weight: 700');
    });

    it('dims a non-fitting key to 30% with a not-allowed cursor (handoff 4b)', () => {
      const disabled = ruleBody('rack-palette', '.key:disabled');
      expect(disabled).toContain('opacity: .3');
      expect(disabled).toContain('cursor: not-allowed');
    });

    it('spaces the key grid at 7px', () => {
      const keys = ruleBody('rack-palette', '.keys');
      expect(keys).toContain('gap: 7px');
    });
  });

  describe('loaded chips (prototype L843)', () => {
    it('fills each chip with the shared gradient and the chip-specific shadow', () => {
      const chip = ruleBody('rack-loaded', '.chip');
      expect(chip).toContain(GRADIENT);
      expect(chip).toContain(
        'box-shadow: inset 0 0 0 1px rgba(255,255,255,.12), 0 1px 2px rgba(0,0,0,.2)',
      );
      // The disc shadow belongs to the sleeve's discs; the chip has its own spec.
      expect(chip).not.toContain('var(--rack-shadow-disc)');
    });
  });

  describe('share chips (prototype L889)', () => {
    it('keeps the FLAT plate fill -- the prototype ring-lights these, no gradient', () => {
      const chip = ruleBody('rack-share', '.chip');
      expect(chip).toContain('background: var(--disc)');
      expect(chip).not.toContain('color-mix');
    });

    it('rings each chip inset 1.5px at 14% white', () => {
      const chip = ruleBody('rack-share', '.chip');
      expect(chip).toContain('box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.14)');
    });

    it('sets the chip face in Hanken 700 12px, padded 6px 12px', () => {
      const chip = ruleBody('rack-share', '.chip');
      expect(chip).toContain('var(--rack-font)');
      expect(chip).not.toContain('var(--rack-font-num)');
      expect(chip).toContain('font-size: 12px');
      expect(chip).toContain('font-weight: 700');
      expect(chip).toContain('padding: 6px 12px');
    });
  });

  describe('sleeve discs (unchanged by the extraction)', () => {
    it('still renders the gradient fill lifted by the shared disc shadow', () => {
      const disc = ruleBody('rack-sleeve', '.disc');
      expect(disc).toContain(GRADIENT);
      expect(disc).toContain('box-shadow: var(--rack-shadow-disc)');
    });
  });
});
