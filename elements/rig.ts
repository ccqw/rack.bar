// The lifter's stored rig (ADR-0007): the plate set, the Bar, the Collar, the custom
// Bars and the Pairs of Plates on Hand, each under its own `rackbar.*` key. <rack-app>
// owns and writes them; the Loadout quiz page (RBAR-92) only reads them, so both pages
// load through these functions and validate the same way: a missing, blocked or
// off-menu value falls back to its default, never to a value no Setup tile matches.
import { DEFAULT_COLLAR_KG, isOfferedCollar } from '../lib/plates.ts';
import { isOfferedPlateSet, plateSetFor } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import { barsFor, parseCustomBars } from '../lib/custombars.ts';
import type { BarStamp } from '../lib/custombars.ts';
import { parsePlatesOnHand } from '../lib/platesonhand.ts';
import type { PlatesOnHand } from '../lib/platesonhand.ts';
import { readPersisted } from './persist.ts';

export const BAR_KEY = 'rackbar.barKg';
export const COLLAR_KEY = 'rackbar.collarKg';
export const PLATESET_KEY = 'rackbar.plateSet';
export const CUSTOM_BARS_KEY = 'rackbar.customBars';
// Pairs of Plates on Hand (RBAR-72, ADR-0016): every set's limits in one key.
export const PLATES_ON_HAND_KEY = 'rackbar.platesOnHand';

/** The stored plate set, or Competition (the default). */
export function loadPlateSet(): PlateSetKey {
  const raw = readPersisted(PLATESET_KEY);
  return raw !== null && isOfferedPlateSet(raw) ? raw : 'comp';
}

/** The stored custom Bars (RBAR-76, ADR-0017), validated. */
export function loadCustomBars(): readonly BarStamp[] {
  return parseCustomBars(readPersisted(CUSTOM_BARS_KEY));
}

/** The stored Bar, validated against the Bars `set` offers (its own, then the custom
 * ones); the set's default when it is missing or off the menu. */
export function loadBar(set: PlateSetKey, customBars: readonly BarStamp[]): number {
  const plateSet = plateSetFor(set);
  const raw = readPersisted(BAR_KEY);
  if (raw === null) return plateSet.defaultBarKg;
  const n = Number(raw);
  return barsFor(plateSet, customBars).some((b) => b.kg === n) ? n : plateSet.defaultBarKg;
}

/** The stored Collar, or None. */
export function loadCollar(): number {
  const raw = readPersisted(COLLAR_KEY);
  if (raw === null) return DEFAULT_COLLAR_KG;
  const n = Number(raw);
  return isOfferedCollar(n) ? n : DEFAULT_COLLAR_KG;
}

/** The stored Pairs of Plates on Hand, every set's. */
export function loadPlatesOnHand(): PlatesOnHand {
  return parsePlatesOnHand(readPersisted(PLATES_ON_HAND_KEY));
}

/** Everything Setup stores, read and validated together. */
export interface StoredRig {
  readonly set: PlateSetKey;
  readonly customBars: readonly BarStamp[];
  readonly barKg: number;
  readonly collarKg: number;
  readonly platesOnHand: PlatesOnHand;
}

export function loadRig(): StoredRig {
  const set = loadPlateSet();
  const customBars = loadCustomBars();
  return {
    set,
    customBars,
    barKg: loadBar(set, customBars),
    collarKg: loadCollar(),
    platesOnHand: loadPlatesOnHand(),
  };
}
