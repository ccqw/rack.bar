---
name: ship-slice-rack-bar
description: rack.bar's adapted end-to-end slice pipeline -- read a Linear ticket, spec via ADR, TDD with Vitest + happy-dom, sequential audit, ollama peer review, squash-merge, set Linear Done, tag the release. Use when shipping a rack.bar slice ("/ship-slice-rack-bar RBAR-N", "ship RBAR-N", "ship this slice") in the rack.bar repo. This is the project-local replacement for the generic ship-slice skill -- rack.bar uses Linear (not GitHub Issues), ADRs (not temper/DESIGN.md), and ollama-peer-review (not /peer-review).
---

# Ship a rack.bar slice

The generic `ship-slice` skill assumes GitHub Issues + temper + `/peer-review`. **rack.bar has none of those.** Follow the phases below instead. Stack: TypeScript + Vite + Vitest + happy-dom; pure functional core in `lib/`, custom-element shells in `elements/` (ADR-0001 core/shell split). Commands: `npm run dev|build|test|typecheck` (`npm test` == `vitest run`).

Tickets are **Linear team Rack Bar** (`RBAR-N`, project `rack.bar`), read via the linear MCP -- **never `gh issue`**. Decisions live in **ADRs** (`docs/adr/`), the glossary in **CONTEXT.md**.

## Pipeline (in order)

### 1 -- Read & understand
- `mcp__linear__get_issue RBAR-N` (+ `includeRelations:true`). If a **Blocked-by** issue is still open, stop and report.
- Read **CONTEXT.md** for domain vocabulary and the **ADRs** touching this area. Titles/descriptions/UI copy must use glossary terms (Bar, Plate, Side, Side Load, Target, Total, Inventory, Decode/Encode), never the Avoid words (barbell/rod, weight/disc, end, goal/working weight, sum/result, stock/supply, per-side weight).

### 2 -- Spec (ADR, not temper)
- If the slice makes a **real, hard-to-reverse architectural decision**, write or append an ADR (`docs/adr/000N-slug.md`). **Amend/supersede, don't rewrite history** -- dated notes, never silent edits.
- Most slices just **conform to an existing ADR**: 0001 static MPA + core/shell split, 0002 `solve(target, bar, inventory)` parameterized solver, 0003 Decode never overshoots by default, 0004 realistic side-on plate sizing. No DESIGN.md, no `temper verify`.

### 3 -- TDD (red -> green, Vitest)
- **Write failing tests first**, then `npm test` to confirm **red**. If green without code, the test is too weak.
- **Pure core** (`lib/plates.ts`, the `solve()` core) -> unit tests (input -> output, assert behavior not internals). Reuse the existing plate model (`ELEIKO_KG`, `sideLoadKg`, `totalKg`) -- do not duplicate it.
- **Element/shell behavior** -> **happy-dom shell test** (`elements/*.test.ts`): mount the element, assert the contract + the interaction path. The shell is unit-testable directly; don't extract logic into pure functions *just* to test it (that tests implementation).
- Implement -> full suite **green** (`npm test`), `npm run typecheck` clean.

### 4 -- Browser-verify (the body)
- Serve with **`npm run dev`** (Vite transpiles the `.ts` imports). **NOT `python3 -m http.server`** -- it serves raw TypeScript and the page breaks.
- chrome-MCP pass: load the page, assert render + interactivity + **zero console errors**. happy-dom can't see rendering, so any visual slice (sleeve, plate discs, sizing, tokens) needs a real eyeball here.
- **rAF gotcha:** any `requestAnimationFrame`-driven behavior is **paused in a backgrounded automation tab** (`document.hidden === true`). Spy on the call (monkeypatch + assert it's invoked with the right value), don't assert the painted result.

### 5 -- Commit & PR
- Branch `rbar-N-slug` (Linear's suggested `gitBranchName` is fine). Commit message ends with the Claude `Co-Authored-By` trailer (whatever model is driving -- don't pin a stale model name here).
- **Reference `RBAR-N`** in the body -- **never `closes #N`** (GitHub doesn't know Linear issue numbers; PR# and RBAR-N drift apart -- trust the number `gh pr create` returns).
- DoR-style PR body: `## Summary` (>=30 words), `## Test plan` (>=3 checkboxes incl. the browser pass), `Size: XS|S|M|L`, `## Out of scope`, and `Refs RBAR-N`.
- **PR CI gates the merge**: `ci.yml` runs typecheck + tests + build on every PR; `deploy.yml` re-runs the same gate on `push: branches:[main]` before publishing to Pages. Still run **local `npm run typecheck && npm test && npm run build` before pushing** -- CI is the enforcement, not an excuse to push red.

### 6 -- Audit (sequential)
- Run **`/audit`** stages **one at a time**, each seeing prior findings (the cumulative context is the value -- never parallel). Fix HIGH/CRITICAL, commit fixes (new commit, don't amend).
- **Right-size:** for a pure rename / docs / config slice, skip the heavy 8-stage sweep and say why (it finds ~nothing). Scale rigor to blast radius.

### 7 -- Peer review (ollama, not /peer-review)
- Use the **`ollama-peer-review`** skill (`/peer-review` is **not installed** here). Host `100.78.49.57:11434`, model **`gemma4:31b`** (set `OLLAMA_MODEL=gemma4:31b`; the skill's `gemma3:27b` default is NOT on the box). Allow a cold-load minute or two if the model isn't already resident.
- **Triage hard** -- these models hallucinate (`qwen` especially: it has returned a confident `BLOCK` built entirely on invented bugs). gemma4:31b is the trusted default reviewer but not infallible. Cross-check every finding against the diff before acting.
- Skip for XS / docs-only.

### 8 -- Merge (mind the classifier)
- **Wait for CI green first:** `gh pr checks <N> --watch` must pass before the serve-and-eyeball + merge ask. A red check = fix and push, don't ask.
- **Bring it up on the dev server FIRST, then ask.** Before requesting merge approval, start `npm run dev` (background) on the feature branch and hand Caitlin the local URL to look at -- the calculator page plus any relevant state (e.g. a specific Target typed in). She will almost always want to *see* the slice in the real app before approving, so make serving-it part of the merge ask, not a thing she has to request. Keep the server running until the merge is done.
- **Caitlin approves the merge** ("the code looks great, approved" counts). Don't auto-merge.
- **CLASSIFIER GOTCHA -- each external action is its OWN turn, after a plain verifying read.** Never bundle PR-create + merge + Linear-Done + verification into one batch -- the auto-mode safety classifier reads it as fabrication.
  - Turn A: `gh pr merge N --squash --delete-branch`.
  - Turn B: verify it landed (`gh pr view N --json state,mergedAt`), resync local `main` (`git fetch && git reset --hard origin/main` -- `gh pr merge` squashes on the server and often leaves local `main` behind, sometimes failing its own fast-forward; the squash commit on `origin/main` is the source of truth), confirm the **deploy** run succeeded (`gh run watch ...` -- deploy IS the post-merge gate), then set the Linear issue **Done** (`mcp__linear__save_issue id:RBAR-N state:Done`).

### 9 -- Tag the release (semver)
- **Every behavioral slice gets a version.** After the merge lands on `main`, bump `package.json` `version` and create an **annotated** git tag, then `git push origin main --follow-tags`.
- **0.x rules** (pre-1.0, the calculator contract isn't frozen): a **feature** slice -> **minor** (`0.2.0`->`0.3.0`); a **bugfix** slice -> **patch** (`0.3.0`->`0.3.1`). Breaking changes also land as a minor while in 0.x. We hit `1.0.0` only when Caitlin freezes the public contract.
- Invariant: **`package.json` version == the tag on that commit.** **`main` is branch-protected (PR-required) -- you CANNOT push the bump straight to `main`** (it is rejected with "repository rule violations"; this is where the c0ffee skill's "tiny chore commit straight to main" does NOT transfer). Instead: open a small `chore: vX.Y.Z` PR carrying only the `package.json` bump, let CI pass, squash-merge it, then `git fetch && git reset --hard origin/main` and tag **the merged commit** (`git tag -a vX.Y.Z <merged-sha>`), `git push origin vX.Y.Z`. Tag pushes are NOT blocked, only branch pushes. Tag message = a short human changelog of what shipped.
- **GitHub Releases only at milestones** (a meaningful chunk, e.g. "v1 calculator complete"), not per slice -- `gh release create vX.Y.0 --notes "..."`. Tags are the per-slice record; Releases are the user-facing moments.
- **Tags so far:** `v0.1.0` = the scaffold baseline (anchored on the scaffold commit `ee0ae5e`); `v0.2.0` = the RBAR-2 Decode walking skeleton. Next behavioral slice -> `v0.3.0` (feature) or a patch if it's a bugfix.

### 10 -- Recommend next
- List open `ready-for-agent` Linear issues (project `rack.bar`) whose blockers are now closed; recommend the highest-leverage / smallest unblocked one.

## Conventions worth not relearning
- **Demo-page hygiene:** a `*-demo.html` may ship to prod only if unlinked **and** paired with a removal ticket filed at creation. No orphaned demos.
- **Branch off `main`, squash-merge, delete branch.** Keep `main` deployable.
- **One slice = one Linear issue = one PR = one version tag.**
- **Style through `--rack-*` tokens, not hard-coded values; elements use Shadow DOM** (ADR-0001).
- **Semver per slice** (see step 9): bump `package.json` + annotated tag; minor=feature, patch=bugfix in 0.x; `gh release` only at milestones.
