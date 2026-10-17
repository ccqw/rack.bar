// precache.ts -- the pure half of the offline build step (RBAR-81, ADR-0018).
//
// The Vite plugin in scripts/offline.ts lists what the build wrote (the bundle's
// emitted files plus the copied public/ files), hands that list here, and writes the
// service worker this module renders. Kept free of fs and Vite so it unit-tests
// against a fake build manifest (scripts/precache.test.ts).

/** Build-output files that are deploy plumbing, not part of the app. */
const SKIP = new Set(['CNAME', '.nojekyll', 'sw.js']);

/**
 * The URLs the worker precaches, from the build's output file names (paths relative
 * to dist/, forward slashes). Every page is cached by its URL ("index.html" is "/",
 * "game.html" stays "/game.html"); deploy plumbing (CNAME, .nojekyll), the worker
 * itself, source maps and Vite's .vite/ metadata are left out. Sorted and de-duplicated
 * so the same build always renders the same worker.
 */
export function precacheUrls(files: readonly string[]): string[] {
  const urls = new Set<string>();
  for (const raw of files) {
    const file = raw.replace(/\\/g, '/').replace(/^\.?\//, '');
    const base = file.slice(file.lastIndexOf('/') + 1);
    if (SKIP.has(file) || file.startsWith('.vite/') || base.endsWith('.map')) continue;
    urls.add(file === 'index.html' ? '/' : '/' + file);
  }
  return [...urls].sort();
}

/**
 * The cache the worker fills: the app version plus a hash of the precached bytes, so
 * any change to any shipped file (even without a version bump) makes a new worker and
 * a fresh cache, and the old one is deleted when the new worker takes over.
 */
export function cacheName(version: string, contentHash: string): string {
  return `rack-bar-v${version}-${contentHash.slice(0, 10)}`;
}

/** The marker lines the worker template carries, replaced at build time. */
export const CACHE_MARKER = '__RACK_CACHE__';
export const PRECACHE_MARKER = '__RACK_PRECACHE__';

/** Fill the worker template (scripts/sw.js) with the cache name and precache list. */
export function renderWorker(template: string, cache: string, urls: readonly string[]): string {
  if (!template.includes(CACHE_MARKER) || !template.includes(PRECACHE_MARKER)) {
    throw new Error('sw.js template is missing its cache or precache marker');
  }
  return template
    .replace(`'${CACHE_MARKER}'`, JSON.stringify(cache))
    .replace(PRECACHE_MARKER, JSON.stringify(urls, null, 2));
}
