# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Me-first: the maker's own training (kilograms, Eleiko competition plates) is the
persona that shapes decisions and the oracle for whether the tool feels right.
Deliberately widening: the product should evolve to serve lifters whose needs
differ from the maker's (lb-native gyms, home-gym inventories, different plate
cultures) as work continues -- me-first is a starting anchor, not a fence.

Situation: mid-session in the gym, on a phone, between sets. Attention is
divided, hands may be chalked or sweaty, and the answer needs to be glanceable
from the rack.

## Product Purpose

Load a barbell to a target weight without arithmetic mid-session. Two
directions: enter a Target and see the exact Plates to load on one Side
(Decode / "By Weight"), or tap Plates on and read the Total (Encode /
"By Plates"). A future game/quiz mode will drill the same skill.

Success is the tool being genuinely reached for in real sessions -- the maker's
own first -- not growth metrics.

## Positioning

Physical realism: the bar you see is the bar you rack. Real plate diameters,
a sleeve-capacity-capped solver that never proposes an unrackable load, collars
that count in the math, no phantom round-ups, and honest Target-vs-Total
divergence when a Target is not exactly buildable.

Origin fact: this was built to fill a felt gap -- the maker looked for a tool
like this and could not find one. The positioning is "the tool that finally
exists," not differentiation within a crowded field; do not write copy that
assumes a sea of competitors.

## Operating Context

- Phone in the gym, mid-session, between sets; often read at arm's length or
  glanced at from across the rack (the fullscreen rack card exists for this).
- Lifters name Plates by color ("throw a red on") -- color is domain
  vocabulary, not decoration.
- Loading is always symmetric pairs; the lifter reasons about one Side only.
- Sharing a loading with a training partner via a short emoji Plate list (share sheet or clipboard).

## Capabilities and Constraints

- v1 is the Decode/Encode calculator; scope and look-and-feel authority is the
  Claude Design handoff at `docs/design-handoff/` (see ROADMAP.md).
- Backend-free static site (GitHub Pages, rack.bar); no accounts, no server.
- Solver honors Bar weight, collars, Inventory, and sleeve capacity
  (ADR-0002, 0008, 0012); nearest at-or-under by default, over-Target opt-in
  (ADR-0003).
- Two Plate sets: Competition (Eleiko, kg-native) and Training (plain iron,
  lb-native); Unit is a display/entry system, not a different weight
  (ADR-0006, 0010).
- Terminology: CONTEXT.md is the controlled internal vocabulary (Bar, Plate,
  Side Load, Target vs Total, Decode/Encode). User-facing labels may diverge
  toward plain language (e.g. "By Weight" / "By Plates") -- the glossary is
  internal, not UI copy.
- Parked, deliberately: game/quiz mode, finite Inventory counts, math-on-entry
  (percentages for warm-up ramps). See ROADMAP.md "Later."

## Brand Commitments

- Eleiko competition color scheme for the kg Plate set -- domain-accurate
  colors, not a stylistic choice future work may drift.
- v1 look-and-feel must match the design handoff exactly; aesthetic changes
  route through a design pass, not build slices.

## Evidence on Hand

- Working product live at rack.bar (v0.30.0 at time of writing).
- Authoritative design handoff: `docs/design-handoff/` (RBAR-10 output,
  including engine reference and screenshots).
- Domain glossary: `CONTEXT.md`. Decisions: `docs/adr/`.
- No testimonials, user research, or usage data exist; do not fabricate any.

## Product Principles

1. The rendered bar is truthful -- dimensions, capacity, and math match the
   physical object; never show a loading that cannot be racked.
2. Glanceable under gym conditions -- divided attention, arm's length,
   chalked thumbs; no precision gestures, no reading required twice.
3. Target and Total stay honest -- when the ask is not buildable, say what was
   achieved and that it differs; never silently round.
4. Domain language inside, plain language outside -- CONTEXT.md governs code
   and docs; UI copy meets lifters where they are.
5. Me-first, then wider -- the maker's sessions are the oracle today, but
   decisions should not wall off lifters with different racks, units, or needs.

## Accessibility & Inclusion

Color is never the sole channel: Plate colors are domain vocabulary, but
weight numerals and shape must always disambiguate (colorblind lifters read
the same bar). Touch targets and interactions must work with sweaty or chalked
thumbs mid-session.
