import { resolve } from 'node:path';
import { defineConfig, configDefaults } from 'vitest/config';

// rack.bar is a static multi-page app (ADR-0001): each page is its own
// hand-authored document. v1 ships a single entry (the calculator); the deferred
// game mode (ROADMAP) becomes a second entry here, sharing lib/ and elements/.
// Listing entries from the start makes adding the game page additive, not a
// restructure.
const root = import.meta.dirname;

export default defineConfig({
  appType: 'mpa', // distinct documents, not a single-page app with a router
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
    // docs/design-handoff/ is the authoritative Claude Design reference package
    // (RBAR-10 output), not part of the app -- its bundled engine.test.js is the
    // prototype's own contract file and must not run in our suite.
    exclude: [...configDefaults.exclude, 'docs/**'],
  },
});
