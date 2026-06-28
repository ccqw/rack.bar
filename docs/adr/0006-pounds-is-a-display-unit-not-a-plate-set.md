# Pounds is a display unit, not a plate set

Kilograms stay the one canonical Unit. The solver core (`decode`/`encode`/`plates`),
the Eleiko Inventory, and every stored weight are kilograms and do not change.
Pounds is a **presentation layer** in the shell: it converts the lifter's entry into
kg before solving, and converts the kg results back for the readouts. The Plates
shown are always the kg Eleiko set -- only the numbers the lifter types and reads
change Unit.

This is deliberately **not** the parked "Pounds support" in ROADMAP.md, which is a
real lb plate set + lb bar so the shown Plates match a US gym's rack. That remains
parked. A converting layer serves a different lifter: one who _thinks_ in pounds but
trains on a kg/Eleiko bar (the v1 audience). Keeping kg canonical means the greedy
solver's correctness proof (a canonical coin system, ADR-0003) and the realistic mm
sizing (ADR-0004) are untouched -- pounds rides entirely on top.

## The lifter's model

A **Primary unit** (kg or lb) drives entry, the steppers, and the prominent readout;
the **Secondary unit** shows small alongside for reference and can be hidden, so a
lifter can read in just one Unit (CONTEXT.md). The Primary unit defaults to kg -- the
app's identity and canonical Unit -- and the choice (Primary unit + whether the
Secondary shows) persists per lifter in `localStorage`. This is the only persisted
state in the app; it lives in the shell, never the core.

Conversion uses the exact factor **1 lb = 0.45359237 kg** internally. The lb readout
is rounded to **whole pounds** (the kg readout is unchanged: up to two decimals,
trailing zeros stripped). When the Primary unit is lb the steppers nudge by **5 lb**
(the universal US-gym increment) instead of 1 kg; the keypad still types an exact
value in the Primary unit.

## Displayed-unit exactness

The "under target" note and the over-target round-up opt-in (ADR-0003) trigger off
the **rounded numbers the lifter actually reads**, not the raw kg delta. If the
displayed Total equals the displayed Target in the Primary unit, the Target is
treated as exact: both the delta note and the round-up control are hidden.

Why: the achievable Total grid is whole kilograms (~2.2 lb apart, ADR-0003), so a
target entered in pounds almost never lands on the kg grid. Keying the note and
opt-in off the raw kg delta would fire them on nearly every lb entry -- including when
the rounded lb Total already equals the lifter's target (e.g. enter 311 lb, get a
141 kg / "311 lb" bar that is 0.15 lb under) -- which is clutter and false precision
for a miss the lifter cannot feel or act on. Comparing the displayed numbers keeps
"exact / under / over" honest to what is on screen ("exact" means within half a
display Unit), and it is a strict generalization of the existing kg behavior: in kg
the displayed numbers already match the grid, so nothing changes there.

The trade is that the core's notion of exactness (kg `delta == 0`) and the shell's
notion (displayed numbers match) diverge once a conversion is in play. The core stays
the source of truth for _what_ the loadout is; the shell decides _whether the miss is
worth showing_. That split is intentional and lives entirely in the shell (ADR-0001).

## 2026-06-28 -- amended: pounds also becomes a real plate set (RBAR-17)

The authoritative Claude Design handoff (`docs/design-handoff/`) pulled the parked
"Pounds plate set" forward into v1. So the boundary this ADR drew -- "pounds is a
display unit, _not_ a plate set, and the lb plate set remains parked" -- no longer
holds as a v1 line. Both ship:

- This ADR's converting display + entry layer (kg canonical, RBAR-14) stays exactly
  as decided. It serves the lifter who _thinks_ in pounds on a kg/Eleiko bar.
- A real plain-iron lb Inventory + lb bar, chosen via a plate-set switch, ships
  alongside it (RBAR-17), for the lifter on a US iron rack. With the Training set
  chosen the solver runs natively in lb.

What this relaxes: kilograms is no longer the _sole_ canonical Unit -- each plate set
now carries its own native Unit and Inventory. A follow-up ADR (written in RBAR-17)
will record that model and how the plate-set switch reconciles with the kg|lb display
toggle (design intent: choosing a set forces its Unit). Until that ADR lands, the
decision recorded above governs the **Competition (kg/Eleiko) path only** and is not
superseded for it.
