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
import { format } from './units.ts';
import type { Unit } from './units.ts';

/** A snapshot of the current load the card summarises (RBAR-19). All weights kg. */
export interface LoadSummary {
  /** The achieved Total on the Bar (Bar + 2 x Collar + 2 x Side Load), in kg. */
  readonly totalKg: number;
  /** The Side Load -- the Plates on one Side, heaviest-first. */
  readonly side: readonly Plate[];
  /** The bare Bar, in kg (no Collars folded in). */
  readonly barKg: number;
  /** The per-Side Collar, in kg (0 = None). */
  readonly collarKg: number;
  /** The display Unit the Total and config read in; the secondary reads the other. */
  readonly unit: Unit;
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

/** One per-Side group as `N x face`, or just `face` when there is a single Plate. */
function groupText(g: PlateGroup): string {
  return g.count > 1 ? `${g.count}x ${g.face}` : g.face;
}

/**
 * The ~3-line plain-text loading summary the Copy button writes (RBAR-19, ADR-0011):
 *
 *   rack.bar 100 kg (220 lb)      <- wordmark + Total (display Unit) + secondary
 *   Per side: 2x 25, 15           <- the Side Load grouped, or "Bare bar - no plates"
 *   Bar 20 kg, collars 2.5 kg     <- the rig config (Collars line omitted when None)
 *
 * Total and config read in `unit`; the secondary reads the other Unit. Plate faces
 * are the Plate's own stamp (no Unit suffix) -- the Total line carries the Unit.
 */
export function loadingSummary(s: LoadSummary): string {
  const other: Unit = s.unit === 'kg' ? 'lb' : 'kg';
  const head = `rack.bar ${format(s.totalKg, s.unit)} (${format(s.totalKg, other)})`;
  const perSide =
    s.side.length === 0
      ? 'Bare bar - no plates'
      : `Per side: ${groupSide(s.side).map(groupText).join(', ')}`;
  const config =
    s.collarKg > 0
      ? `Bar ${format(s.barKg, s.unit)}, collars ${format(s.collarKg, s.unit)}`
      : `Bar ${format(s.barKg, s.unit)}`;
  return `${head}\n${perSide}\n${config}`;
}
