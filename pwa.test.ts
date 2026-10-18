import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { faviconSvg } from './scripts/favicon-svg.mjs';

// RBAR-71: rack.bar installs to the Home Screen. These lock the install wiring that
// happy-dom never exercises: index.html's manifest/icon links and iOS metas, the
// manifest's required fields and token colours, and that every icon it names is a
// real file in public/ (Vite copies public/ verbatim into dist/) at its declared
// size. The PNGs are generated from assets/icons/ by scripts/icons.mjs and committed.

const root = import.meta.dirname;
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const pub = (src: string) => resolve(root, 'public', src.replace(/^\//, ''));

// Parsed into an inert <template> so happy-dom doesn't try to fetch the stylesheet
// and font preloads (a full DOMParser document connects them and logs failures).
const tpl = document.createElement('template');
tpl.innerHTML = read('index.html');
const doc = tpl.content;
const tokens = read('tokens.css');
const manifest = JSON.parse(read('public/manifest.webmanifest'));

const meta = (name: string) =>
  doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
const links = (rel: string) => [...doc.querySelectorAll(`link[rel="${rel}"]`)];

/** A PNG's pixel size, from its IHDR chunk (bytes 16..23). */
function pngSize(path: string) {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString('latin1'), `${path} is a PNG`).toBe('PNG');
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

// The app's background: --rack-bg aliases --rack-surface, the dark ground.
const surface = tokens.match(/--rack-surface:\s*(#[0-9a-f]{6})\s*;/i)?.[1]?.toLowerCase();

describe('index.html install wiring', () => {
  it('links the manifest', () => {
    const [link] = links('manifest');
    expect(link?.getAttribute('href')).toBe('/manifest.webmanifest');
    expect(existsSync(pub('/manifest.webmanifest'))).toBe(true);
  });

  it('links a 180px apple-touch-icon that exists', () => {
    const href = links('apple-touch-icon')[0]?.getAttribute('href');
    expect(href).toBe('/apple-touch-icon.png');
    expect(pngSize(pub(href!))).toBe('180x180');
  });

  it('links the SVG favicon and the ICO fallback, both present', () => {
    const icons = links('icon');
    const svg = icons.find((l) => l.getAttribute('type') === 'image/svg+xml');
    const ico = icons.find((l) => l.getAttribute('href')?.endsWith('.ico'));
    expect(svg?.getAttribute('href')).toBe('/favicon.svg');
    expect(ico?.getAttribute('href')).toBe('/favicon.ico');
    // sizes on the ICO keeps Chromium from preferring it over the SVG
    expect(ico?.getAttribute('sizes')).toBe('32x32');
    expect(existsSync(pub('/favicon.svg'))).toBe(true);
    expect(existsSync(pub('/favicon.ico'))).toBe(true);
  });

  it('carries the standalone and iOS Home Screen metas', () => {
    expect(meta('mobile-web-app-capable')).toBe('yes');
    expect(meta('apple-mobile-web-app-capable')).toBe('yes');
    expect(meta('apple-mobile-web-app-status-bar-style')).toBe('black-translucent');
    expect(meta('apple-mobile-web-app-title')).toBe('rack.bar');
    // black-translucent puts the page under the status bar: the body must still
    // pad by the top safe area or the header would sit under the clock.
    expect(read('index.html')).toMatch(/padding:\s*env\(safe-area-inset-top\)/);
  });

  it('sets theme-color to the dark surface token', () => {
    expect(surface).toBeTruthy();
    expect(meta('theme-color')?.toLowerCase()).toBe(surface);
  });
});

describe('manifest.webmanifest', () => {
  it('names the app and launches it standalone at the root', () => {
    expect(manifest.name).toBe('rack.bar');
    expect(manifest.short_name).toBe('rack.bar');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('takes its colours from the dark surface token', () => {
    expect(manifest.theme_color.toLowerCase()).toBe(surface);
    expect(manifest.background_color.toLowerCase()).toBe(surface);
  });

  it('lists 192 and 512 "any" icons and a 512 maskable icon', () => {
    const has = (sizes: string, purpose: string) =>
      manifest.icons.some(
        (i: { sizes: string; purpose?: string }) =>
          i.sizes === sizes && (i.purpose ?? 'any').split(/\s+/).includes(purpose),
      );
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  it('points every icon at a PNG in public/ of the declared size', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(existsSync(pub(icon.src)), `${icon.src} exists`).toBe(true);
      expect(pngSize(pub(icon.src)), icon.src).toBe(icon.sizes);
    }
  });
});

describe('favicon source', () => {
  // The tiny favicons come from Caitlin's jumbo masters (2026-10-17), not the app icon.
  it('is built from the jumbo masters (re-run npm run icons after a redraw)', () => {
    expect(read('public/favicon.svg')).toBe(
      faviconSvg(
        read('assets/icons/rack-bar-favicon-jumbo-dark.svg'),
        read('assets/icons/rack-bar-favicon-jumbo-light.svg'),
      ),
    );
  });

  it('is dark by default and switches to the light cut in a light browser', () => {
    const svg = read('public/favicon.svg');
    expect(svg).toMatch(/@media\s*\(\s*prefers-color-scheme:\s*light\s*\)/);
    expect(svg).not.toMatch(/xlink|<defs|\sid=/);
  });

  it('keeps every jumbo edge on the 12.5-unit grid, so 16px renders pixel-exact', () => {
    for (const cut of ['dark', 'light']) {
      const svg = read(`assets/icons/rack-bar-favicon-jumbo-${cut}.svg`);
      expect(svg, cut).not.toMatch(/<(?!svg|\/svg|rect|title|\/title|!--)/);
      for (const [, attr, value] of svg.matchAll(/\s(x|y|width|height)="([^"]+)"/g)) {
        expect(Number(value) % 12.5, `${cut} ${attr}="${value}"`).toBe(0);
      }
    }
  });

  it('ships 16, 32 and 48 px frames in the ICO', () => {
    const buf = readFileSync(pub('/favicon.ico'));
    const n = buf.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, i) => buf[6 + 16 * i]);
    expect(sizes).toEqual([16, 32, 48]);
  });
});

// RBAR-99: the Home Screen app has no Safari toolbars, so the page owns the whole
// screen. In a browser tab the body stays exactly 100svh (ADR-0013: the layout never
// jumps as the toolbars hide); in standalone it fills the dynamic viewport, and the
// spare height goes under the bar block (--rack-bar-air) instead of into an empty
// strip under the controls. CSS text, since happy-dom cannot match display-mode or lay
// out; scripts/fit-check.js measures it at an emulated standalone size.
describe('Home Screen app height (RBAR-99)', () => {
  /** The body of every `@media (display-mode: standalone) { ... }` block in `css`. */
  const standalone = (css: string) => {
    const out: string[] = [];
    for (const m of css.matchAll(/@media\s*\(display-mode:\s*standalone\)\s*\{/g)) {
      let depth = 1;
      let i = m.index! + m[0].length;
      const start = i;
      for (; depth > 0 && i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
      }
      out.push(css.slice(start, i - 1));
    }
    return out;
  };
  const without = (css: string, parts: string[]) =>
    parts.reduce((s, p) => s.replace(p, ''), css);

  for (const page of ['index.html', 'game.html']) {
    it(`${page}: fills 100dvh in standalone, keeps 100svh in a browser tab`, () => {
      const html = read(page);
      const sa = standalone(html);
      expect(sa.join('\n')).toMatch(/body\s*\{[^}]*[^-]height:\s*100dvh/);
      // The base rule (outside the standalone block) stays the small viewport.
      const base = without(html, sa);
      expect(base).toMatch(/body\s*\{[^}]*[^-]height:\s*100svh/);
      expect(base).not.toMatch(/100dvh/);
      // Equal specificity: the standalone rule only wins if it comes after the base one.
      expect(html.indexOf('100dvh')).toBeGreaterThan(html.indexOf('100svh'));
      // Still padded by the insets, so the controls clear the home indicator.
      expect(html).toMatch(/env\(safe-area-inset-bottom\)/);
    });
  }

  it('tokens.css: no air under the bar block in a tab, auto in standalone', () => {
    const sa = standalone(tokens);
    expect(without(tokens, sa)).toMatch(/--rack-bar-air:\s*0px;/);
    expect(sa.join('\n')).toMatch(/:root\s*\{[^}]*--rack-bar-air:\s*auto;/);
    // Equal specificity: the standalone value only wins if it comes after the default.
    expect(tokens.indexOf('--rack-bar-air: auto')).toBeGreaterThan(
      tokens.indexOf('--rack-bar-air: 0px'),
    );
  });

  // The owner's pick (variant A): the Bar draws bigger in the Home Screen app only. A
  // browser tab keeps grow 0, so the handoff's 204px block and 168px bumper (ADR-0013).
  it('tokens.css: the bigger Bar (--rack-bar-grow) is standalone-only', () => {
    const sa = standalone(tokens);
    const base = without(tokens, sa);
    expect(base).toMatch(/--rack-bar-grow:\s*0;/);
    expect(base).not.toMatch(/--rack-bar-grow:\s*0\.\d/);
    expect(sa.join('\n')).toMatch(/:root\s*\{[^}]*--rack-bar-grow:\s*0\.65;/);
    expect(tokens.indexOf('--rack-bar-grow: 0.65')).toBeGreaterThan(
      tokens.indexOf('--rack-bar-grow: 0;'),
    );
  });
});
