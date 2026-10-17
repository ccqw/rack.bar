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

  it('ships 16, 32 and 48 px frames in the ICO', () => {
    const buf = readFileSync(pub('/favicon.ico'));
    const n = buf.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, i) => buf[6 + 16 * i]);
    expect(sizes).toEqual([16, 32, 48]);
  });
});
