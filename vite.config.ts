import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, configDefaults } from 'vitest/config';
import { offline } from './scripts/offline.ts';

// rack.bar is a static multi-page app (ADR-0001): each page is its own
// hand-authored document. v1 ships a single entry (the calculator); the deferred
// game mode (ROADMAP) becomes a second entry here, sharing lib/ and elements/.
// Listing entries from the start makes adding the game page additive, not a
// restructure.
const root = import.meta.dirname;
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

export default defineConfig({
  appType: 'mpa', // distinct documents, not a single-page app with a router
  // RBAR-81 (ADR-0018): emit dist/sw.js precaching the build output. Build only.
  plugins: [offline({ version, template: resolve(root, 'scripts/sw.js') })],
  server: {
    // rack.bar's home port. Other local projects camp on Vite's 5173 default;
    // strictPort makes a collision fail loudly instead of silently drifting to
    // the next free port (so the dev URL is always http://localhost:5175/).
    port: 5175,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        // game: resolve(root, 'game.html'),  // future — see ROADMAP.md
      },
    },
  },
  test: {
    // Web Component shells get real DOM tests; the pure core in lib/ needs no
    // DOM but happy-dom is harmless there.
    environment: 'happy-dom',
    // happy-dom under Node does not provide localStorage; this installs a small
    // in-memory Storage so shell-side persistence (ADR-0007) is testable.
    setupFiles: ['./vitest.setup.ts'],
    // Each app mount keeps ~6 MB in happy-dom after it is removed (measured on main at
    // v0.39.0: rack-app 6.6 MB/mount, every element's shadow styles included), and the
    // link properties mount the app ~180 times in one file -- past Node's ~2 GB default
    // heap once RBAR-72 and RBAR-66 both land. Give the test workers room; RBAR-90
    // (faster, steadier tests) owns cutting the mounts.
    execArgv: ['--max-old-space-size=4096'],
    // docs/design-handoff/ is the authoritative Claude Design reference package
    // (RBAR-10 output), not part of the app -- its bundled engine.test.js is the
    // prototype's own contract file and must not run in our suite.
    // .claude/worktrees/ holds agent git worktrees (full repo copies); without
    // the deep glob their suites -- and their docs/engine.test.js -- run too.
    exclude: [...configDefaults.exclude, 'docs/**', '**/.claude/**'],
  },
});
