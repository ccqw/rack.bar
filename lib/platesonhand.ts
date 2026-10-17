// Pairs of Plates on Hand -- the lifter's Plate limits, per Plate set (RBAR-72 slice 2,
// ADR-0016). Pure core (ADR-0001): the model, the pure updates, and the (de)serialization
// of the `rackbar.platesOnHand` key. The app shell owns the value and its persistence;
// Setup renders it; the solver sees it only as the capped Inventory `inventoryOnHand`
// builds (withLimits, lib/plates.ts).
//
// Stored as LIMITS, not a have-list: a size with no entry is All (unlimited), so a size
// a future Plate set adds starts available. One setting per Plate set, so a Training
// limit never touches Competition. Nothing expires.
import { plateFace, withLimits } from './plates.ts';
import type { InventoryEntry } from './plates.ts';
import { PLATE_SETS, PLATE_SET_KEYS } from './platesets.ts';
import type { PlateSetKey } from './platesets.ts';

/** The most pairs a limit can name; past it a size is All. Setup offers None, 1..4, All. */
export const MAX_PAIRS = 4;

/** The pair counts Setup offers, in order; `null` is All (no limit). */
export const PAIR_CHOICES: readonly (number | null)[] = [0, 1, 2, 3, 4, null];

/** One set's limits: a size's face (plateFace) -> pairs on hand, 0..MAX_PAIRS. A missing
 * face is All. */
export type PairLimits = Readonly<Record<string, number>>;

/** Every set's limits, by Plate set key. A missing set has no limits. */
export type PlatesOnHand = Readonly<Partial<Record<PlateSetKey, PairLimits>>>;

/** No limits anywhere: every size of every set is All. */
export const ALL_PLATES: PlatesOnHand = {};

/** A pair count a limit may hold: a whole number 0..MAX_PAIRS. */
export function isPairCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_PAIRS;
}

/** Whether `face` names a size in the set keyed `key`. */
export function isFaceOf(key: PlateSetKey, face: string): boolean {
  return PLATE_SETS[key].inventory.some((p) => plateFace(p) === face);
}

/** The pairs on hand of `face` in set `key`: a count, or null for All. */
export function pairsOf(onHand: PlatesOnHand, key: PlateSetKey, face: string): number | null {
  const limits = onHand[key];
  return limits !== undefined && Object.hasOwn(limits, face) ? limits[face] : null;
}

/** Whether set `key` has any limit at all. */
export function hasLimits(onHand: PlatesOnHand, key: PlateSetKey): boolean {
  const limits = onHand[key];
  return limits !== undefined && Object.keys(limits).length > 0;
}

/**
 * Set `face` of set `key` to `pairs` (null = All, which drops the entry). Pure; an
 * unknown face or a count outside 0..MAX_PAIRS changes nothing (the very same object
 * comes back), so a bad event can never store a bad limit.
 */
export function setPairs(
  onHand: PlatesOnHand,
  key: PlateSetKey,
  face: string,
  pairs: number | null,
): PlatesOnHand {
  if (!isFaceOf(key, face)) return onHand;
  if (pairs !== null && !isPairCount(pairs)) return onHand;
  if (pairsOf(onHand, key, face) === pairs) return onHand;
  const { [face]: _dropped, ...rest } = onHand[key] ?? {};
  const limits: PairLimits = pairs === null ? rest : { ...rest, [face]: pairs };
  return withSet(onHand, key, limits);
}

/** Every size of set `key` back to All; the other sets keep theirs. Pure. */
export function clearSet(onHand: PlatesOnHand, key: PlateSetKey): PlatesOnHand {
  return hasLimits(onHand, key) ? withSet(onHand, key, {}) : onHand;
}

// The map with set `key`'s limits replaced; an empty set is dropped, not stored.
function withSet(onHand: PlatesOnHand, key: PlateSetKey, limits: PairLimits): PlatesOnHand {
  const { [key]: _old, ...rest } = onHand;
  return Object.keys(limits).length > 0 ? { ...rest, [key]: limits } : rest;
}

/**
 * Set `key`'s Inventory with its limits applied (withLimits): what Decode, Round up and
 * the Warm up Ramp draw from, and what the By Plates palette badges. With no limits it is
 * the set's own Inventory array. Not forgiving: the input comes from parsePlatesOnHand or
 * setPairs, which already validate, so a face the set does not have or a bad count here
 * is a bug, and withLimits' RangeError says so rather than quietly reading it as All.
 */
export function inventoryOnHand(
  onHand: PlatesOnHand,
  key: PlateSetKey,
): readonly InventoryEntry[] {
  const base = PLATE_SETS[key].inventory;
  const limits = onHand[key];
  return limits === undefined || Object.keys(limits).length === 0
    ? base
    : withLimits(base, limits);
}

/** The `rackbar.platesOnHand` value: `{"comp":{"15":2,"0.5":0}}`. Sets without limits
 * are left out. */
export function serializePlatesOnHand(onHand: PlatesOnHand): string {
  const out: Record<string, PairLimits> = {};
  for (const key of PLATE_SET_KEYS) {
    if (hasLimits(onHand, key)) out[key] = onHand[key]!;
  }
  return JSON.stringify(out);
}

/**
 * Read the stored limits (ADR-0007: validate on read, never throw). Missing, unreadable
 * or malformed storage reads as All plates. Inside a well-formed value, each entry is
 * checked on its own: an unknown set, a face its set does not have, or a count that is
 * not a whole 0..MAX_PAIRS is dropped -- that size reads as All -- and the rest stand.
 */
export function parsePlatesOnHand(raw: string | null): PlatesOnHand {
  if (raw === null) return ALL_PLATES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ALL_PLATES;
  }
  if (!isRecord(parsed)) return ALL_PLATES;
  let onHand: PlatesOnHand = ALL_PLATES;
  for (const key of PLATE_SET_KEYS) {
    const limits = Object.hasOwn(parsed, key) ? parsed[key] : undefined;
    if (!isRecord(limits)) continue;
    for (const [face, n] of Object.entries(limits)) {
      if (isPairCount(n)) onHand = setPairs(onHand, key, face, n);
    }
  }
  return onHand;
}

// A plain JSON object (not null, not an array).
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** How a size's limit reads on its Setup tile: "all", "1 pair", "3 pairs", "none". */
export function pairsLabel(pairs: number | null): string {
  if (pairs === null) return 'all';
  if (pairs === 0) return 'none';
  return pairs === 1 ? '1 pair' : `${pairs} pairs`;
}
