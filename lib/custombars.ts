// Custom Bars -- the lifter's own gym Bars beside a Plate set's built-in ones (RBAR-76,
// ADR-0017). Pure core (ADR-0001): the stamp model, its validation, the list rules and
// the (de)serialization of the `rackbar.customBars` key. The app shell owns the list and
// its persistence; Setup renders it; the solver only ever sees the Bar's kg.
//
// A custom Bar is stored as its STAMP -- the number and Unit written on the Bar, as the
// lifter typed it -- not as kg. The kg is derived (lbToKg for lb), so the label never
// drifts: 35 lb is 15.87573295 kg, and re-deriving a label from that kg would read
// "15.88 kg" or a rounded lb. The stamp is the fact; the kg is arithmetic.
import { PLATE_SETS, PLATE_SET_KEYS } from './platesets.ts';
import type { Bar, PlateSet, PlateSetKey } from './platesets.ts';
import { format, isUnit, lbToKg } from './units.ts';
import type { Unit } from './units.ts';

/** A custom Bar as stamped: the number on the Bar and the Unit it is in. */
export interface BarStamp {
  readonly value: number;
  readonly unit: Unit;
}

/** The most custom Bars any one Plate set shows (newest last). A custom Bar weighing
 * what a set's own Bar weighs is no tile on that set, so it takes no slot there. */
export const MAX_CUSTOM_BARS = 3;

/** The heaviest stamp accepted, per Unit: 50 kg / 110 lb, past any real Bar (a 25 kg
 * squat bar, a 60 lb trap bar) but short of a typo like 200. */
export const CUSTOM_BAR_MAX: Readonly<Record<Unit, number>> = { kg: 50, lb: 110 };

// A plain decimal: digits with an optional fraction (`.5`, `15.9`, and a trailing dot,
// `35.`, easy to leave on a decimal pad). No sign, exponent or hex, all of which
// Number() would read. The decimals and the range are judged after, so each failure
// can say what is wrong.
const NUMBER_RE = /^(?:[0-9]+(?:\.([0-9]*))?|\.([0-9]+))$/;

/** Why typed text is not a stamp: not a plain number, more than 2 decimals, or outside
 * above 0 .. CUSTOM_BAR_MAX. */
export type StampError = 'format' | 'decimals' | 'range';

/** True for a stamp the app accepts: a Unit, a finite number above 0, at most the cap,
 * and at most 2 decimals. */
export function isValidStamp(s: BarStamp): boolean {
  return (
    isUnit(s.unit) &&
    Number.isFinite(s.value) &&
    s.value > 0 &&
    s.value <= CUSTOM_BAR_MAX[s.unit] &&
    Number(s.value.toFixed(2)) === s.value
  );
}

/** Read typed text (a comma decimal reads as a point) in `unit`: the stamp, or why it
 * is not one. */
export function readStamp(
  text: string,
  unit: Unit,
): { readonly stamp: BarStamp } | { readonly error: StampError } {
  const t = text.trim().replace(',', '.');
  const m = NUMBER_RE.exec(t);
  if (!m) return { error: 'format' };
  if ((m[1] ?? m[2] ?? '').length > 2) return { error: 'decimals' };
  const s = { value: Number(t), unit };
  return isValidStamp(s) ? { stamp: s } : { error: 'range' };
}

/** Parse typed text in `unit` to a valid stamp, or null (see readStamp for why). */
export function parseStampText(text: string, unit: Unit): BarStamp | null {
  const r = readStamp(text, unit);
  return 'stamp' in r ? r.stamp : null;
}

/** The stamp's true mass in kg: lb through the exact factor, kg as is. */
export function stampKg(s: BarStamp): number {
  return s.unit === 'lb' ? lbToKg(s.value) : s.value;
}

/** The stamp as written: "35 lb", "15.9 kg". */
export function stampLabel(s: BarStamp): string {
  return `${s.value} ${s.unit}`;
}

/** The Bar a stamp makes: its derived kg, its stamped Unit, and the stamp itself. */
export function stampBar(s: BarStamp): Bar {
  return { kg: stampKg(s), unit: s.unit, stamp: s.value };
}

/** A Bar's name: a custom Bar's stamp as typed, a built-in by its kg in its stamped
 * Unit (RBAR-63). */
export function barLabel(bar: Bar): string {
  return bar.stamp !== undefined ? `${bar.stamp} ${bar.unit}` : format(bar.kg, bar.unit);
}

/** How many of `list` the set keyed `key` shows as custom tiles: those that do not
 * weigh what one of its own Bars weighs (barsFor). */
export function visibleCustomCount(list: readonly BarStamp[], key: PlateSetKey): number {
  const own = PLATE_SETS[key].bars.map((b) => b.kg);
  return list.filter((s) => !own.includes(stampKg(s))).length;
}

/** The first set (in PLATE_SET_KEYS order) that would show more than `max` custom Bars
 * with `s` added, or null when every set has room. */
export function addRefusal(
  list: readonly BarStamp[],
  s: BarStamp,
  max: number = MAX_CUSTOM_BARS,
): PlateSetKey | null {
  const next = [...list, s];
  return PLATE_SET_KEYS.find((k) => visibleCustomCount(next, k) > max) ?? null;
}

/** Append `s` (newest last) when it is valid, weighs differently from every Bar in the
 * list, and no set would then show more than `max` custom Bars; else the list
 * unchanged. Pure. */
export function addCustomBar(
  list: readonly BarStamp[],
  s: BarStamp,
  max: number = MAX_CUSTOM_BARS,
): readonly BarStamp[] {
  if (!isValidStamp(s)) return list;
  const kg = stampKg(s);
  if (list.some((b) => stampKg(b) === kg)) return list;
  if (addRefusal(list, s, max) !== null) return list;
  return [...list, { value: s.value, unit: s.unit }];
}

/** The list without the Bar at `index` (unchanged when out of range). Pure. */
export function removeCustomBar(list: readonly BarStamp[], index: number): readonly BarStamp[] {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}

/** Undo a removal: put `s` back at `index` (clamped), under the same rules as an add.
 * Pure. */
export function restoreCustomBar(
  list: readonly BarStamp[],
  s: BarStamp,
  index: number,
  max: number = MAX_CUSTOM_BARS,
): readonly BarStamp[] {
  const added = addCustomBar(list, s, max);
  if (added === list) return list;
  const at = Math.min(Math.max(0, Math.trunc(index) || 0), list.length);
  return [...list.slice(0, at), added[added.length - 1]!, ...list.slice(at)];
}

/** The `rackbar.customBars` value for a list. */
export function serializeCustomBars(list: readonly BarStamp[]): string {
  return JSON.stringify(list.map((s) => ({ value: s.value, unit: s.unit })));
}

/**
 * Read the stored list (null when nothing is stored). A missing, malformed or non-array
 * value reads as no custom Bars; an entry that is not a valid stamp is dropped, and the
 * rest go through the same add rules (dedupe, cap). Never throws (ADR-0007).
 */
export function parseCustomBars(raw: string | null): readonly BarStamp[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  let list: readonly BarStamp[] = [];
  for (const e of parsed) {
    if (typeof e !== 'object' || e === null) continue;
    const { value, unit } = e as { value?: unknown; unit?: unknown };
    if (typeof value !== 'number' || typeof unit !== 'string' || !isUnit(unit)) continue;
    list = addCustomBar(list, { value, unit });
  }
  return list;
}

/**
 * The Bars Setup offers on `set`: the set's own (default first), then the custom Bars
 * in order. A custom Bar that weighs exactly what one of the set's Bars weighs is left
 * out on that set -- the built-in tile already stands for it.
 */
export function barsFor(set: PlateSet, customs: readonly BarStamp[]): readonly Bar[] {
  const own = set.bars.map((b) => b.kg);
  return [...set.bars, ...customs.map(stampBar).filter((b) => !own.includes(b.kg))];
}
