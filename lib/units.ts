// Unit conversion -- the kg|lb display + entry layer (ADR-0010, folded from the
// retired RBAR-14; supersedes ADR-0006's display-only scope). Pure functions, no
// DOM (ADR-0001): the shell reads a canonical kg value and shows/enters it in the
// lifter's chosen Unit. kg stays the solver's internal Unit; lb rides on top here.
//
// Drawn from the design handoff engine (engine.js: LB / draftToKg / toLbWhole /
// stepFor), reviewed for fit. The exact factor is the kg-per-lb form (ADR-0006's
// 0.45359237) rather than the engine's reciprocal, so an entered whole-lb weight and the
// iron masses (also derived from it) agree to within the loader's epsilon -- floating
// point is not associative, so the residual drift is real but sub-1e-9 (decode's EPS),
// and the whole-lb readout rounds it away (see toLbWhole).

/** The Unit a weight is shown and entered in (CONTEXT.md). kg is canonical internally. */
export type Unit = 'kg' | 'lb';

/** Exact pounds-to-kilograms factor (ADR-0006): 1 lb = 0.45359237 kg. */
export const KG_PER_LB = 0.45359237;

/** Pounds to kilograms (exact). */
export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Kilograms to pounds (exact, unrounded). */
export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

/**
 * A kg weight as whole pounds -- the lb readout (ADR-0006: lb rounds to whole
 * pounds; the kg readout keeps up to two decimals). Totals on the iron set are
 * always a whole number of pounds (45 lb Bar + pairs of round-lb Plates), so this
 * never hides a real half-pound; iron Plate faces use their own `label`, not this.
 */
export function toLbWhole(kg: number): number {
  return Math.round(kgToLb(kg));
}

/**
 * The number to display for a canonical `kg` weight in `unit`: whole pounds in lb,
 * or kg trimmed to at most two decimals with trailing zeros stripped (so 60.50 ->
 * 60.5, 100.00 -> 100). The single rounding rule both readouts and the
 * displayed-unit-exactness check (the console) read from.
 */
export function shownIn(kg: number, unit: Unit): number {
  return unit === 'lb' ? toLbWhole(kg) : Number(kg.toFixed(2));
}

/**
 * Parse a `draft` entry string typed in `unit` to a canonical kg value, or null
 * when blank/whitespace/unparseable (never NaN -- preserves the entry contract that
 * an empty field reads as "no Target"). An lb draft converts with the exact factor;
 * a kg draft passes through. Tolerates a mid-entry trailing decimal ("142." -> 142).
 */
export function draftToKg(draft: string | null, unit: Unit): number | null {
  if (draft === null) return null;
  const s = draft.trim();
  if (s === '') return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return unit === 'lb' ? lbToKg(n) : n;
}

/**
 * The stepper increment in the display Unit: 5 lb (the universal US-gym nudge) or
 * 1 kg (the whole-kg achievable grid, ADR-0003). The steppers move by this in the
 * shown Unit; the keypad still types an exact value.
 */
export function stepFor(unit: Unit): number {
  return unit === 'lb' ? 5 : 1;
}

/** The "<n> <unit>" readout string for a canonical kg weight (e.g. "135 lb"). */
export function format(kg: number, unit: Unit): string {
  return `${shownIn(kg, unit)} ${unit}`;
}
