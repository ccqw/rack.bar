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
//   u  sender's Primary unit     `kg` | `lb`                          default: the recipient's
//   p  Side Load, heaviest first `2x25,10,2.5` (`Nx` when N > 1)      default: bare Bar
//   t  Target, kg, 2 dp          finite, > 0, <= MAX_TARGET_KG        only with m=w
//   d  the Target field's text   decimal, <= 2 dp, in `u`, fits `t`   only with t
//      (additive, slice 3): what the sender's entry shows, so the recipient shows the
//      same reading and re-solves the same display window (see readingFits)
//
// Bars and Plates travel by their STAMP, not their kg: the iron masses are irrational
// in kg (45 lb = 20.41165665 kg), the stamp is exact and readable, and the Plate set
// disambiguates `25` (Eleiko kg) from `25` (iron lb). The Target and Collar are
// kg-canonical, as Recents are (ADR-0009). Every value is an allowlisted token or a
// bounded decimal, so nothing needs percent-encoding.
//
// Both directions validate against the same rules. The parser is all-or-nothing: any
// rejected field nulls the whole link, so a mangled link degrades to a normal boot,
// never a half-applied one. The serializer refuses (null) a load it cannot represent
// exactly, so a link that serializes always opens to that same load (Target at 2 dp). Unknown keys are
// ignored, so a later additive v1 field does not break this client; a breaking change
// bumps `v`.
import {
  DEFAULT_COLLAR_KG,
  isOfferedCollar,
  plateFitsMm,
} from './plates.ts';
import type { CollarKg, Plate } from './plates.ts';
import { PLATE_SETS, isOfferedPlateSet } from './platesets.ts';
import type { Bar, PlateSet, PlateSetKey } from './platesets.ts';
import { groupSide, plateFace, SHARE_LINK } from './summary.ts';
import { isUnit, kgToLb, toLbWhole } from './units.ts';
import type { Unit } from './units.ts';

/** The console's two modes: By Weight (decode) and By Plates (encode). */
export type LinkMode = 'decode' | 'encode';

/** The rig and Side Load every link carries, whatever its mode. */
interface LinkLoad {
  readonly set: PlateSetKey;
  /** The bare Bar, kg -- the kg of one of `PLATE_SETS[set].bars`. */
  readonly barKg: number;
  readonly collarKg: CollarKg;
  /** The sender's Primary unit (CONTEXT.md): the Unit the load was read in. */
  readonly unit: Unit;
  /** The Side Load: the set's own Inventory objects, heaviest-first, within the Sleeve. */
  readonly side: readonly Plate[];
}

/**
 * A load a share link carries (ADR-0014). The Side Load is the source of truth (the
 * sender's screen); a By Weight link may also carry the Target so the recipient's entry
 * reads the same. Only decode mode has a Target, so the type is split on `mode`.
 */
// AI-REVIEW 2026-10-17 [claude-opus-5-5/type-design] T1 (audit, PR #98): `targetKg?` sat on both
// modes, so an encode load could carry a Target the serializer silently dropped.
export type LinkState =
  | (LinkLoad & {
      readonly mode: 'decode';
      /** The Target, kg (travels at 2 dp). Optional: a By Weight load may have none. */
      readonly targetKg?: number;
      /** The sender's Target field text in `unit` (`d`, RBAR-50 slice 3), e.g. `52.5`
       * (lb) or `100` (kg). Optional, and only with `targetKg`, which it must fit. */
      readonly reading?: string;
    })
  | (LinkLoad & { readonly mode: 'encode' });

/** The longest fragment the parser reads; longer is rejected before any splitting.
 * Counts fold to one `Nx` token per face (at most 10), so a canonical link stays under
 * ~100 chars; the cap only bounds hostile input. */
export const MAX_LINK_LENGTH = 512;

/** The heaviest Target a link may carry, kg: a sanity cap well above any Sleeve-full
 * Total (~375 kg). */
export const MAX_TARGET_KG = 1000;

/** The only format version this client writes. Parsing an older `v` stays supported
 * forever once a v2 exists (ADR-0014); today v1 is the only one. */
const VERSION = '1';

// The wire tokens for each mode.
const MODE_TOKEN: Record<LinkMode, string> = { decode: 'w', encode: 'p' };

// The keys v1 reads. Any other key is ignored (forward-compatible additive fields).
const KNOWN_KEYS: ReadonlySet<string> = new Set(['v', 's', 'b', 'm', 'c', 'u', 'p', 't', 'd']);

// The most of one Plate a single `Nx` group may claim (1..99, no leading zero).
const COUNT_RE = /^([1-9][0-9]?)x(.+)$/;

// A plain non-negative decimal: no sign, no exponent, no hex, no blank (Number('')
// is 0, Number('0x10') is 16 -- neither may sneak past as a weight).
const DECIMAL_RE = /^[0-9]+(\.[0-9]+)?$/;

// A Target field reading: a plain decimal of at most 4 + 2 digits (the keypad's own
// shape; anything longer is over MAX_TARGET_KG in either unit anyway).
const READING_RE = /^[0-9]{1,4}(\.[0-9]{1,2})?$/;

// How far an lb reading may sit from its 2 dp kg Target, lb: half a whole-lb readout (a
// kg Target shown in lb reads whole, ADR-0010) plus the 2 dp kg rounding (0.005 kg =
// 0.011 lb). A typed lb reading sits within the rounding alone.
const LB_READING_SLACK = 0.5 + 0.0111;

/**
 * True when `reading` -- a Target field's text in `unit` -- is a plain decimal that fits
 * the link's 2 dp kg Target `targetKg` (RBAR-50 slice 3): in kg it rounds to that Target
 * at 2 dp; in lb it is within LB_READING_SLACK of it. One rule for both directions.
 *
 * Why it travels: the console solves the window of the DISPLAYED Target, which in lb
 * is the whole-lb reading of the typed weight (`displayCeilingKg`). A typed 52.5 lb is
 * 23.8136 kg and reads 53, but its 2 dp kg (23.81) reads 52 -- so `t` alone re-solves a
 * different window. The reading the sender's entry shows recovers both the text and the
 * window: the recipient solves `draftToKg(reading, unit)`.
 */
export function readingFits(reading: string, targetKg: number, unit: Unit): boolean {
  if (!READING_RE.test(reading)) return false;
  const r = Number(reading);
  return unit === 'lb'
    ? Math.abs(r - kgToLb(targetKg)) <= LB_READING_SLACK
    : Number(r.toFixed(2)) === targetKg;
}

/** A Bar's stamp: its whole-lb reading for an lb-stamped Bar, else its kg. */
function barStamp(bar: Bar): string {
  return bar.unit === 'lb' ? `${toLbWhole(bar.kg)}lb` : `${bar.kg}kg`;
}

/** A Target as it travels -- kg at 2 dp, the precision Recents store (ADR-0009) -- or
 * null when that is not finite, not > 0, or over MAX_TARGET_KG. One rule for both
 * directions. */
function linkTargetKg(kg: number): number | null {
  const t = Number(kg.toFixed(2));
  return Number.isFinite(t) && t > 0 && t <= MAX_TARGET_KG ? t : null;
}

/** True when `side` fits the Sleeve, walked in order through the one ADR-0012 fit
 * comparison (plateFitsMm), so link validation agrees with the solver and the views. */
function fitsSleeve(side: readonly Plate[]): boolean {
  let usedMm = 0;
  for (const p of side) {
    if (!plateFitsMm(usedMm, p)) return false;
    usedMm += p.widthMm;
  }
  return true;
}

/** True when `side` is drawn from `set`'s own Inventory, heaviest-first, and fits the
 * Sleeve -- the Side Load invariant a link carries in both directions. */
function isLinkableSide(side: readonly Plate[], set: PlateSet): boolean {
  for (let i = 0; i < side.length; i++) {
    if (!set.inventory.includes(side[i]!)) return false;
    if (i > 0 && side[i - 1]!.kg < side[i]!.kg) return false;
  }
  return fitsSleeve(side);
}

/**
 * Serialize a load to its canonical v1 fragment (no leading `#`), or null when the
 * load cannot be represented exactly: an unoffered set, a Bar or Collar the set does
 * not offer, a Plate from another set, a Side Load out of order or past the Sleeve, or
 * a Target that is not finite, rounds to <= 0 at 2 dp, or is over MAX_TARGET_KG.
 * Refusing beats emitting a link that opens to a different load (a foreign `25` face
 * would read as the other set's 25) or to nothing. Always writes `c`, `u` and `p`;
 * writes `t` only when a decode-mode load has a Target. A non-null result always
 * parses back to `state` (with the Target at 2 dp).
 */
// AI-REVIEW 2026-10-17 [claude-opus-5-5/silent-failure] SF1-SF3 (audit, PR #98): an off-menu
// Bar, a foreign Plate or a bad Target used to serialize into a link that opened to a
// different load or to nothing; the serializer now refuses them.
export function serializeLink(state: LinkState): string | null {
  if (!isOfferedPlateSet(state.set)) return null;
  const set = PLATE_SETS[state.set];
  const bar = set.bars.find((b) => b.kg === state.barKg);
  if (!bar || !isOfferedCollar(state.collarKg)) return null;
  if (!isUnit(state.unit) || !Object.hasOwn(MODE_TOKEN, state.mode)) return null;
  if (!isLinkableSide(state.side, set)) return null;
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
  // `!= null`: a console Target of null (no Target) that slips through a cast reads as
  // absent rather than throwing on null.toFixed.
  if (state.mode === 'decode' && state.targetKg != null) {
    const t = linkTargetKg(state.targetKg);
    if (t === null) return null;
    pairs.push(`t=${t}`);
    if (state.reading !== undefined) {
      if (!readingFits(state.reading, t, state.unit)) return null;
      pairs.push(`d=${state.reading}`);
    }
  } else if (state.mode === 'decode' && state.reading !== undefined) {
    return null; // a reading without a Target has nothing to fit
  }
  return pairs.join('&');
}

/** The full share URL for a load -- the one site origin (SHARE_LINK) + `/#` +
 * fragment -- or null when the load cannot be serialized (see serializeLink). */
export function linkUrl(state: LinkState): string | null {
  const fragment = serializeLink(state);
  return fragment === null ? null : `${SHARE_LINK}/#${fragment}`;
}

/**
 * Split the raw fragment on `&` and `=` FIRST, then percent-decode each known value
 * (a messenger may send `,` as `%2C`). Splitting before decoding means an encoded
 * `%26` / `%3D` can never become a separator, so no value can smuggle in another key.
 * Null on a duplicate known key, a known key with no `=`, or a known value with
 * malformed percent-encoding. Unknown keys -- duplicated, valueless or malformed -- are
 * ignored, as are empty segments (a trailing `&`).
 */
// AI-REVIEW 2026-10-17 [claude-opus-5-5/silent-failure] SF4 (audit, PR #98): decoding the
// whole fragment first let `x=a%26t%3D50` set the Target; split first, then decode.
// AI-REVIEW 2026-10-17 [claude-opus-5-5/silent-failure] SF6 (audit, PR #98): a duplicated
// unknown key nulled the link, against ignore-unknown-keys; unknown keys are now skipped.
function splitPairs(fragment: string): Map<string, string> | null {
  const pairs = new Map<string, string>();
  for (const seg of fragment.split('&')) {
    const eq = seg.indexOf('=');
    const key = eq === -1 ? seg : seg.slice(0, eq);
    if (!KNOWN_KEYS.has(key)) continue;
    if (eq === -1 || pairs.has(key)) return null;
    let value: string;
    try {
      value = decodeURIComponent(seg.slice(eq + 1));
    } catch {
      return null; // a malformed escape in a value we must read: the link is mangled
    }
    pairs.set(key, value);
  }
  return pairs;
}

/** Parse the `p` value against `set`'s Inventory into a heaviest-first Side Load that
 * fits the Sleeve, or null. Repeated or unsorted faces are merged and re-sorted. */
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
  // Rebuild heaviest-first in Inventory order (each Inventory is heaviest-first). The
  // length cap bounds the pile (~100 `99x` tokens, ~10k Plates), so expanding before the
  // fit check is cheap.
  const side = set.inventory.flatMap((p) => Array<Plate>(counts.get(p) ?? 0).fill(p));
  return fitsSleeve(side) ? side : null;
}

/** Parse `t` to kg at 2 dp, or null when not a plain decimal or outside (0, cap]. */
function parseTarget(value: string): number | null {
  return DECIMAL_RE.test(value) ? linkTargetKg(Number(value)) : null;
}

/**
 * Parse a share-link fragment (with or without its leading `#`) to a load, or null.
 * All-or-nothing (ADR-0014): null on a fragment over MAX_LINK_LENGTH, a missing or
 * non-`1` `v`, a duplicate known key, a known key with no `=` or with malformed
 * percent-encoding, an unoffered set / Bar stamp / Collar / Unit / mode / Plate face,
 * a count outside 1..99, a Side Load past the Sleeve, or a `t` that is present with
 * `m=p`, not a plain decimal, <= 0 at 2 dp, or over MAX_TARGET_KG, or a `d` without
 * `t` or that does not fit `t` in the load's unit (readingFits). Unknown keys are
 * ignored; Plates are re-sorted heaviest-first. A missing `c` is None, a missing `p`
 * the bare Bar, and a missing `u` is `primaryUnit` -- the recipient's own Primary unit, which
 * the shell must pass in (an invalid one reads as kg). Never throws.
 */
export function parseLink(fragment: string, primaryUnit: Unit): LinkState | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (raw.length > MAX_LINK_LENGTH) return null;
  const pairs = splitPairs(raw);
  if (!pairs) return null;

  if (pairs.get('v') !== VERSION) return null;

  const setKey = pairs.get('s');
  if (setKey === undefined || !isOfferedPlateSet(setKey)) return null;
  const set = PLATE_SETS[setKey];

  const barToken = pairs.get('b');
  const bar = set.bars.find((b) => barStamp(b) === barToken);
  if (!bar) return null;

  const collarToken = pairs.get('c');
  let collarKg: CollarKg = DEFAULT_COLLAR_KG;
  if (collarToken !== undefined) {
    const n = DECIMAL_RE.test(collarToken) ? Number(collarToken) : NaN;
    if (!isOfferedCollar(n)) return null;
    collarKg = n;
  }

  const unitToken = pairs.get('u');
  // The shell owns validating its Primary unit; a bad one still never leaks out.
  let unit: Unit = isUnit(primaryUnit) ? primaryUnit : 'kg';
  if (unitToken !== undefined) {
    if (!isUnit(unitToken)) return null;
    unit = unitToken;
  }

  const sideToken = pairs.get('p');
  const side = sideToken === undefined ? [] : parseSide(sideToken, set);
  if (!side) return null;

  const load = { set: setKey, barKg: bar.kg, collarKg, unit, side };
  const modeToken = pairs.get('m');
  const targetToken = pairs.get('t');
  const reading = pairs.get('d');
  if (modeToken === MODE_TOKEN.encode) {
    return targetToken === undefined && reading === undefined ? { ...load, mode: 'encode' } : null;
  }
  if (modeToken !== MODE_TOKEN.decode) return null;
  if (targetToken === undefined) return reading === undefined ? { ...load, mode: 'decode' } : null;
  const targetKg = parseTarget(targetToken);
  if (targetKg === null) return null;
  if (reading === undefined) return { ...load, mode: 'decode', targetKg };
  return readingFits(reading, targetKg, unit) ? { ...load, mode: 'decode', targetKg, reading } : null;
}
