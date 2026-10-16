import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// RBAR-59: on iPhone, two quick taps on a control (plate keys, keypad digits, steppers)
// were read by Safari as double-tap-to-zoom, zooming the page mid-interaction.
// `touch-action: manipulation` disables double-tap zoom only -- pinch zoom survives, so
// the viewport meta is deliberately left alone (no user-scalable=no; WCAG 1.4.4).
//
// happy-dom has no gesture engine, so the zoom itself is an on-device check (PR test
// plan). These pin the CSS at the two levels it lives: the document root (app-wide, so
// the gaps between keys are covered too) and the shared button rule every shadow root
// interpolates (the prototype's base button rule, rack.bar.dc.html L26).

const indexHtml = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf8');

describe('document root suppresses double-tap zoom app-wide (RBAR-59)', () => {
  it('sets touch-action: manipulation on html', () => {
    expect(indexHtml).toMatch(/\bhtml\s*\{[^}]*touch-action:\s*manipulation/);
  });

  it('keeps pinch zoom: the viewport meta does not disable user scaling', () => {
    const meta = indexHtml.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
    expect(meta).toContain('width=device-width');
    expect(meta).not.toMatch(/user-scalable\s*=\s*(no|0)/);
    expect(meta).not.toMatch(/maximum-scale/);
  });
});

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

describe('every shadow root carries the mobile tap rule on buttons (RBAR-59)', () => {
  for (const tag of TAGS) {
    it(`<${tag}> buttons suppress zoom, tap highlight and text selection`, () => {
      const el = document.createElement(tag);
      document.body.append(el);
      const css = [...el.shadowRoot!.querySelectorAll('style')]
        .map((s) => s.textContent)
        .join('\n');
      const rule = css.match(/button\s*\{[^}]*touch-action[^}]*\}/)?.[0] ?? '';
      expect(rule, `<${tag}> button rule`).toMatch(/touch-action:\s*manipulation/);
      expect(rule).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
      expect(rule).toMatch(/-webkit-user-select:\s*none/);
      expect(rule).toMatch(/(^|[\s;{])user-select:\s*none/);
      el.remove();
    });
  }
});
