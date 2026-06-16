# Static MPA on GitHub Pages, inheriting the c0ffee stack

We build **rack.bar** as a backend-free static **multi-page app** (each page its
own hand-authored `index.html` / future `game.html`), deployed to GitHub Pages at
the `rack.bar` custom domain (a `CNAME` file, like c0ffee's),
reusing the c0ffee architecture wholesale: TypeScript + Vite (MPA mode) + Vitest
(happy-dom), a functional core in `lib/` (the pure solver and plate model) and an
imperative shell of Web Components in `elements/` (the bar graphic, the keypad),
styled only through CSS design tokens.

We chose MPA over an SPA because the v1 calculator and the deferred game mode share
*components* (imported as code) but never share *live in-memory state*, so a
client-side router would be pure overhead. Writing Vite's multi-entry config from
the start (one entry now) makes adding the game page additive rather than a
restructure. Inheriting a proven sibling repo's stack also means its conventions
and ADRs transfer directly.
