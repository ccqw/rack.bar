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
// Vitest's default test-file pattern, and the folders whose tests run without a DOM.
export const TEST_FILES = configDefaults.include[0]!;
export const CORE_DIRS = ['lib', 'scripts'];
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
    // Web Component shells get real DOM tests (the 'dom' project below); the pure
    // core's 'core' project overrides this with plain Node.
    environment: 'happy-dom',
    // happy-dom under Node does not provide localStorage; this installs a small
    // in-memory Storage so shell-side persistence (ADR-0007) is testable.
    setupFiles: ['./vitest.setup.ts'],
    // No heap override (RBAR-90): the "~6 MB kept per app mount" that once needed a 4 GB
    // heap was happy-dom's WeakRef query caches pinning every rendered tree until the
    // task ended. The setup file now ends the task after each test, and the heavy
    // properties after each run (nextRun, elements/properties.drivers.ts); the suite
    // passes in a 512 MB heap.
    // docs/design-handoff/ is the authoritative Claude Design reference package
    // (RBAR-10 output), not part of the app -- its bundled engine.test.js is the
    // prototype's own contract file and must not run in our suite.
    // .claude/worktrees/ holds agent git worktrees (full repo copies); without
    // the deep glob their suites -- and their docs/engine.test.js -- run too.
    exclude: [...configDefaults.exclude, 'docs/**', '**/.claude/**'],
    // RBAR-90: two projects. The pure core (lib/, ADR-0001) and the build scripts need
    // no DOM, so they run in plain Node and skip happy-dom's per-file window setup.
    // 'dom' is the catch-all on Vitest's default test pattern, minus the core's folders,
    // so a test file anywhere else (a new folder, a .js or .spec file) still runs.
    // Both inherit the root `exclude` (extends: true); scripts/projects.test.ts guards
    // the split.
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          include: CORE_DIRS.map((dir) => `${dir}/${TEST_FILES}`),
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          include: [TEST_FILES],
          exclude: CORE_DIRS.map((dir) => `${dir}/**`),
        },
      },
    ],
  },
});
