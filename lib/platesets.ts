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

/** A family of Plates the lifter loads: its Inventory, native Unit, and Bars. */
export interface PlateSet {
  readonly key: PlateSetKey;
  /** The lifter-facing name (Setup tile, fullscreen caption). */
  readonly label: string;
  /** A compact name for tight chrome -- the header Setup pill caption (RBAR-30). */
  readonly shortLabel: string;
  /** The Unit this set is stamped and reasoned in (its default display Unit, ADR-0010). */
  readonly unit: Unit;
  /**
   * Whether the display Unit is fixed to `unit`. The iron set is lb-only (an iron
   * rack has no kg reading), so it locks the kg|lb toggle; the Eleiko set leaves it
   * free, since a US lifter may want to READ a kg bar in pounds (ADR-0010). When
   * unlocked, `unit` is only the default -- the lifter's toggle choice wins.
   */
  readonly unitLocked: boolean;
  /** The Plates available to draw from (passed to decode/encode as the inventory). */
  readonly inventory: readonly Plate[];
  /** The Bars this set offers, in kg, default first. A Bar does not cross sets. */
  readonly bars: readonly number[];
  /** The Bar applied when this set is chosen (the first offered). */
  readonly defaultBarKg: number;
}

// The Training Bar: a 45 lb iron bar, in canonical kg via the exact factor (so its
// lb readout reads back exactly 45). The only Bar the iron set offers.
const TRAINING_BAR_KG = lbToKg(45);

export const PLATE_SETS: Record<PlateSetKey, PlateSet> = {
  comp: {
    key: 'comp',
    label: 'Competition',
    shortLabel: 'Comp',
    unit: 'kg',
    unitLocked: false,
    inventory: ELEIKO_KG,
    bars: [20, 15, 5],
    defaultBarKg: 20,
  },
  training: {
    key: 'training',
    label: 'Training',
    shortLabel: 'Training',
    unit: 'lb',
    unitLocked: true,
    inventory: IRON_LB,
    bars: [TRAINING_BAR_KG],
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
