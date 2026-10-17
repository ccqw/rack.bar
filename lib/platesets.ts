// Plate sets -- the core's notion of "which family of Plates is the lifter loading"
// (RBAR-17, ADR-0010). A Plate set is not just an Inventory: it bundles the
// Inventory, its native Unit, and the Bars it offers (with a default). The two v1
// sets are the kg Eleiko Competition set and the lb plain-iron Training set.
//
// This is pure reference data + a resolver (ADR-0001): the shell picks a set by key,
// reads its Inventory to decode/encode against and its native Unit + Bars to drive
// Setup, and the solver core stays kilograms internally (the Unit is a display
// concern resolved above the core, ADR-0010).
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import type { Plate } from './plates.ts';
import { lbToKg } from './units.ts';
import type { Unit } from './units.ts';

/** The plate sets v1 offers. `comp` is the default (kg Eleiko). */
export type PlateSetKey = 'comp' | 'training';

/**
 * A Bar a set offers: its true mass in kg (what the core solves with and what
 * `rackbar.barKg` persists) and the Unit it is stamped in -- the Unit its Setup tile
 * and the header pill name it in (RBAR-63). A Bar's stamp is a fact about the Bar,
 * not the set: the Training set's 20 kg Bar reads "20 kg", never "44 lb".
 */
export interface Bar {
  readonly kg: number;
  readonly unit: Unit;
  /** A custom Bar's stamp as typed, in `unit` (RBAR-76, lib/custombars.ts): its label,
   * so it never reads as a rounded conversion. Absent on a set's own Bars. */
  readonly stamp?: number;
}

/** A family of Plates the lifter loads: its Inventory, native Unit, and Bars. */
export interface PlateSet {
  readonly key: PlateSetKey;
  /** The lifter-facing name (Setup tile, fullscreen caption). */
  readonly label: string;
  /** A compact name for tight chrome -- the header Setup pill caption (RBAR-30). */
  readonly shortLabel: string;
  /**
   * The Unit this set's Plates are stamped in (the iron faces), and the fallback for
   * naming a Bar the set does not offer (each offered Bar carries its own stamp,
   * RBAR-63). It never drives the display Unit: the kg|lb toggle is the lifter's on
   * every set (RBAR-60, amending ADR-0010).
   */
  readonly unit: Unit;
  /** The Plates available to draw from (passed to decode/encode as the inventory). */
  readonly inventory: readonly Plate[];
  /** The Bars this set offers, default first. A choice does not cross sets: a set
   * switch always lands on the new set's default, even for a weight both offer. */
  readonly bars: readonly Bar[];
  /** The Bar applied when this set is chosen (the first offered). */
  readonly defaultBarKg: number;
}

// The Training default Bar: a 45 lb iron bar, in canonical kg via the exact factor (so
// its lb readout reads back exactly 45). Beside it the set offers a 20 kg Bar (RBAR-63):
// many bars sold as "45 lb" are really 20 kg (the IWF/Ohio-style bar), and the 0.41 kg
// gap is real -- the lifter picks the Bar they own rather than the app rounding one
// into the other.
const TRAINING_BAR_KG = lbToKg(45);

export const PLATE_SETS: Record<PlateSetKey, PlateSet> = {
  comp: {
    key: 'comp',
    label: 'Competition',
    shortLabel: 'Comp',
    unit: 'kg',
    inventory: ELEIKO_KG,
    bars: [
      { kg: 20, unit: 'kg' },
      { kg: 15, unit: 'kg' },
      { kg: 5, unit: 'kg' },
    ],
    defaultBarKg: 20,
  },
  training: {
    key: 'training',
    label: 'Training',
    shortLabel: 'Training',
    unit: 'lb',
    inventory: IRON_LB,
    bars: [
      { kg: TRAINING_BAR_KG, unit: 'lb' },
      { kg: 20, unit: 'kg' },
    ],
    defaultBarKg: TRAINING_BAR_KG,
  },
};

/** The offered keys, default first -- the source of truth for "a valid plate set". */
export const PLATE_SET_KEYS: readonly PlateSetKey[] = ['comp', 'training'];

/** True when `key` is one of the offered sets -- the guard the shell boundary uses. */
export function isOfferedPlateSet(key: string): key is PlateSetKey {
  return (PLATE_SET_KEYS as readonly string[]).includes(key);
}

/**
 * Resolve a set by key, defaulting an unknown or corrupt key to Competition -- so a
 * legacy or tampered persisted value can never strand the lifter on no set (the
 * ADR-0007 validate-at-the-boundary pattern, here in the core resolver).
 */
export function plateSetFor(key: string): PlateSet {
  return isOfferedPlateSet(key) ? PLATE_SETS[key] : PLATE_SETS.comp;
}

/** The kg weights of the Bars `set` offers, default first -- the list a persisted or
 * chosen Bar validates against at the shell boundary (ADR-0007). */
export function offeredBarKgs(set: PlateSet): readonly number[] {
  return set.bars.map((b) => b.kg);
}

/** The Unit to name a `kg` Bar in: its own stamp when `set` offers it (RBAR-63), else
 * the set's Unit -- a total function, so a label never throws on an off-menu Bar. */
export function barUnit(set: PlateSet, kg: number): Unit {
  return set.bars.find((b) => b.kg === kg)?.unit ?? set.unit;
}
