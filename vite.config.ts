import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// rack.bar is a static multi-page app (ADR-0001): each page is its own
// hand-authored document. v1 ships a single entry (the calculator); the deferred
// game mode (ROADMAP) becomes a second entry here, sharing lib/ and elements/.
// Listing entries from the start makes adding the game page additive, not a
// restructure.
const root = import.meta.dirname;

export default defineConfig({
  appType: 'mpa', // distinct documents, not a single-page app with a router
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
  },
});
