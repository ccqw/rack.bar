# rack.bar

Mobile-first barbell-loading tool (rack.bar). Enter a target weight, get the plates
for each side; an Encode mode and a future quiz/game mode drill the same skill.
Kilograms first (Eleiko colors). TypeScript + Vite, no backend, GitHub Pages.

## Commands

- `npm run dev` — Vite dev server
- `npm test` — Vitest (happy-dom), single run; `npm run test:watch` to watch
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — production build to `dist/`
- `npm run icons` -- re-render the app icons and favicon into `public/` after a redraw

## Map

- `lib/` — functional core: pure plate math (`plates.ts`); the solver core is
  `decode`/`decodeWithin` (`decode.ts`), choosing its Plates through the exact search in
  `sideloads.ts`
- `elements/` — imperative shell: Web Components. `app.ts` (`<rack-app>`) is the app shell
  and composition root (ADR-0007): header + Setup pill, `<rack-console>`, `<rack-setup>`,
  and the rig config it persists and feeds down
- `tokens.css` — design tokens (`--rack-*`)
- `scripts/fit-check.js` -- the phone-fit layout check (ADR-0013): a Playwright snippet
  run against the dev server that asserts no vertical scroll at the visible Safari viewports
- `assets/icons/` -- the icon masters (RBAR-71): `rack-bar-icon-dark.svg` feeds the
  Home Screen / manifest PNGs; `rack-bar-favicon-jumbo-{dark,light}.svg` (Caitlin's
  simplified tiny-size cut) feed `favicon.svg` (dark, light under the media query) and
  the 16/32/48 `favicon.ico`. `scripts/icons.mjs` renders them into `public/`; the
  outputs are committed
- `scripts/sw.js` + `scripts/offline.ts` + `scripts/precache.ts` -- the offline service
  worker (ADR-0018): a Vite build plugin fills the hand-written worker with the build's
  precache list; `elements/update.ts` registers it (production only) and offers Update
- `docs/adr/` — accepted decisions; read before changing anything architectural
- `docs/design-handoff/` -- authoritative Claude Design reference (RBAR-10 output):
  README spec, `--rb-*` design tokens, screenshots, prototype. Spec source for the
  design-pass build slices; not app code (excluded from tests)
- `CONTEXT.md` — the domain language. Read it before writing user-facing copy or
  naming anything new; it is the controlled vocabulary (Bar, Plate, Collar, Side Load,
  Target vs Total, Plate set, Decode/Encode) with per-term Avoid lists.
- `ROADMAP.md` -- v1 scope and the parked features (limits indicator, entry math,
  game mode); reconciled to `docs/design-handoff/` on 2026-06-28, which pulled
  pounds plates and bar selection into v1

## Invariants

- Core/shell split (ADR-0001): plate logic goes in `lib/` as pure, tested functions;
  elements only wire DOM to it.
- The solver is `decode(target, bar, inventory)` / `decodeWithin(target, ceiling, ...)`
  (ADR-0002, which sketched it as `solve()`): Bar and Inventory are
  first-class inputs (defaults 20 kg, unlimited Eleiko set). v1 now exposes Bar
  selection, optional collars, and Pairs of Plates on Hand (per-size Plate limits per
  Plate set, ADR-0016) in Setup.
- Decode never overshoots the Target by default (ADR-0003); a closer over-Target
  loadout is offered as an explicit opt-in only.
- Fewest Plates is exact on every Inventory (ADR-0003, amended by RBAR-69): Sleeve fit,
  then the greatest Total, then fewest Plates, then heaviest-first. Every loadout comes
  from `lib/sideloads.ts`; never reintroduce a greedy fill.
- Style through `--rack-*` tokens, not hard-coded values; elements use Shadow DOM.
- Invariant (property) tests live in `lib/properties.test.ts` (core, vs the ADR-derived
  oracle in `lib/properties.oracle.ts`) and `elements/*.properties.test.ts` (shell, via
  real input paths); add a property there for every new rule, named after it + its ADR.
- happy-dom can't see rendering — visual changes also need a human eyeball on
  `npm run dev`.

## Process

- Issue tracker is **Linear** (team `rack.bar`, code `RBAR-*`), not GitHub Issues.
  Label convention mirrors the c0ffee project. PRs squash-merge to `main`.
