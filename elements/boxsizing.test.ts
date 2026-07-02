import { describe, it, expect } from 'vitest';
// Importing every shell registers all eleven custom elements.
import './app.ts';
import './console.ts';
import './entry.ts';
import './fullscreen.ts';
import './help.ts';
import './loaded.ts';
import './palette.ts';
import './recents.ts';
import './setup.ts';
import './share.ts';
import './sleeve.ts';

// RBAR-33: the light-DOM `* { box-sizing: border-box }` reset in index.html does not
// cross the Shadow DOM boundary, so every shadow root silently computed content-box.
// The visible break: <rack-entry>'s keypad sheet (width: 100% + 32px horizontal
// padding) rendered 416px wide on a 384px viewport, clipping the right key column
// and half of Done. The handoff prototype styles everything under a global
// border-box reset, so border-box in every root is the design's baseline.
//
// happy-dom has no layout engine (it cannot measure the 416px), so the regression
// is pinned at the level it broke: every shadow root must carry the shared reset.
// The rendered ACs -- sheet <= viewport at 320/384/430px, plus an eyeball sweep of
// the other roots whose min-height + padding controls shrink to their authored
// touch-target sizes under border-box (setup, share, recents, help, header pill)
// -- are covered by the real-browser pass in the PR test plan.

const TAGS = [
  'rack-app',
  'rack-console',
  'rack-entry',
  'rack-fullscreen',
  'rack-help',
  'rack-loaded',
  'rack-palette',
  'rack-recents',
  'rack-setup',
  'rack-share',
  'rack-sleeve',
] as const;

// `*` never matches pseudo-elements, so the reset must name ::before/::after
// explicitly to cover them. Whitespace-insensitive match.
const RESET = /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{\s*box-sizing:\s*border-box\s*;?\s*\}/;

describe('every shadow root carries the border-box reset (RBAR-33)', () => {
  for (const tag of TAGS) {
    it(`<${tag}> resets box-sizing in its shadow root`, () => {
      const el = document.createElement(tag);
      document.body.append(el);
      const css = [...el.shadowRoot!.querySelectorAll('style')]
        .map((s) => s.textContent)
        .join('\n');
      expect(css, `<${tag}> shadow style`).toMatch(RESET);
      el.remove();
    });
  }
});
