// Saved maxes (RBAR-84, ADR-0020): the lifter's named one-rep maxes ("Squat 140 kg"),
// so a Target can be entered as a percentage of one ("80% Squat" -> 112 kg). Pure value
// transforms over a small list (ADR-0001); the shell (<rack-app>) persists it under its
// own `rackbar.maxes` key and feeds it down, like every other piece of lifter state.
//
// A max keeps the number and the Unit it was typed in (Caitlin, 2026-10-17): "185 lb"
// stays 185 lb when the lifter reads in kg (shown as 83.9 kg), so switching the Primary
// unit back and forth never drifts it. Its weight in kg is derived, never stored.
import { lbToKg, kgToLb } from './units.ts';
import type { Unit } from './units.ts';

/** One saved max: a lift's name and its weight as typed. */
export interface Max {
  readonly name: string;
  readonly value: number;
  readonly unit: Unit;
}

/** The most maxes kept (the keypad's lift row scrolls past four). */
export const MAX_LIFTS = 6;

/** The names offered as one-tap chips when adding a lift; anything else is Custom. */
export const PRESET_LIFTS: readonly string[] = ['Squat', 'Bench', 'Deadlift', 'Press'];

/** The longest lift name, after trimming. */
export const MAX_NAME_LENGTH = 14;

/** The largest percent the keypad takes ("105%" for a heavy single is real; 150 is a cap
 * against a slipped digit, as in the prototype). */
export const MAX_PERCENT = 150;

/** The largest max value, in its own Unit (the keypad types at most five digits). */
export const MAX_VALUE = 9999.99;

/** Why a max cannot be added, or null when it can. */
export type MaxRefusal = 'name' | 'value' | 'taken' | 'full';

// Values are kept to two decimals, the precision the keypad and the readouts carry.
const toStored = (n: number): number => Number(n.toFixed(2));

/** A lift name as stored: trimmed, inner whitespace collapsed, cut to MAX_NAME_LENGTH. */
export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH).trim();
}

/** True for a max weight worth keeping: finite, above 0 at stored precision, at most
 * MAX_VALUE. */
export function isMaxValue(value: number): boolean {
  return Number.isFinite(value) && toStored(value) > 0 && value <= MAX_VALUE;
}

/** True for a percent the keypad takes: finite, above 0, at most MAX_PERCENT. */
export function isPercent(pct: number): boolean {
  return Number.isFinite(pct) && pct > 0 && pct <= MAX_PERCENT;
}

/** The max's weight in canonical kg (unrounded: an lb max converts exactly). */
export function maxKg(max: Max): number {
  return max.unit === 'lb' ? lbToKg(max.value) : max.value;
}

/**
 * The Target `pct` percent of `max` makes, in canonical kg. The share is kept to two
 * decimals in the max's own Unit (80% of 185 lb is 148 lb, then converted exactly), as a
 * typed Target would be. Null for a percent the keypad does not take. Decode then lands
 * at or under it as usual (ADR-0003); this never rounds to a loadable weight.
 */
export function percentOfMax(max: Max, pct: number): number | null {
  if (!isPercent(pct)) return null;
  const share = toStored((max.value * pct) / 100);
  return max.unit === 'lb' ? lbToKg(share) : share;
}

/**
 * The number to show for `max` in `unit`: its own value, as typed, when the Units match;
 * otherwise converted to one decimal (185 lb reads 83.9 kg; 140 kg reads 308.6 lb).
 */
export function maxShown(max: Max, unit: Unit): number {
  if (max.unit === unit) return toStored(max.value);
  const v = unit === 'kg' ? lbToKg(max.value) : kgToLb(max.value);
  return Number(v.toFixed(1));
}

/** The index of the max named `name` (case-insensitive), or -1. */
export function findMax(list: readonly Max[], name: string): number {
  const key = cleanName(name).toLowerCase();
  return list.findIndex((m) => m.name.toLowerCase() === key);
}

/** Why `name` at `value` cannot join `list`, or null when it can. */
export function addRefusal(list: readonly Max[], name: string, value: number): MaxRefusal | null {
  if (cleanName(name) === '') return 'name';
  if (!isMaxValue(value)) return 'value';
  if (findMax(list, name) !== -1) return 'taken';
  if (list.length >= MAX_LIFTS) return 'full';
  return null;
}

/** Append a new max (at the end of the row). A refused add returns an equal list. Pure. */
export function addMax(
  list: readonly Max[],
  name: string,
  value: number,
  unit: Unit,
): readonly Max[] {
  if (addRefusal(list, name, value) !== null) return [...list];
  return [...list, { name: cleanName(name), value: toStored(value), unit }];
}

/**
 * Retype the max at `index` (a new PR): the name stays, the value and its Unit are the
 * new ones. An out-of-range index or a bad value returns an equal list. Pure.
 */
export function setMax(
  list: readonly Max[],
  index: number,
  value: number,
  unit: Unit,
): readonly Max[] {
  if (!Number.isInteger(index) || index < 0 || index >= list.length || !isMaxValue(value)) {
    return [...list];
  }
  return list.map((m, i) => (i === index ? { name: m.name, value: toStored(value), unit } : m));
}

/** Drop the max at `index`; the rest keep their order. Pure. */
export function removeMax(list: readonly Max[], index: number): readonly Max[] {
  return list.filter((_, i) => i !== index);
}

/**
 * Put a removed max back at `index` (Undo): the inverse of removeMax, so
 * restoreMax(removeMax(list, i), list[i], i) is the original list. The index is clamped
 * into the row. A max whose name the row already holds, an invalid one, or a full row
 * leaves the list as it is (Undo never duplicates or overfills). Pure.
 */
export function restoreMax(list: readonly Max[], max: Max, index: number): readonly Max[] {
  const clean = asMax(max);
  if (clean === null || findMax(list, clean.name) !== -1 || list.length >= MAX_LIFTS) {
    return [...list];
  }
  const at = Math.min(Math.max(0, Math.trunc(index) || 0), list.length);
  return [...list.slice(0, at), clean, ...list.slice(at)];
}

// One stored entry, validated: a clean non-empty name, a keepable value, a Unit.
function asMax(raw: unknown): Max | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, value, unit } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || typeof value !== 'number') return null;
  if (unit !== 'kg' && unit !== 'lb') return null;
  const n = cleanName(name);
  if (n === '' || !isMaxValue(value)) return null;
  return { name: n, value: toStored(value), unit };
}

/**
 * Parse the persisted maxes (the raw stored string, or null when nothing is stored).
 * A missing, malformed or non-array payload reads as no maxes; an invalid entry is
 * dropped; a repeated name keeps its first; the row is capped at MAX_LIFTS. Never
 * throws: a corrupt key degrades to a shorter list.
 */
export function parseMaxes(raw: string | null): readonly Max[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Max[] = [];
  for (const entry of parsed) {
    const m = asMax(entry);
    if (m !== null && findMax(out, m.name) === -1 && out.length < MAX_LIFTS) out.push(m);
  }
  return out;
}

/** The stored form of `list` (parseMaxes reads it back equal). */
export function serializeMaxes(list: readonly Max[]): string {
  return JSON.stringify(list.map(({ name, value, unit }) => ({ name, value, unit })));
}

/** Parse a percent typed on the keypad ("82.5"), or null when it is not one it takes. */
export function parsePercent(draft: string): number | null {
  const s = draft.trim();
  if (s === '') return null;
  const n = Number(s);
  return isPercent(n) ? n : null;
}
