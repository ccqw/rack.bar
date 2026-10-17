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
   list that drifts from the output fails `npm run build`, not the install. Install
   fetches every file with `cache: 'reload'`, straight from the network: GitHub Pages
   serves everything `max-age=600`, and an install inside that window would otherwise
   precache the PREVIOUS build's page from the browser's HTTP cache, pointing at hashed
   assets that are no longer in any cache or on the server.

3. **The cache is named for the version and the shipped bytes**:
   `rack-bar-v<package version>-<sha256 of the shipped files and the worker template,
   10 hex>`. Any change to any shipped file or to the worker -- even without a version
   bump -- changes `sw.js`, which is what
   makes the browser install a new worker. On activate the worker deletes every other
   `rack-bar-*` cache.

4. **Fetch strategy.** Same-origin GETs only; anything else goes to the network
   untouched.
   - Pages (navigations): network first, so an online lifter always gets the latest
     page, but raced against a 3 s timer: one bar of signal can hang a fetch for tens
     of seconds, and a lifter at the bar should not stare at a launch screen when the
     whole app is cached. Offline or too slow, the precached page is served: its path
     without the query string (`/index.html` read as `/`), else `/`.
   - Pages are never written to the cache. The only page in a cache is the one its own
     build precached, so the page always matches the hashed assets beside it; an
     online navigation under an older worker cannot put a newer page in its cache, and
     share-link query strings add no entries.
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
   `SKIP_WAITING`, and the page reloads once the new worker activates or takes
   control (or after 4 s, if it never reports back -- the tap asked for a reload). If
   the accepted worker turns redundant instead (a newer deploy replaced it), the newer
   waiting worker is offered again, or the page reloads onto the network's newest
   page. A worker already installing when registration resolves (the browser's own
   navigation-time check) is tracked too, so its offer is not missed. The app
   never reloads itself mid-set. A first install is not an update and shows nothing;
   the first install's `clients.claim()` changes the controller but does not reload.
   The app checks for a new version whenever it returns to the foreground (an
   installed app can stay open for days); offline that check fails quietly and the
   cached app carries on, while an online failure (a broken `sw.js` deploy) is logged.

7. **The Update button covers the wordmark.** At a phone width the header has no free
   space (wordmark + help icon left, Setup pill right), and anything in flow would
   cost the one-screen fit (ADR-0013). The button is fixed over the wordmark's box --
   the one header item the lifter never taps -- so it hides no control and never
   changes the page height. Accent fill and the Setup pill's type (11px: tokens.css
   has no type scale, so it is literal like the pill's), colours and radius through
   `--rack-*` tokens, no helper text. The 36px pill keeps a 44px tap target with an
   invisible layer. Screen readers hear "Update rack.bar", and its arrival is announced
   through a `role="status"` region ("A new version of rack.bar is ready.").

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
- Other open tabs (a Safari tab beside the Home Screen app) are not reloaded when one
  tab accepts: they keep running the old page under the new worker, with the old cache
  gone. Harmless while the app is one JS chunk; a future lazily loaded chunk (the game
  page) would need every client reloaded on `controllerchange` once any tab accepts.
- Kill switch: to remove the worker, ship a `sw.js` that, on install, calls
  `skipWaiting()`, and on activate deletes every `rack-bar-*` cache and calls
  `self.registration.unregister()`. Pages are network-first and worker update checks
  skip the HTTP cache, so every client picks it up on its next visit.
- GitHub Pages serves `sw.js` with `max-age=600`; browsers bypass the HTTP cache for
  worker update checks, so this does not delay updates.
- Not covered by CI: a real-browser offline run needs Playwright browsers in the
  workflow. The check was run by hand (PR RBAR-81): `npm run build && npx vite
  preview`, first visit until controlled, `context.setOffline(true)`, reload -- the
  app renders with both fonts; then a rebuilt `dist/` shows Update, does not reload
  on its own, and one tap reloads onto the new cache. iOS Home Screen still wants a
  human eyeball.

## 2026-10-17 -- the help icon is cut (RBAR-86)

The header's left side is now the wordmark alone (the Help popover and its "i" icon
were removed in RBAR-86). The Update button's placement is unchanged: it still sits
over the wordmark, positioned from the `.wordmark` rect.
