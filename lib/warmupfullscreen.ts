// The Warm up fullscreen view model (RBAR-85): what the fullscreen card shows for one
// Ramp row, read from a meter away and driven one-handed -- the set name, the moves
// line, and whether the big Next zone is live -- plus where a swipe goes. Pure (ADR-0001);
// every reading comes from lib/warmup.ts, so the card and the console say the same
// thing: the step name is stepName, the moves line is the console's add caption
// (deltaText of rowDelta), and Next is nextIndex, the console Next button's own rule.
import type { RampRow } from './plan.ts';
import { format } from './units.ts';
import type { Unit } from './units.ts';
import { deltaText, nextIndex, rowDelta, stepName } from './warmup.ts';

/** The Next zone: whether it is live, the row it loads, and that row's set name. */
export interface FullscreenNext {
  readonly live: boolean;
  /** The row Next selects, or null on the last row. */
  readonly to: number | null;
  /** The set name of that row ("90% - 103 kg"), or null on the last row. */
  readonly label: string | null;
}

/** Everything the Warm up fullscreen card shows for the selected row. */
export interface WarmupFullscreenView {
  /** The selected row, clamped into the Ramp (as warmupView clamps). */
  readonly index: number;
  readonly count: number;
  /** The set name: "70% - 80 kg", "Bar - 20 kg", "Work - 115 kg", "~83% - 100 kg". */
  readonly label: string;
  /** The row's planned reps, or null when the template sets none. */
  readonly reps: number | null;
  /**
   * The off/on moves from the previous row, the console's add caption ("+15 kg",
   * "off 1.5 + 2, on 15 kg"). Null on the bare-Bar row and when nothing changes.
   */
  readonly moves: string | null;
  readonly next: FullscreenNext;
}

/** A row's set name: its step name, then its Total in the display Unit ("70% - 80 kg"). */
export function setLabel(row: RampRow, unit: Unit): string {
  return `${stepName(row)} - ${format(row.total, unit)}`;
}

/**
 * The fullscreen card for `rows` with `selected` loaded, Totals in display Unit `unit`
 * and Plate faces in `plateUnit`. `selected` is clamped into the rows, exactly as
 * warmupView clamps it, so the card and the console always read the same row. An empty
 * Ramp is a caller error (the planner always returns the Working set).
 */
export function warmupFullscreenView(
  rows: readonly RampRow[],
  selected: number,
  unit: Unit,
  plateUnit: Unit,
): WarmupFullscreenView {
  const n = rows.length;
  if (n === 0) throw new RangeError('warmupFullscreenView: a Ramp has at least the Working set');
  const index = Math.min(Math.max(0, selected), n - 1);
  const row = rows[index];
  const to = nextIndex(index, n);
  return {
    index,
    count: n,
    label: setLabel(row, unit),
    reps: row.reps ?? null,
    moves: row.kind === 'bar' ? null : deltaText(rowDelta(rows, index), plateUnit),
    next: to === null
      ? { live: false, to: null, label: null }
      : { live: true, to, label: setLabel(rows[to], unit) },
  };
}

/** The shortest horizontal drag, in CSS px, that counts as a swipe. */
export const SWIPE_MIN_PX = 40;

export type SwipeDir = 'left' | 'right';

/**
 * A drag of `dx` by `dy` px read as a swipe: 'left' or 'right' when it travels at least
 * SWIPE_MIN_PX sideways and more sideways than up or down; otherwise null (a tap, a
 * scroll, or a non-finite reading).
 */
export function swipeDirection(dx: number, dy: number): SwipeDir | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'left' : 'right';
}

/**
 * Where a swipe moves the selection from `i` among `n` sets: left goes forward (the
 * next set slides in from the right, as Next does), right goes back; both stop at the
 * ends. The same steps the stairs' ArrowRight / ArrowLeft take (walkIndex).
 */
export function swipeIndex(i: number, dir: SwipeDir, n: number): number {
  if (n <= 0) return 0;
  const at = Math.min(Math.max(0, i), n - 1);
  return dir === 'left' ? Math.min(n - 1, at + 1) : Math.max(0, at - 1);
}
