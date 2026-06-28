# rack.bar

Mobile-first barbell-loading tool (rack.bar). Enter a target weight, get the plates
for each side; an Encode mode and a future quiz/game mode drill the same skill.
Kilograms first (Eleiko colors). TypeScript + Vite, no backend, GitHub Pages.

## Commands

- `npm run dev` — Vite dev server
- `npm test` — Vitest (happy-dom), single run; `npm run test:watch` to watch
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — production build to `dist/`

## Map

- `lib/` — functional core: pure plate math (`plates.ts`); the `solve()` core lands here
- `elements/` — imperative shell: Web Components (`app.ts` is a scaffold placeholder)
- `tokens.css` — design tokens (`--rack-*`)
- `docs/adr/` — accepted decisions; read before changing anything architectural
- `docs/design-handoff/` -- authoritative Claude Design reference (RBAR-10 output):
  README spec, `--rb-*` design tokens, screenshots, prototype. Spec source for the
  design-pass build slices; not app code (excluded from tests)
- `CONTEXT.md` — the domain language. Read it before writing user-facing copy or
  naming anything new; it is the controlled vocabulary (Bar, Plate, Collar, Side Load,
  Target vs Total, Plate set, Decode/Encode) with per-term Avoid lists.
- `ROADMAP.md` -- v1 scope and the parked features (finite inventory, entry math,
  game mode); reconciled to `docs/design-handoff/` on 2026-06-28, which pulled
  pounds plates and bar selection into v1

## Invariants

- Core/shell split (ADR-0001): plate logic goes in `lib/` as pure, tested functions;
  elements only wire DOM to it.
- The solver is `solve(target, bar, inventory)` (ADR-0002): Bar and Inventory are
  first-class inputs (defaults 20 kg, unlimited Eleiko set). v1 now exposes Bar
  selection and adds optional collars to the Total; finite-Inventory UI stays deferred.
- Decode never overshoots the Target by default (ADR-0003); a closer over-Target
  loadout is offered as an explicit opt-in only.
- Style through `--rack-*` tokens, not hard-coded values; elements use Shadow DOM.
- happy-dom can't see rendering — visual changes also need a human eyeball on
  `npm run dev`.

## Process

- Issue tracker is **Linear** (team `rack.bar`, code `RBAR-*`), not GitHub Issues.
  Label convention mirrors the c0ffee project. PRs squash-merge to `main`.
