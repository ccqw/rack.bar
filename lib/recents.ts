// Recent Targets -- the pure history logic behind the "Recent" chip row (RBAR-20).
// A small most-recent-first list of Targets the lifter has committed, so a working
// weight is one tap away. The list is the functional core's concern (ADR-0001): a
// pure value transform here, persisted and rendered by the shell (<rack-console>,
// ADR-0009). Targets are stored canonically in kilograms (ADR-0006); the chip row
// renders them in the Primary unit when that layer lands (RBAR-17).

/** The most Targets kept in the Recent row. Oldest fall off the end past this. */
export const MAX_RECENTS = 6;

/** True for a Target worth remembering: a real, loadable weight (finite and > 0). */
function isRememberable(target: number): boolean {
  return Number.isFinite(target) && target > 0;
}

/**
 * Push `target` onto the front of the history: dedupe (an already-held Target moves
 * to the front rather than duplicating), keep most-recent-first, and cap at `max`
 * (the oldest drops off). Dedupe happens before the cap, so re-touching a held
 * Target can never grow the list past the cap. A non-finite or non-positive Target
 * is ignored (the list is returned unchanged) -- those are never loadable weights.
 * Pure: the input list is never mutated.
 */
export function pushRecent(
  list: readonly number[],
  target: number,
  max: number = MAX_RECENTS,
): number[] {
  if (!isRememberable(target)) return [...list];
  return [target, ...list.filter((t) => t !== target)].slice(0, max);
}

/**
 * Parse the persisted history (the raw `localStorage` string, or null when nothing
 * is stored) into a clean list: a missing, malformed, or non-array payload reads as
 * empty, and individual entries that are not loadable weights are dropped, then the
 * survivors are deduped and capped exactly like a live push. Never throws -- a
 * corrupt or hand-edited key degrades to a shorter (or empty) history, never an
 * error into the shell.
 */
export function parseRecents(raw: string | null, max: number = MAX_RECENTS): number[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // Rebuild through pushRecent (in reverse, so the stored order survives) to reuse the
  // exact dedupe + cap the live path uses -- one definition of "a valid history".
  return parsed
    .filter((t): t is number => typeof t === 'number' && isRememberable(t))
    .reduceRight<number[]>((acc, t) => pushRecent(acc, t, max), []);
}
