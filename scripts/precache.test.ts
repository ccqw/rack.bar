import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cacheName, precacheUrls, renderWorker } from './precache.ts';

// RBAR-81 (ADR-0018): the precache list is generated from the build output. These
// drive the generator with a fake build (a Vite-style manifest plus the public/ files
// Vite copies) and check the rendered worker. The build itself also fails if any
// precached URL is not a file in dist/ (scripts/offline.ts writeBundle).

// A fake Vite build manifest: two pages (the future game page included), a shared
// chunk, CSS and a font asset, as `vite build --manifest` would describe them.
const manifest: Record<string, { file: string; css?: string[]; assets?: string[] }> = {
  'index.html': { file: 'assets/index-AbC123.js', css: ['assets/index-Def456.css'] },
  'game.html': { file: 'assets/game-Ghi789.js', css: ['assets/index-Def456.css'] },
  '_shared-Jkl012.js': { file: 'assets/shared-Jkl012.js', assets: ['assets/disc-Mno345.svg'] },
};
const publicFiles = [
  'CNAME',
  '.nojekyll',
  'favicon.ico',
  'favicon.svg',
  'apple-touch-icon.png',
  'manifest.webmanifest',
  'fonts/hanken-grotesk-latin-var.woff2',
  'icons/icon-192.png',
];
// What the build writes: every page, every manifest file, the public copies, plus
// the plumbing the worker must skip.
const built = [
  ...Object.keys(manifest).filter((k) => k.endsWith('.html')),
  ...Object.values(manifest).flatMap((e) => [e.file, ...(e.css ?? []), ...(e.assets ?? [])]),
  'assets/index-AbC123.js.map',
  '.vite/manifest.json',
  'sw.js',
  ...publicFiles,
];

describe('precacheUrls', () => {
  const urls = precacheUrls(built);

  it('caches the app at / and other pages by their own URL', () => {
    expect(urls).toContain('/');
    expect(urls).not.toContain('/index.html');
    expect(urls).toContain('/game.html');
  });

  it('caches every file the manifest names, once', () => {
    for (const e of Object.values(manifest)) {
      for (const f of [e.file, ...(e.css ?? []), ...(e.assets ?? [])]) {
        expect(urls).toContain('/' + f);
      }
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('caches the icons, fonts and the web manifest from public/', () => {
    for (const f of publicFiles.filter((p) => p !== 'CNAME' && p !== '.nojekyll')) {
      expect(urls).toContain('/' + f);
    }
  });

  it('skips deploy plumbing, the worker, source maps and .vite metadata', () => {
    for (const u of ['/CNAME', '/.nojekyll', '/sw.js', '/assets/index-AbC123.js.map', '/.vite/manifest.json']) {
      expect(urls).not.toContain(u);
    }
  });

  it('is exactly the shipped app files, sorted, whatever order the build lists them in', () => {
    expect(precacheUrls([...built].reverse())).toEqual(urls);
    expect(urls).toEqual([...urls].sort());
    expect(urls).toHaveLength(13);
  });

  it('normalizes ./ prefixes and Windows separators', () => {
    expect(precacheUrls(['./index.html', 'fonts\\a.woff2'])).toEqual(['/', '/fonts/a.woff2']);
  });
});

describe('cacheName', () => {
  it('ties the cache to the version and the shipped bytes', () => {
    expect(cacheName('0.39.0', 'abcdef0123456789')).toBe('rack-bar-v0.39.0-abcdef0123');
    expect(cacheName('0.39.0', 'ffff')).not.toBe(cacheName('0.39.0', 'eeee'));
    expect(cacheName('0.40.0', 'ffff')).not.toBe(cacheName('0.39.0', 'ffff'));
  });

  it('keeps the rack-bar- prefix the worker uses to delete old caches', () => {
    expect(cacheName('1.0.0', 'x')).toMatch(/^rack-bar-/);
  });
});

describe('renderWorker (scripts/sw.js)', () => {
  const template = readFileSync(resolve(import.meta.dirname, 'sw.js'), 'utf8');
  const urls = precacheUrls(built);
  const sw = renderWorker(template, 'rack-bar-v1.0.0-abc', urls);

  it('fills in the cache name and the precache list', () => {
    expect(sw).toContain('const CACHE = "rack-bar-v1.0.0-abc";');
    expect(sw).toContain(JSON.stringify(urls, null, 2));
    expect(sw).not.toMatch(/__RACK_/);
  });

  it('renders valid JavaScript', () => {
    expect(() => new Function(sw)).not.toThrow();
  });

  it('never activates itself: it waits for the Update tap', () => {
    // skipWaiting only behind the SKIP_WAITING message the Update button sends
    expect(sw.match(/skipWaiting\(\)/g)).toHaveLength(1);
    expect(sw).toMatch(/SKIP_WAITING'\) self\.skipWaiting\(\)/);
  });

  it('refuses a template without its markers', () => {
    expect(() => renderWorker('const CACHE = 1;', 'c', [])).toThrow(/marker/);
  });
});
