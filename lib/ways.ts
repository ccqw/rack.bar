// Another way (RBAR-66): the other Side Loads that make the SAME Total. A Decode answer
// (the at-or-under primary, or the opt-in round-up, ADR-0003) is one stack of Plates;
// the lifter may want a different stack for the same weight -- the 15s are all on
// someone else's bar, or one pair of 25s is all there is. The ways are exactly the
// exact search's own ranking (lib/sideloads.ts sideLoads, ADR-0003 as amended by
// RBAR-69): every stack that reaches the same Side sum and fits the Sleeve (ADR-0012),
// within the Plate limits (ADR-0016), fewest Plates first, then heaviest-first -- so
// the first way IS the canonical stack Decode loads, and the rest follow by one rule.
// Never a different Total: a way only rearranges the Plates.
//
// Pure (ADR-0001): the console keeps which way is on the Bar; this only lists them.
import { SLEEVE_MM, sideLoadKg } from './plates.ts';
import type { InventoryEntry, Plate } from './plates.ts';
import { sideLoads } from './sideloads.ts';

/** The most ways offered for one Total: the canonical stack plus four more. */
export const MAX_WAYS = 5;

/**
 * The ways to load `side`'s Side sum on `inventory` under `sleeveMm`: up to MAX_WAYS
 * distinct heaviest-first stacks, in sideLoads rank order (fewest Plates, then
 * heaviest-first), each holding the Inventory's own Plate objects. For a canonical
 * `side` (any Decode primary or round-up) the first way is that very stack, Plate for
 * Plate. A bare Side has one way, the bare Bar. Never empty: should no stack reach the
 * sum (a `side` the Inventory cannot build -- not a Decode answer), the one way is
 * `side` itself. Throws, like sideLoads, only for malformed rig data.
 */
export function waysFor(
  side: readonly Plate[],
  inventory: readonly InventoryEntry[],
  sleeveMm: number = SLEEVE_MM,
): readonly (readonly Plate[])[] {
  const ways: (readonly Plate[])[] = [];
  for (const way of sideLoads(sideLoadKg(side), inventory, sleeveMm)) {
    ways.push(way);
    if (ways.length === MAX_WAYS) break;
  }
  return ways.length > 0 ? ways : [side];
}
