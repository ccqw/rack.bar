# rack.bar

A mobile-first tool for loading a barbell to a target weight in the gym. Tell it
the total you want; it tells you exactly which plates go on each side. Kilograms
first (Eleiko colors). A quiz/game mode that drills the same skill is planned.

Backend-free static site, deployed to GitHub Pages at **rack.bar**.

## Develop

```sh
npm install
npm run dev        # Vite dev server
npm test           # Vitest (happy-dom), single run
npm run typecheck  # tsc --noEmit
npm run build      # production build to dist/
```

## Layout

- `lib/` — functional core: pure plate math (`plates.ts`), the solver to come.
- `elements/` — imperative shell: Web Components (Shadow DOM, `--rack-*` tokens).
- `tokens.css` — design tokens.
- `CONTEXT.md` — the domain glossary. Read before naming anything user-facing.
- `ROADMAP.md` — what v1 is, and what's deliberately parked.
- `docs/adr/` — accepted decisions; read before changing anything architectural.
