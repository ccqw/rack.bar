// By Weight's Plate moves caption (RBAR-83): when a new Target, a Recent, a stepper, a
// round-up or another way loads a new Side, the bar block says what to take off and
// put on to get there from the load before -- "off 1.25, on 2.5 + 2.5 kg" -- in Warm
// up's own words and order (lib/warmup.ts deltaText over lib/moves.ts movesBetween,
// ADR-0015 as amended). Read literally, the caption rebuilds the new Side from the
// previous one exactly. Pure (ADR-0001): the shell feeds each Side it renders through
// trackLoad and shows movesCaption; Decode still picks its loadout on its own (ADR-0003).
import type { Plate } from './plates.ts';
import { movesBetween } from './moves.ts';
import { deltaText } from './warmup.ts';
import type { Unit } from './units.ts';

type Side = readonly Plate[];

/** Where By Weight's caption measures from. */
export interface LoadTrack {
  /** The Side last seen, by identity: a new array is a new load (every solve and every
   *  way is one), a re-render of the same load is not. */
  readonly seen: Side | null;
  /** The settled load the next new load is measured from. It holds while the Target
   *  keypad is open, so mid-entry digits never become "the previous load". */
  readonly base: Side | null;
  /** The load the caption measures from right now; null shows no caption. */
  readonly from: Side | null;
}

/** Nothing tracked: outside By Weight, or before the first load. */
export const NO_TRACK: LoadTrack = { seen: null, base: null, from: null };

/**
 * Advance the track to the Side on the Bar now. `side` null means By Weight is not
 * showing (another mode), which forgets everything: entering By Weight never captions
 * the carried load. `editing` is true while the Target keypad is open.
 */
export function trackLoad(t: LoadTrack, side: Side | null, editing: boolean): LoadTrack {
  if (side === null) return NO_TRACK;
  if (t.seen === null) return { seen: side, base: side, from: null };
  if (side !== t.seen) return { seen: side, base: editing ? t.base : side, from: t.base };
  return editing ? t : { ...t, base: side };
}

/**
 * The caption for `side` under track `t`, in Plates stamped in `plateUnit`: null when
 * nothing was on the Bar before, when nothing is on it now, or when the Plates did not
 * change.
 */
export function movesCaption(t: LoadTrack, side: Side, plateUnit: Unit): string | null {
  if (t.from === null || t.from.length === 0 || side.length === 0) return null;
  return deltaText(movesBetween(t.from, side), plateUnit);
}
