import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('precaches with cache: reload (bypassing the HTTP cache)', () => {
    expect(sw).toMatch(/new Request\(url, \{ cache: 'reload' \}\)/);
  });

  it('refuses a template without its markers', () => {
    expect(() => renderWorker('const CACHE = 1;', 'c', [])).toThrow(/marker/);
  });
});

// The rendered worker, run against fake worker globals: what it precaches and how it
// answers a page navigation (ADR-0018 decisions 2 and 4).
describe('the worker (scripts/sw.js) at run time', () => {
  const template = readFileSync(resolve(import.meta.dirname, 'sw.js'), 'utf8');
  const PRECACHE = ['/', '/assets/index-AbC123.js', '/game.html'];
  const ORIGIN = 'https://rack.bar';

  /** A response stand-in: just a body string. */
  type Body = { body: string };
  type FakeReq = { url: string; init: { cache?: string } };

  function boot(fetchImpl: (req: unknown) => Promise<Body>) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const store = new Map<string, Body>();
    const added: FakeReq[] = [];
    const put = vi.fn();
    const cache = {
      addAll: vi.fn(async (reqs: FakeReq[]) => {
        for (const r of reqs) {
          added.push(r);
          store.set(r.url, { body: 'precached ' + r.url });
        }
      }),
      match: vi.fn(async (key: string) => store.get(key)),
      put,
    };
    const fakeCaches = {
      open: vi.fn(async () => cache),
      match: vi.fn(async (req: { url: string }) => store.get(new URL(req.url).pathname)),
      keys: vi.fn(async () => []),
      delete: vi.fn(),
    };
    const fakeSelf = {
      location: { origin: ORIGIN },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        handlers[type] = fn;
      },
    };
    class FakeRequest {
      url: string;
      init: { cache?: string };
      constructor(url: string, init: { cache?: string }) {
        this.url = url;
        this.init = init;
      }
    }
    const sw = renderWorker(template, 'rack-bar-vtest', PRECACHE);
    new Function('self', 'caches', 'fetch', 'Request', sw)(
      fakeSelf,
      fakeCaches,
      fetchImpl,
      FakeRequest,
    );

    const install = async () => {
      let done: unknown = Promise.resolve();
      handlers.install!({ waitUntil: (p: Promise<unknown>) => (done = p) });
      await done;
    };
    const navigate = (path: string): Promise<Body> => {
      let res!: Promise<Body>;
      handlers.fetch!({
        request: { url: ORIGIN + path, method: 'GET', mode: 'navigate' },
        respondWith: (p: Promise<Body>) => (res = p),
      });
      return res;
    };
    return { install, navigate, added, put };
  }

  afterEach(() => vi.useRealTimers());

  it('precaches straight from the network, never the HTTP cache', async () => {
    const w = boot(() => Promise.reject(new Error('unused')));
    await w.install();
    expect(w.added.map((r) => r.url)).toEqual(PRECACHE);
    for (const r of w.added) expect(r.init.cache).toBe('reload');
  });

  it('serves an online page from the network and never writes it to the cache', async () => {
    const w = boot(async () => ({ body: 'fresh' }));
    await w.install();
    expect((await w.navigate('/')).body).toBe('fresh');
    expect(w.put).not.toHaveBeenCalled();
  });

  it('offline, serves the precached page by its path, ignoring the query', async () => {
    const w = boot(() => Promise.reject(new TypeError('Failed to fetch')));
    await w.install();
    expect((await w.navigate('/?from=share')).body).toBe('precached /');
    expect((await w.navigate('/index.html')).body).toBe('precached /');
    expect((await w.navigate('/game.html?x=1')).body).toBe('precached /game.html');
    // a page that was never precached falls back to the app
    expect((await w.navigate('/nope')).body).toBe('precached /');
  });

  it('on a hanging network, serves the precached page after 3 s', async () => {
    vi.useFakeTimers();
    const w = boot(() => new Promise<Body>(() => {})); // one bar of signal: never settles
    await w.install();
    const res = w.navigate('/');
    let settled: Body | undefined;
    void res.then((b) => (settled = b));
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect((await res).body).toBe('precached /');
  });
});
