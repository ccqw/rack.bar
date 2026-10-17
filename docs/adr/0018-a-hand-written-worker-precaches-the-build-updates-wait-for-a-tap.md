# A hand-written worker precaches the build; updates wait for a tap

RBAR-81 (2026-10-17). RBAR-71 made rack.bar installable, but with no service worker an
installed app opened in a basement gym with no signal shows a blank screen. The app is
fully static (ADR-0001) and has no backend, so everything it needs can live on the
phone.

## Decision

1. **A hand-written worker, generated at build time, no new dependencies.** The
   template is `scripts/sw.js` (plain JS, ~70 lines). A small Vite plugin
   (`scripts/offline.ts`, build only) lists what the build ships -- the bundle's
   emitted files plus the copied `public/` files -- and fills in the precache list and
   cache name (`scripts/precache.ts`, pure and unit-tested), emitting `dist/sw.js`.
   vite-plugin-pwa (Workbox) was not taken: it adds a large dependency tree for what is
   a one-page precache, and its update prompts would still need our own UI.

2. **The precache list is the build output.** Every page is cached by its URL
   (`index.html` as `/`; a future `game.html` as itself), plus every hashed asset,
   icon, font and the web manifest. Deploy plumbing (`CNAME`, `.nojekyll`), the worker
   itself, source maps and `.vite/` metadata are left out. After writing, the build
   checks every precached URL is a real file in `dist/` and that `/` is listed, so a
   list that drifts from the output fails `npm run build`, not the install.

3. **The cache is named for the version and the shipped bytes**:
   `rack-bar-v<package version>-<sha256 of the shipped files, 10 hex>`. Any change to
   any shipped file -- even without a version bump -- changes `sw.js`, which is what
   makes the browser install a new worker. On activate the worker deletes every other
   `rack-bar-*` cache.

4. **Fetch strategy.** Same-origin GETs only; anything else goes to the network
   untouched.
   - Pages (navigations): network first, so an online lifter always gets the latest
     page; offline, the cached page (ignoring the query string) or else `/`.
   - Everything else: cache first. Built assets are content-hashed, so a cached copy is
     never stale; a miss goes to the network and is kept.
   - Matches ignore `Vary`: the module script and font preloads are `crossorigin`
     requests carrying an `Origin` header that the precache request did not, and a
     server answering `Vary: Origin` (Vite preview does) would make every lookup miss.
     Our static files never vary by request header.

5. **Fonts are already self-hosted** (RBAR-23: two variable woff2 in `public/fonts/`,
   no Google Fonts request anywhere), so they are simply precached with everything
   else. No runtime font cache and no cross-origin caching are needed.

6. **Updates wait for the lifter.** A new worker installs and precaches in the
   background, then waits (no `skipWaiting` on install). The page shows one quiet
   **Update** button (`<rack-update>`, `elements/update.ts`); only a tap sends
   `SKIP_WAITING`, and the page reloads once the new worker has taken control. The app
   never reloads itself mid-set. A first install is not an update and shows nothing;
   the first install's `clients.claim()` changes the controller but does not reload.
   The app checks for a new version whenever it returns to the foreground (an
   installed app can stay open for days); offline that check fails quietly and the
   cached app carries on.

7. **The Update button covers the wordmark.** At a phone width the header has no free
   space (wordmark + help icon left, Setup pill right), and anything in flow would
   cost the one-screen fit (ADR-0013). The button is fixed over the wordmark's box --
   the one header item the lifter never taps -- so it hides no control and never
   changes the page height. Accent fill, the pill's type, no helper text, `--rack-*`
   tokens only.

8. **Registration runs in production builds only** (`import.meta.env.PROD`, after
   `load` so precaching never competes with first paint). The dev server has no
   `/sw.js` and tests drive `registerOffline()` with fakes, so neither registers a
   worker.

## Consequences

- An installed or bookmarked rack.bar opens and works with no signal after one online
  visit, fonts included. Share links opened offline load the app (the fragment never
  reaches the worker; a query string is ignored on the offline fallback).
- A deploy reaches an open app only through the Update tap or the next cold start
  (network-first pages); a stale page is never swapped out under the lifter.
- GitHub Pages serves `sw.js` with `max-age=600`; browsers bypass the HTTP cache for
  worker update checks, so this does not delay updates.
- Not covered by CI: a real-browser offline run needs Playwright browsers in the
  workflow. The check was run by hand (PR RBAR-81): `npm run build && npx vite
  preview`, first visit until controlled, `context.setOffline(true)`, reload -- the
  app renders with both fonts; then a rebuilt `dist/` shows Update, does not reload
  on its own, and one tap reloads onto the new cache. iOS Home Screen still wants a
  human eyeball.
