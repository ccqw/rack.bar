// Recent Targets -- the pure history logic behind the "Recent" chip row (RBAR-20).
// A small most-recent-first list of Targets the lifter has committed, so a recent
// Target is one tap away. The list is the functional core's concern (ADR-0001): a
// pure value transform here, persisted and rendered by the shell (<rack-console>,
// ADR-0009). Targets are stored canonically in kilograms (ADR-0006); the chip row
// renders them in the Primary unit when that layer lands (RBAR-17).

import { MAX_TARGET_KG } from './link.ts';

/** The most Targets kept in the Recent row. Oldest fall off the end past this. */
export const MAX_RECENTS = 6;

/** True for a Target worth remembering: a real, loadable weight (finite and > 0). */
export function isRememberable(target: number): boolean {
  return Number.isFinite(target) && target > 0;
}

/**
 * Read a persisted Target (canonical kg): the one Target By Weight and Warm up share
 * (`rackbar.target`, RBAR-87), or the legacy Warm up `rackbar.working` value it migrates
 * from. Stored at full precision (String(kg)), so a reload reads back the same number.
 * Only a plain decimal (`String(kg)` of anything the keypad produces) is read: no sign,
 * exponent, hex or blank. Over MAX_TARGET_KG (the share link's cap, ADR-0014), zero, or
 * anything else reads as null (no Target), so a corrupt key can never reach the solver,
 * the planner or the field (ADR-0007).
 */
export function parseTarget(raw: string | null): number | null {
  if (raw === null) return null;
  const s = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return isRememberable(n) && n <= MAX_TARGET_KG ? n : null;
}

/**
 * The Target a reload restores (RBAR-87, ADR-0007): the stored `rackbar.target` value
 * when it is valid, else a valid legacy `rackbar.working` value (the one-time
 * migration), else null -- exactly as if neither key existed. Both raw values go through
 * parseTarget, the same check: a plain decimal, positive, finite and at most
 * MAX_TARGET_KG. So a corrupt, negative, zero or out-of-range value in EITHER key falls
 * back to no Target and never reaches the solver or the planner. An explicit valid
 * Target always wins over the legacy one.
 */
export function restoreTarget(storedRaw: string | null, legacyRaw: string | null): number | null {
  return parseTarget(storedRaw) ?? parseTarget(legacyRaw);
}

// Targets are kept to two decimals -- the precision the chip and every other readout
// display (fmtKg). Normalizing at the single store boundary keeps the stored value, the
// dedupe key, and the rendered label one and the same number, so a chip can never read
// "60.55 kg" yet re-apply 60.554, and two Targets that round alike can't both sit in the
// row (a corrupt or hand-edited key is cleaned the same way on load via parseRecents).
function toStoredKg(target: number): number {
  return Number(target.toFixed(2));
}

/**
 * Push `target` onto the front of the history: normalize to stored precision, dedupe
 * (an already-held Target moves to the front rather than duplicating), keep
 * most-recent-first, and cap at `max` (the oldest drops off). Dedupe happens before the
 * cap, so re-touching a held Target can never grow the list past the cap. A non-finite
 * or non-positive Target -- including a positive one that rounds to 0 at stored
 * precision -- is ignored (the list is returned unchanged): those are never loadable
 * weights. Pure: the input list is never mutated.
 */
export function pushRecent(
  list: readonly number[],
  target: number,
  max: number = MAX_RECENTS,
): readonly number[] {
  // Judged AFTER normalizing (RBAR-62): a positive Target under half a hundredth
  // (0.004) stores as 0, which is not a loadable weight -- it must not become a chip.
  const kg = toStoredKg(target);
  if (!isRememberable(kg)) return [...list];
  return [kg, ...list.filter((t) => t !== kg)].slice(0, Math.max(0, max));
}

/**
 * Parse the persisted history (the raw `localStorage` string, or null when nothing
 * is stored) into a clean list: a missing, malformed, or non-array payload reads as
 * empty, and individual entries that are not loadable weights are dropped, then the
 * survivors are deduped and capped exactly like a live push. Never throws -- a
 * corrupt or hand-edited key degrades to a shorter (or empty) history, never an
 * error into the shell.
 */
export function parseRecents(
  raw: string | null,
  max: number = MAX_RECENTS,
): readonly number[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // Rebuild through pushRecent (in reverse, so the stored order survives) to reuse the
  // exact normalize + dedupe + cap the live path uses -- one definition of "a valid
  // history", so even a corrupt over-precise or duplicate-laden key loads clean.
  return parsed
    .filter((t): t is number => typeof t === 'number' && isRememberable(t))
    .reduceRight<readonly number[]>((acc, t) => pushRecent(acc, t, max), []);
}

/**
 * Remove `target` from the history (RBAR-73): the long-press / Delete-key removal. The
 * Target is matched at stored precision (the same key pushRecent dedupes on), so the
 * chip's own data value always finds its entry. The rest of the row keeps its order;
 * removing a Target that is not held returns an equal list. Removal can only shrink a
 * valid row, so it stays capped, deduped and rememberable. Pure: never mutates.
 */
export function removeRecent(list: readonly number[], target: number): readonly number[] {
  const kg = toStoredKg(target);
  return list.filter((t) => t !== kg);
}

/**
 * Put a removed Target back at `index` (RBAR-73 Undo, "restores it in place"): the
 * inverse of removeRecent, so restoreRecent(removeRecent(list, t), t, list.indexOf(t))
 * is the original list. The index is clamped into the row (a negative or past-the-end
 * index lands at the front or the back). A Target the row already holds is left where
 * it is (Undo never duplicates), a non-loadable one is ignored (as pushRecent), and the
 * result is capped at `max` like every other write. Pure: never mutates.
 */
export function restoreRecent(
  list: readonly number[],
  target: number,
  index: number,
  max: number = MAX_RECENTS,
): readonly number[] {
  const kg = toStoredKg(target);
  if (!isRememberable(kg) || list.includes(kg)) return [...list];
  const at = Math.min(Math.max(0, Math.trunc(index) || 0), list.length);
  return [...list.slice(0, at), kg, ...list.slice(at)].slice(0, Math.max(0, max));
}
