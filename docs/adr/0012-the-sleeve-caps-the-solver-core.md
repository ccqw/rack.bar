# The Sleeve caps the solver core

A real Bar runs out of sleeve before it runs out of Plates. As of RBAR-31 the core
enforces that limit: `decode()` never returns a Side Load wider than the loadable
sleeve length, and Encode's `addPlate` refuses a Plate that will not fit. The
"Bar at capacity" state (RBAR-28) stops being a view-layer disclaimer over an
impossible answer and becomes a description of a Total the lifter can actually rack.

## The sleeve-length model: one constant, threaded as a parameter

The loadable length is a single constant, `SLEEVE_MM = 415` (lib/plates.ts), applied
to every Bar. Chosen over a per-Bar / per-plate-set length because:

- **It is the handoff's model.** The prototype's engine.js flags capacity against one
  `SLEEVE_MM = 415`; matching it keeps the flag thresholds identical to the design.
- **We have no authoritative per-Bar table.** The 5 kg technique Bar and the iron
  training Bar do have shorter sleeves in reality, but inventing millimetres would be
  false precision -- the ADR-0004 note already establishes that the mm values matter
  as a consistent scale, not as calibrated truth.
- **The extension is already paid for.** `decode()` and `addPlate` take the length as
  an optional trailing `sleeveMm` parameter (defaulting to `SLEEVE_MM`), the same
  parameterize-now-defer-the-UI shape as ADR-0002. When real per-Bar data lands, a
  Bar model (e.g. `PLATE_SETS[..].bars` growing from numbers into objects carrying
  `sleeveMm`) feeds the existing parameter; no signature change, no solver change.

A trailing optional parameter rather than a new mid-signature argument for the same
reason ADR-0008 folded collars into the bar baseline: every existing call site and
test keeps working unchanged.

Collar width is deliberately not modelled: collars clamp outside the Plate zone, the
handoff does not model them either, and `SLEEVE_MM` is read as the plate-loadable
length.

## How the cap works

- **Decode.** The greedy loader adds a Plate only if the Side's accumulated width
  plus that Plate stays within `sleeveMm` (shared `plateFitsMm` guard, lib/plates.ts).
  A denomination that no longer fits is skipped and the loader keeps trying narrower
  ones, so `primary` is the greatest Total that is both at-or-under the Target AND
  physically loadable. ADR-0003's never-overshoot contract is unchanged; only the
  meaning of "achievable" narrowed from "buildable from the Inventory" to "buildable
  AND fits the sleeve".
- **The round-up `over`.** The over step is re-filled under the same cap, and is
  included only when its Total still lands strictly above the Target. When the
  shortfall is caused by a full sleeve, the capped refill cannot exceed the Target,
  so `over` is absent from the core -- "no physical round-up exists" falls out of the
  math instead of being suppressed in the view (which is what RBAR-28 had to do over
  an uncapped core; that view suppression is now removed).
- **Encode.** `addPlate(side, plate)` returns the Side unchanged when the Plate does
  not fit the remaining length (mirroring `removePlate`'s no-op shape). The palette
  additionally disables keys that no longer fit, so the refusal is visible before the
  tap, not a silent nothing.

## Greedy stays the fast path; an exact search covers the binding band

Heaviest-first greedy is NOT always optimal once width constrains the fill, even
though kg-per-mm density decreases down both ladders: a heavy Plate can crowd out a
denser tail. Counterexample (found by the DP oracle during this slice): Side budget
163.5 kg -- greedy stacks a sixth red and can only reach 163 within 415 mm, while
5 x 25 + 20 + 15 + 2.5 + 1 lands 163.5 exactly in 413 mm. The iron ladder has wider
gaps (an eighth 45 lb blocks a 35 lb tail worth 25 lb more).

So the fill is two-tier:

- **Greedy fast path.** If the width guard never fired, this is the old canonical
  coin problem where greedy is optimal and fewest-Plate (ADR-0003); if greedy was
  width-blocked but still landed the budget exactly, nothing can beat it. Every
  realistic Target takes this path unchanged.
- **Bounded exact search** (branch-and-bound over denomination counts, heaviest
  first, counts descending) ONLY when greedy was width-blocked AND came up short --
  a sliver of extreme Targets (the cap first alters a result at a 349 kg comp
  Total). The admissible bound is
  min(kg remaining, densest-remaining-Plate x mm remaining); the first optimum found
  is the biggest-first canonical form, and the greedy incumbent survives ties, so
  uncapped behavior is byte-identical.

A DP oracle test (min-width-to-reach-sum) sweeps the binding region and locks the
fill against the true optimum -- the same regression shape ADR-0010 used for the
iron set. A future non-canonical custom Inventory revisits the loader (the standing
ADR-0003 caveat).

## What this narrows

- **ADR-0002 "unlimited Inventory":** pair COUNTS stay unlimited; the sleeve bounds
  how many fit. A dated note points here.
- **ADR-0003 "greatest achievable Total" / "always offer the round-up":** achievable
  now means physically loadable; the round-up is offered only when one physically
  exists. A dated note points here.
- **RBAR-28's `atSleeveCapacity` view helper** stays (the pill still needs the
  "cannot close the miss" reading) but now describes a Side the core itself produced,
  so the discs can no longer overflow the frame.
