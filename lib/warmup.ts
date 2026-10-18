// The Warm up mode's view logic (RBAR-65 slice 2): everything the shell shows about a
// planned Ramp, as pure functions of its rows (ADR-0001). The planner (plan.ts,
// ADR-0015) decides which Side each row loads; this module only says how a row READS:
// its step name, the stairs' bar heights, what to add from the previous row, the status
// pill, whether Next is live, and the steps' accessible names. Every number carries
// its unit (Caitlin's "no loose numerals" rule): Totals in the display Unit, Plate faces
// in the set's stamped Unit.
//
// What changed between two rows is the stack moves the planner charges for
// (lib/moves.ts movesBetween, ADR-0015 as amended): everything outside the two Sides'
// longest common inside run comes off, outermost first, then the rest of the new Side
// goes on, inside to outside. Read literally, a caption rebuilds the next Side
// exactly; a set difference of the two Sides would not (15+1 -> 15+5+2.5+1 is "off 1,
// on 5 + 2.5 + 1", not "+5 +2.5", which would stack 15+1+5+2.5).
import type { Plate } from './plates.ts';
import type { RampRow } from './plan.ts';
import { movesBetween } from './moves.ts';
import { format, shownIn } from './units.ts';
import type { Unit } from './units.ts';

/** The Plates to take off and put on one Side to go from one row to the next. */
export interface SideDelta {
  /** Plates to take off, outermost first (the order they come off). */
  readonly off: readonly Plate[];
  /** Plates to put on, inside -> outside (the order they go on). */
  readonly on: readonly Plate[];
}

/** A Plate's stamped face: its lb `label` (iron) or its kg (Eleiko). */
const face = (p: Plate) => p.label ?? String(p.kg);

/** The moves from the previous row to row `i` (the first row loads from a bare Bar). */
export function rowDelta(rows: readonly RampRow[], i: number): SideDelta {
  const { off, on } = movesBetween(i > 0 ? rows[i - 1].side : [], rows[i].side);
  return { off, on };
}

/**
 * The short visible delta, unit once at the end, in the order the lifter does it:
 * "+15 kg", "+15 +2.5 kg", "-2.5 kg", "off 1, on 5 + 2.5 + 1 kg". Null when nothing
 * changes. `plateUnit` is the Unit the set's Plates are stamped in (a kg Eleiko 15
 * reads "+15 kg" even with lb on display).
 */
export function deltaText(d: SideDelta, plateUnit: Unit): string | null {
  const on = d.on.map(face);
  const off = d.off.map(face);
  if (on.length === 0 && off.length === 0) return null;
  if (off.length === 0) return `${on.map((f) => `+${f}`).join(' ')} ${plateUnit}`;
  if (on.length === 0) return `${off.map((f) => `-${f}`).join(' ')} ${plateUnit}`;
  return `off ${off.join(' + ')}, on ${on.join(' + ')} ${plateUnit}`;
}

const spokenUnit = (u: Unit) => (u === 'kg' ? 'kilograms' : 'pounds');

/**
 * The delta for speech, in the order the lifter does it: "add 15 and 2.5 kilograms per
 * side", "take off 1, then add 5 and 2.5 and 1 kilograms per side", or null when
 * nothing changes.
 */
export function deltaSpoken(d: SideDelta, plateUnit: Unit): string | null {
  const add = d.on.map(face).join(' and ');
  const off = d.off.map(face).join(' and ');
  const u = spokenUnit(plateUnit);
  if (add === '' && off === '') return null;
  if (off === '') return `add ${add} ${u} per side`;
  if (add === '') return `take off ${off} ${u} per side`;
  return `take off ${off}, then add ${add} ${u} per side`;
}

/**
 * A row's short step name under its stair: "Bar", "50%", "Work". A drifted Warm-up set
 * (`row.drift`: more than RAMP_BAND of the Working Total off its percentage, as the
 * Plates on hand can force, ADR-0016 as amended) names what it really loads instead,
 * with a tilde: "~83%" (RBAR-72 slice 3). Rounded, a drifted row never reads its own
 * step's percentage, so the tilde always marks a real difference.
 */
export function stepName(row: RampRow): string {
  if (row.kind === 'bar') return 'Bar';
  if (row.kind === 'working') return 'Work';
  if (row.drift) return `~${Math.round(row.realPct)}%`;
  return `${row.pct}%`;
}

/**
 * Each stair's bar height as a fraction of the tallest (the Working set): the loaded
 * Totals, so the shape of the stairs is the shape of the Ramp. In (0, 1]; the shell
 * keeps a minimum drawn height so a light bare-Bar stair stays tappable-looking.
 */
export function stepFractions(rows: readonly RampRow[]): number[] {
  const top = Math.max(...rows.map((r) => r.total));
  return rows.map((r) => (top > 0 ? r.total / top : 1));
}

/**
 * Where a key moves the stairs' selection from `i` among `n` steps: Left/Right one step
 * (stopping at the ends), Home/End to the first/last. Null for any other key, so the
 * shell leaves it alone.
 */
export function walkIndex(i: number, key: string, n: number): number | null {
  if (n <= 0) return null;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, i - 1);
    case 'ArrowRight':
      return Math.min(n - 1, i + 1);
    case 'Home':
      return 0;
    case 'End':
      return n - 1;
    default:
      return null;
  }
}

/** The Warm up status pill: its kind (styling) and plain-language copy. */
export interface WarmStatus {
  readonly kind: 'bare' | 'exact' | 'pct';
  readonly label: string;
}

/**
 * The status pill for a Ramp row, read off the DISPLAYED numbers (ADR-0010, ADR-0015
 * Q7): "Bare bar" on a bare-Bar row; "70% - exact" when the Total reads the same as the
 * percentage asked for; otherwise the real percentage of the Working Total, "71% of 140
 * kg". A Working row that is not exact -- rounded up past the Target (RBAR-87), or short
 * with nothing loadable above it (ADR-0003) -- returns null and the shell shows the By
 * Weight pill for its Total ("1 kg over", "3 kg short").
 */
export function warmStatus(row: RampRow, workingTotal: number, unit: Unit): WarmStatus | null {
  if (row.kind === 'bar') return { kind: 'bare', label: 'Bare bar' };
  if (shownIn(row.total, unit) === shownIn(row.targetKg, unit)) {
    return { kind: 'exact', label: `${row.pct}% - exact` };
  }
  if (row.kind === 'working') return null;
  return { kind: 'pct', label: `${Math.round(row.realPct)}% of ${format(workingTotal, unit)}` };
}

/** One stair, ready to render. */
export interface StepView {
  /** The short name under the stair ("Bar", "70%", "Work"). */
  readonly name: string;
  /** The Total above the stair: its number and its unit, rendered as a dim suffix. */
  readonly totalNum: string;
  readonly totalUnit: Unit;
  /** The stair's height as a fraction of the tallest. */
  readonly fraction: number;
  /** The accessible name: "Set 3 of 5, 70 percent, 100 kilograms, add 15 kilograms per side". */
  readonly label: string;
  readonly working: boolean;
}

/** Everything the Warm up block shows for a planned Ramp with row `selected` loaded. */
export interface WarmupView {
  readonly steps: readonly StepView[];
  readonly selected: number;
  /** The Next button, which always reads "Next" (RBAR-95): whether it is live. */
  readonly next: { readonly disabled: boolean };
  /** The accent add caption beside "per side" for the selected row, or null. */
  readonly addCaption: string | null;
}

function stepLabel(row: RampRow, i: number, n: number, unit: Unit, delta: string | null): string {
  const what =
    row.kind === 'bar'
      ? 'bare bar'
      : row.kind === 'working'
        ? 'working set'
        : row.drift
          ? `${row.pct} percent planned, about ${Math.round(row.realPct)} percent loaded`
          : `${row.pct} percent`;
  const parts = [`Set ${i + 1} of ${n}`, what, `${shownIn(row.total, unit)} ${spokenUnit(unit)}`];
  if (delta !== null && row.kind !== 'bar') parts.push(delta);
  return parts.join(', ');
}

/**
 * The whole Warm up view for `rows` with `selected` loaded, in display Unit `unit` with
 * Plates stamped in `plateUnit`. `selected` is clamped into the rows. The Next button
 * just reads "Next" (RBAR-95: the stairs and the add caption already say what comes and
 * what to load); it is disabled on the Working set.
 */
export function warmupView(
  rows: readonly RampRow[],
  selected: number,
  unit: Unit,
  plateUnit: Unit,
): WarmupView {
  const n = rows.length;
  const sel = Math.min(Math.max(0, selected), n - 1);
  const fractions = stepFractions(rows);
  const steps = rows.map((row, i) => ({
    name: stepName(row),
    totalNum: String(shownIn(row.total, unit)),
    totalUnit: unit,
    fraction: fractions[i],
    label: stepLabel(row, i, n, unit, deltaSpoken(rowDelta(rows, i), plateUnit)),
    working: row.kind === 'working',
  }));
  const next = { disabled: sel >= n - 1 };
  const addCaption =
    rows[sel].kind === 'bar' ? null : deltaText(rowDelta(rows, sel), plateUnit);
  return { steps, selected: sel, next, addCaption };
}
