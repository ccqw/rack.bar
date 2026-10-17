// Share links -- the load in a versioned URL fragment (RBAR-50, ADR-0014). Pure core
// (ADR-0001): serialize a load to the fragment text and parse it back, with no DOM,
// no `location`, no storage. The shells (slice 2: <rack-app> for the rig, the console
// for the load) apply a parsed link; the console builds the outgoing URL (slice 3).
//
// The v1 grammar is `key=value` pairs joined by `&`, written in this fixed order:
//
//   v  format version            `1`                                  required
//   s  Plate set                 `comp` | `training`                  required
//   b  Bar, by its stamp         `20kg` `15kg` `5kg` | `45lb` `20kg`  required, one the set offers
//   m  mode                      `w` (By Weight) | `p` (By Plates)    required
//   c  Collar per Side, kg       `0` | `2.5`                          default 0
//   u  display Unit              `kg` | `lb`                          default: the caller's
//   p  Side Load, heaviest first `2x25,10,2.5` (`Nx` when N > 1)      default: bare Bar
//   t  Target, kg, 2 dp          finite, > 0, <= MAX_TARGET_KG        only with m=w
//
// Bars and Plates travel by their STAMP, not their kg: the iron masses are irrational
// in kg (45 lb = 20.41165665 kg), the stamp is exact and readable, and the Plate set
// disambiguates `25` (Eleiko kg) from `25` (iron lb). The Target and Collar are
// kg-canonical, as Recents are (ADR-0009). Every value is an allowlisted token or a
// bounded decimal, so nothing needs percent-encoding.
//
// The parser is all-or-nothing: any rejected field nulls the whole link, so a mangled
// link degrades to a normal boot, never a half-applied one. Unknown keys are ignored,
// so a later additive v1 field does not break this client; a breaking change bumps `v`.
import {
  DEFAULT_COLLAR_KG,
  isOfferedCollar,
  plateFitsMm,
} from './plates.ts';
import type { CollarKg, Plate } from './plates.ts';
import { PLATE_SETS, isOfferedPlateSet } from './platesets.ts';
import type { Bar, PlateSet, PlateSetKey } from './platesets.ts';
import { groupSide, SHARE_LINK } from './summary.ts';
import { toLbWhole } from './units.ts';
import type { Unit } from './units.ts';

/** The console's two modes: By Weight (decode) and By Plates (encode). */
export type LinkMode = 'decode' | 'encode';

/**
 * A load a share link carries (ADR-0014). The Side Load is the source of truth (the
 * sender's screen); a By Weight link also carries the Target so the recipient's entry
 * reads the same. Every Plate in `side` is the set's own Inventory object.
 */
export interface LinkState {
  readonly set: PlateSetKey;
  /** The bare Bar, kg -- one of `PLATE_SETS[set].bars`. */
  readonly barKg: number;
  readonly collarKg: CollarKg;
  /** The display Unit the sender was reading in. */
  readonly unit: Unit;
  readonly mode: LinkMode;
  /** The Side Load, heaviest-first, within the Sleeve. */
  readonly side: readonly Plate[];
  /** The Target, kg at 2 dp. Present only in decode mode, and optional there. */
  readonly targetKg?: number;
}

/** The longest fragment the parser reads; longer is rejected before any splitting.
 * A Sleeve full of the narrowest Plates still serializes well under 150 chars. */
export const MAX_LINK_LENGTH = 512;

/** The heaviest Target a link may carry, kg (the same order as a sleeve-full Total). */
export const MAX_TARGET_KG = 1000;

/** The only format version this client writes. Parsing an older `v` stays supported
 * forever once a v2 exists (ADR-0014); today v1 is the only one. */
const VERSION = '1';

// The wire tokens for each mode.
const MODE_TOKEN: Record<LinkMode, string> = { decode: 'w', encode: 'p' };

// The most of one Plate a single `Nx` group may claim (1..99, no leading zero).
const COUNT_RE = /^([1-9][0-9]?)x(.+)$/;

// A plain non-negative decimal: no sign, no exponent, no hex, no blank (Number('')
// is 0, Number('0x10') is 16 -- neither may sneak past as a weight).
const DECIMAL_RE = /^[0-9]+(\.[0-9]+)?$/;

/** A Bar's stamp: its whole-lb reading for an lb-stamped Bar, else its kg. */
function barStamp(bar: Bar): string {
  return bar.unit === 'lb' ? `${toLbWhole(bar.kg)}lb` : `${bar.kg}kg`;
}

/** A Plate's face stamp: its lb `label` (iron) or its kg (Eleiko) -- the same face
 * the share card and summary print (groupSide). */
function plateFace(p: Plate): string {
  return p.label ?? String(p.kg);
}

/** The Target as it travels: kg at 2 dp, the precision Recents store (ADR-0009). */
function toLinkKg(kg: number): number {
  return Number(kg.toFixed(2));
}

/**
 * Serialize a load to its canonical v1 fragment (no leading `#`). Always writes
 * `c`, `u` and `p`; writes `t` only for a decode-mode state that has a Target. The
 * Bar is named by the set's stamp for `barKg`; a state that violates its own
 * invariants (an off-menu Bar) still serializes -- by the set's Unit -- and the
 * parser will reject it, so a bad state can never round-trip into a good-looking one.
 */
export function serializeLink(state: LinkState): string {
  const set = PLATE_SETS[state.set];
  const bar = set.bars.find((b) => b.kg === state.barKg) ?? {
    kg: state.barKg,
    unit: set.unit,
  };
  const plates = groupSide(state.side)
    .map((g) => (g.count > 1 ? `${g.count}x${g.face}` : g.face))
    .join(',');
  const pairs = [
    `v=${VERSION}`,
    `s=${state.set}`,
    `b=${barStamp(bar)}`,
    `m=${MODE_TOKEN[state.mode]}`,
    `c=${state.collarKg}`,
    `u=${state.unit}`,
    `p=${plates}`,
  ];
  if (state.mode === 'decode' && state.targetKg !== undefined) {
    pairs.push(`t=${toLinkKg(state.targetKg)}`);
  }
  return pairs.join('&');
}

/** The full share URL for a load: the one site origin (SHARE_LINK) + `/#` + fragment. */
export function linkUrl(state: LinkState): string {
  return `${SHARE_LINK}/#${serializeLink(state)}`;
}

// The keys v1 reads. Any other key is ignored (forward-compatible additive fields).
const KNOWN_KEYS: ReadonlySet<string> = new Set(['v', 's', 'b', 'm', 'c', 'u', 'p', 't']);

/** Split `k=v&k=v` into a map, or null on a duplicate key (known or not) or a known
 * key with no `=`. Empty segments (a trailing `&`) are skipped; a valueless unknown
 * segment is ignored like any unknown key. */
function splitPairs(fragment: string): Map<string, string> | null {
  const pairs = new Map<string, string>();
  const seen = new Set<string>();
  for (const seg of fragment.split('&')) {
    if (seg === '') continue;
    const eq = seg.indexOf('=');
    const key = eq === -1 ? seg : seg.slice(0, eq);
    if (seen.has(key)) return null;
    seen.add(key);
    if (!KNOWN_KEYS.has(key)) continue;
    if (eq === -1) return null;
    pairs.set(key, seg.slice(eq + 1));
  }
  return pairs;
}

/** Parse the `p` value against `set`'s Inventory into a heaviest-first Side Load that
 * fits the Sleeve, or null. */
function parseSide(value: string, set: PlateSet): readonly Plate[] | null {
  if (value === '') return [];
  const counts = new Map<Plate, number>();
  for (const token of value.split(',')) {
    const m = COUNT_RE.exec(token);
    const face = m ? m[2]! : token;
    const n = m ? Number(m[1]) : 1;
    const plate = set.inventory.find((p) => plateFace(p) === face);
    if (!plate) return null;
    counts.set(plate, (counts.get(plate) ?? 0) + n);
  }
  // Rebuild heaviest-first in Inventory order (each Inventory is heaviest-first), then
  // walk it through the one ADR-0012 fit comparison; the first Plate that overflows
  // rejects the link, so the walk is bounded by the Sleeve, not by the counts.
  const side: Plate[] = [];
  let usedMm = 0;
  for (const plate of set.inventory) {
    const n = counts.get(plate) ?? 0;
    for (let i = 0; i < n; i++) {
      if (!plateFitsMm(usedMm, plate)) return null;
      usedMm += plate.widthMm;
      side.push(plate);
    }
  }
  return side;
}

/** Parse `t` to kg at 2 dp, or null when not a plain decimal or outside (0, cap]. */
function parseTarget(value: string): number | null {
  if (!DECIMAL_RE.test(value)) return null;
  const kg = toLinkKg(Number(value));
  return Number.isFinite(kg) && kg > 0 && kg <= MAX_TARGET_KG ? kg : null;
}

/**
 * Parse a share-link fragment (with or without its leading `#`) to a load, or null.
 * All-or-nothing (ADR-0014): null on a fragment over MAX_LINK_LENGTH, malformed
 * percent-encoding, a missing or non-`1` `v`, any duplicate key, an unoffered set /
 * Bar stamp / Collar / Unit / mode / Plate face, a count outside 1..99, a Side Load
 * past the Sleeve, or a `t` that is present with `m=p`, not a plain decimal, <= 0 at
 * 2 dp, or over MAX_TARGET_KG. Unknown keys are ignored; Plates are re-sorted
 * heaviest-first. A missing `c` is None, a missing `p` the bare Bar, and a missing `u`
 * is `defaultUnit` -- the recipient's own Unit, which the shell passes in. Never throws.
 */
export function parseLink(fragment: string, defaultUnit: Unit = 'kg'): LinkState | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (raw.length > MAX_LINK_LENGTH) return null;
  let text: string;
  try {
    // A messenger may percent-encode the separators (`,` -> `%2C`); every legitimate
    // value is plain ASCII, so decoding once and then allowlisting is safe.
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const pairs = splitPairs(text);
  if (!pairs) return null;

  if (pairs.get('v') !== VERSION) return null;

  const setKey = pairs.get('s');
  if (setKey === undefined || !isOfferedPlateSet(setKey)) return null;
  const set = PLATE_SETS[setKey];

  const barToken = pairs.get('b');
  const bar = set.bars.find((b) => barStamp(b) === barToken);
  if (!bar) return null;

  const modeToken = pairs.get('m');
  const mode: LinkMode | null =
    modeToken === MODE_TOKEN.decode ? 'decode' : modeToken === MODE_TOKEN.encode ? 'encode' : null;
  if (!mode) return null;

  const collarToken = pairs.get('c');
  let collarKg: CollarKg = DEFAULT_COLLAR_KG;
  if (collarToken !== undefined) {
    const n = DECIMAL_RE.test(collarToken) ? Number(collarToken) : NaN;
    if (!isOfferedCollar(n)) return null;
    collarKg = n;
  }

  const unitToken = pairs.get('u');
  let unit: Unit = defaultUnit;
  if (unitToken !== undefined) {
    if (unitToken !== 'kg' && unitToken !== 'lb') return null;
    unit = unitToken;
  }

  const sideToken = pairs.get('p');
  const side = sideToken === undefined ? [] : parseSide(sideToken, set);
  if (!side) return null;

  const targetToken = pairs.get('t');
  if (targetToken === undefined) {
    return { set: setKey, barKg: bar.kg, collarKg, unit, mode, side };
  }
  if (mode !== 'decode') return null;
  const targetKg = parseTarget(targetToken);
  if (targetKg === null) return null;
  return { set: setKey, barKg: bar.kg, collarKg, unit, mode, side, targetKg };
}
