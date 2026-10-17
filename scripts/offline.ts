// offline.ts -- the Vite plugin that makes rack.bar work offline (RBAR-81, ADR-0018).
//
// At build time it lists every file the build ships (the bundle's emitted files plus
// the copied public/ files), renders scripts/sw.js with that precache list and a cache
// name tied to the version and the shipped bytes (scripts/precache.ts), and emits it as
// dist/sw.js. After the write it checks every precached URL is a real file in dist/, so
// a list that drifts from the build output fails the build instead of the install.
// Build only: the dev server never sees a worker.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { cacheName, precacheUrls, renderWorker } from './precache.ts';

/** Every file under dir, as forward-slash paths relative to it. */
function walk(dir: string, root = dir): string[] {
  if (!dir || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}

export function offline(opts: { version: string; template: string }): Plugin {
  let publicDir = '';
  let outDir = '';
  let urls: string[] = [];
  return {
    name: 'rack-offline',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
      outDir = resolve(config.root, config.build.outDir);
    },
    // order 'post': Vite emits the HTML pages in its own generateBundle, so this
    // runs after it to see index.html in the bundle.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const publicFiles = walk(publicDir);
        urls = precacheUrls([...Object.keys(bundle), ...publicFiles]);
        // Hash the shipped bytes in a fixed order: same build, same worker. The worker
        // template is shipped bytes too: a worker-only change gets a new cache.
        const template = readFileSync(opts.template, 'utf8');
        const hash = createHash('sha256').update(template);
        for (const name of Object.keys(bundle).sort()) {
          const item = bundle[name]!;
          hash.update(name).update(item.type === 'chunk' ? item.code : item.source);
        }
        for (const name of publicFiles.sort()) {
          hash.update(name).update(readFileSync(join(publicDir, name)));
        }
        const source = renderWorker(
          template,
          cacheName(opts.version, hash.digest('hex')),
          urls,
        );
        if (!urls.includes('/')) this.error('sw.js would not precache the app page (/)');
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      },
    },
    writeBundle() {
      const missing = urls.filter((u) => !existsSync(join(outDir, u === '/' ? 'index.html' : u)));
      if (missing.length) {
        this.error(`sw.js precaches files the build did not write: ${missing.join(', ')}`);
      }
    },
  };
}
