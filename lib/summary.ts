// Loading summary -- the share card's text (RBAR-19, ADR-0011). Pure core (ADR-0001):
// it folds a snapshot of the current load into the per-Side Plate groups the card
// renders as colour chips and the ~3-line plain text the Copy button writes to the
// clipboard. Both the visible chips and the copied text derive from here, so they
// cannot drift. No DOM, no clipboard -- the element wires those.
//
// Plate faces stay the Plate's own stamp (`label ?? kg`): kg on the Eleiko set even
// when the display Unit is lb (the same kg-face-under-an-lb-readout convention the
// sleeve and palette use). The Total and config lines carry the Unit via `format`.
import type { Plate, PlateColor } from './plates.ts';
import { barWithCollars, totalKg } from './plates.ts';
import { format, shownIn, toLbWhole } from './units.ts';
import type { Unit } from './units.ts';

/**
 * A snapshot of the current load the card summarises (RBAR-19). All weights kg.
 * The Total is NOT stored -- it is derived from the rig + Side Load (`loadTotalKg`),
 * so the snapshot has no denormalized field that can contradict its own Plates.
 */
export interface LoadSummary {
  /** The Side Load -- the Plates on one Side, heaviest-first. */
  readonly side: readonly Plate[];
  /** The bare Bar, in kg (no Collars folded in). */
  readonly barKg: number;
  /** The per-Side Collar, in kg (0 = None). */
  readonly collarKg: number;
  /** The display Unit the Total and config read in; the secondary reads the other. */
  readonly unit: Unit;
}

/** The bare-bar stand-in shown on the per-Side line when nothing is loaded. */
export const BARE_BAR = 'Bare bar - no plates';

/**
 * The achieved Total for a snapshot: Bar + 2 x Collar + 2 x Side Load, via the
 * existing core (ADR-0002/0008). The single place the card's Total is computed --
 * the element and the plain text both read it, so they cannot disagree.
 */
export function loadTotalKg(s: LoadSummary): number {
  return totalKg(s.side, barWithCollars(s.barKg, s.collarKg));
}

/** A run of identical Plates on one Side: its face stamp, colour, and how many. */
export interface PlateGroup {
  /** The Plate's stamped face -- its lb `label` (iron) or its kg number (Eleiko). */
  readonly face: string;
  /** The Plate's colour, for the chip fill. */
  readonly color: PlateColor;
  /** How many of this Plate sit on the Side. */
  readonly count: number;
}

/** A Plate's face stamp: its lb `label` when it has one (iron), else its kg. */
function plateFace(p: Plate): string {
  return p.label ?? String(p.kg);
}

/**
 * Fold a heaviest-first Side Load into `count x face` groups (ADR-0011). Identical
 * Plates are adjacent in a Side Load, so a run-length pass over the list groups
 * them in order; a Plate is "the same" when its face and colour match.
 */
export function groupSide(side: readonly Plate[]): readonly PlateGroup[] {
  const groups: PlateGroup[] = [];
  for (const p of side) {
    const face = plateFace(p);
    const last = groups[groups.length - 1];
    if (last && last.face === face && last.color === p.color) {
      groups[groups.length - 1] = { ...last, count: last.count + 1 };
    } else {
      groups.push({ face, color: p.color, count: 1 });
    }
  }
  return groups;
}

/**
 * One per-Side group as `N x face` -- the count ALWAYS shows, singles included
 * (`1x 25`), so a glance never has to infer whether a bare face means one Plate
 * (RBAR-44, prototype L888). Exported so the card's chips and the plain text render
 * the group label from ONE place -- the "cannot drift" guarantee (ADR-0011) covers
 * the rendered label, not just the fold.
 *
 * 2026-06-29 (RBAR-27): this is the share/fullscreen card's flat label format. The
 * "On the bar" loaded chips (<rack-loaded>) deliberately do NOT use it -- they render a
 * styled face + `xN` suffix per the handoff (section 4b), a presentation a single flat
 * string cannot carry. Both still fold via `groupSide`, so the faces and counts cannot
 * drift; only the loaded chips' visual label format differs by design.
 */
export function groupText(g: PlateGroup): string {
  return `${g.count}x ${g.face}`;
}

/**
 * The rig-config line (RBAR-44, prototype L891): the Bar in BOTH Units plus the
 * plate-set name -- `20 kg / 44 lb bar - Competition` -- with the Collars appended
 * when fitted (an in-house addition the prototype lacks; the caption would otherwise
 * hide rig weight). Dual-unit is fixed kg-then-lb, so the line no longer takes a
 * display Unit. Shared by the plain text, the card caption (which appends "per
 * side"), and the fullscreen caption, so the config wording cannot drift.
 */
export function configText(barKg: number, collarKg: number, setLabel: string): string {
  const bar = `${shownIn(barKg, 'kg')} kg / ${toLbWhole(barKg)} lb bar`;
  const rig = collarKg > 0 ? `${bar}, collars ${format(collarKg, 'kg')}` : bar;
  return `${rig} - ${setLabel}`;
}

/**
 * The 3-line plain-text loading summary the Copy button writes (RBAR-19/44,
 * ADR-0011; prototype copyText L906):
 *
 *   rack.bar - 100 kg                       <- wordmark + Total (display Unit)
 *   Per side: 2x 25  1x 15                  <- groups, counts always, two-space join
 *   20 kg / 44 lb bar - Competition         <- the config caption the card shows
 *
 * The Total reads in `unit`; the config line is dual-unit by construction. The Total
 * is derived from the rig + Side Load (`loadTotalKg`), and the group label, bare-bar
 * text, and config all come from the shared helpers -- so the text and the card
 * cannot diverge. Plate faces are the Plate's own stamp; `setLabel` is the active
 * plate set's lifter-facing name (the element resolves it, `plateSetFor(key).label`).
 */
export function loadingSummary(s: LoadSummary, setLabel: string): string {
  const total = loadTotalKg(s);
  const head = `rack.bar - ${format(total, s.unit)}`;
  const perSide =
    s.side.length === 0
      ? BARE_BAR
      : `Per side: ${groupSide(s.side).map(groupText).join('  ')}`;
  return `${head}\n${perSide}\n${configText(s.barKg, s.collarKg, setLabel)}`;
}
