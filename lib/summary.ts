// Loading summary -- the share card's text (RBAR-19, ADR-0011). Pure core (ADR-0001):
// it folds a snapshot of the current load into the per-Side Plate groups the card
// renders as colour chips and the short emoji Plate list the share button sends
// (RBAR-64). Both the visible chips and the shared text fold via `groupSide`, so
// they cannot drift. No DOM, no clipboard, no share sheet -- the element wires those.
//
// Plate faces stay the Plate's own stamp (`label ?? kg`): kg on the Eleiko set even
// when the display Unit is lb (the same kg-face-under-an-lb-readout convention the
// sleeve and palette use). The Total carries the display Unit via `format`; the
// config caption is dual-unit.
import type { Plate, PlateColor } from './plates.ts';
import { barWithCollars, plateFace, totalKg } from './plates.ts';
import { format, shownIn, toLbWhole } from './units.ts';
import type { Unit } from './units.ts';

/**
 * A snapshot of the current load the card summarises (RBAR-19). All weights kg.
 * The Total is NOT stored -- it is derived from the rig + Side Load (`loadTotalKg`),
 * so the snapshot has no denormalized field that can contradict its own Plates.
 */
export interface LoadSummary {
  /** The Side Load -- the Plates on one Side, heaviest-first. */
  readonly side: readonly Plate[];
  /** The bare Bar, in kg (no Collars folded in). */
  readonly barKg: number;
  /** The per-Side Collar, in kg (0 = None). */
  readonly collarKg: number;
  /** The display Unit the Total reads in; the secondary reads the other. */
  readonly unit: Unit;
}

/** The bare-bar stand-in shown on the per-Side line when nothing is loaded. */
export const BARE_BAR = 'Bare bar - no plates';

/**
 * The achieved Total for a snapshot: Bar + 2 x Collar + 2 x Side Load, via the
 * existing core (ADR-0002/0008). The single place the card's Total is computed --
 * the element and the shared text both read it, so they cannot disagree.
 */
export function loadTotalKg(s: LoadSummary): number {
  return totalKg(s.side, barWithCollars(s.barKg, s.collarKg));
}

/** A run of identical Plates on one Side: its face stamp, colour, and how many. */
export interface PlateGroup {
  /** The Plate's stamped face -- its lb `label` (iron) or its kg number (Eleiko). */
  readonly face: string;
  /** The Plate's colour, for the chip fill. */
  readonly color: PlateColor;
  /** The Plate's emoji for the shared Plate list (`plateEmoji`, RBAR-64). */
  readonly emoji: string;
  /** How many of this Plate sit on the Side. */
  readonly count: number;
}

// plateFace moved to plates.ts (RBAR-72: it is also the Plate limit key, ADR-0016);
// re-exported here so the card, the summary and the share link keep importing it.
export { plateFace };

/**
 * Fold a heaviest-first Side Load into `count x face` groups (ADR-0011). Identical
 * Plates are adjacent in a Side Load, so a run-length pass over the list groups
 * them in order; a Plate is "the same" when its face and colour match.
 */
export function groupSide(side: readonly Plate[]): readonly PlateGroup[] {
  const groups: PlateGroup[] = [];
  for (const p of side) {
    const face = plateFace(p);
    const last = groups[groups.length - 1];
    if (last && last.face === face && last.color === p.color) {
      groups[groups.length - 1] = { ...last, count: last.count + 1 };
    } else {
      groups.push({ face, color: p.color, emoji: plateEmoji(p), count: 1 });
    }
  }
  return groups;
}

/**
 * One per-Side group as `N x face` -- the count ALWAYS shows, singles included
 * (`1x 25`), so a glance never has to infer whether a bare face means one Plate
 * (RBAR-44, prototype L888). The card's chip label. Since RBAR-64 the shared text
 * renders each group as its own `emoji face x count` line instead; both fold via
 * `groupSide`, so the faces, order and counts cannot drift (ADR-0011).
 *
 * 2026-06-29 (RBAR-27): this is the share/fullscreen card's flat label format. The
 * "On the bar" loaded chips (<rack-loaded>) deliberately do NOT use it -- they render a
 * styled face + `xN` suffix per the handoff (section 4b), a presentation a single flat
 * string cannot carry. Both still fold via `groupSide`, so the faces and counts cannot
 * drift; only the loaded chips' visual label format differs by design.
 */
export function groupText(g: PlateGroup): string {
  return `${g.count}x ${g.face}`;
}

/**
 * The rig-config line (RBAR-44, prototype L891): the Bar in BOTH Units plus the
 * plate-set name -- `20 kg / 44 lb bar - Competition` -- with the Collars appended
 * when fitted (an in-house addition the prototype lacks; the caption would otherwise
 * hide rig weight). Dual-unit is fixed kg-then-lb, so the line no longer takes a
 * display Unit. Shared by the card caption (which appends "per side") and the
 * fullscreen caption, so the config wording cannot drift. (The shared text dropped
 * this line in RBAR-64.)
 */
export function configText(barKg: number, collarKg: number, setLabel: string): string {
  const bar = `${shownIn(barKg, 'kg')} kg / ${toLbWhole(barKg)} lb bar`;
  const rig = collarKg > 0 ? `${bar}, collars ${format(collarKg, 'kg')}` : bar;
  return `${rig} - ${setLabel}`;
}

/** The closing link line of the shared text, so a paste advertises the app (RBAR-64). */
export const SHARE_LINK = 'https://rack.bar';

/**
 * The one Plate-to-emoji map (RBAR-64). The source stays ASCII, so every glyph is an
 * escape, named in its comment. A bumper is a coloured square; a change Plate wears
 * its bumper's colour as a circle. Iron carries no colour, so it is black: a large
 * square for the big Plates, a medium-small square for the small ones. Every glyph is
 * a single code point with default emoji presentation (no variation selector needed).
 */
const PLATE_EMOJI: Record<PlateColor, { readonly big: string; readonly small: string }> = {
  red: { big: '\u{1F7E5}', small: '\u{1F534}' }, // large red square / large red circle
  blue: { big: '\u{1F7E6}', small: '\u{1F535}' }, // large blue square / large blue circle
  yellow: { big: '\u{1F7E8}', small: '\u{1F7E1}' }, // large yellow square / large yellow circle
  green: { big: '\u{1F7E9}', small: '\u{1F7E2}' }, // large green square / large green circle
  white: { big: '\u{2B1C}', small: '\u{26AA}' }, // white large square / medium white circle
  iron: { big: '\u{2B1B}', small: '\u{25FE}' }, // black large square / black medium-small square
};

// A Plate lighter than this is "small" in the shared Plate list: the Eleiko change Plates
// (2.5 kg and down; the 5 kg white stays a square) and the iron 10 / 5 / 2.5 lb.
const SMALL_PLATE_BELOW_KG = 5;

/** One Plate's emoji: its colour, a square when big, the small glyph when small. */
export function plateEmoji(p: Plate): string {
  const glyphs = PLATE_EMOJI[p.color];
  return p.kg < SMALL_PLATE_BELOW_KG ? glyphs.small : glyphs.big;
}

// The shared text's punctuation, escaped like the emoji so the source stays ASCII.
const MIDDOT = '\u{00B7}'; // middle dot (heading separator)
const TIMES = '\u{00D7}'; // multiplication sign (group count)
const LOCK = '\u{1F512}'; // lock (the Collars line)

/** The shared text's stand-in for the Plate lines when nothing is loaded. */
const BARE_BAR_LINE = 'Bare bar';

/**
 * The format-D Plate lines for one Side (RBAR-64): one `emoji face x count` line per
 * `groupSide` group, heaviest first, or a single `Bare bar` line when nothing is loaded.
 * The body of the text the share button sends (`loadingSummary`); exported so the
 * lines can be tested on their own.
 */
export function plateLines(side: readonly Plate[]): readonly string[] {
  if (side.length === 0) return [BARE_BAR_LINE];
  return groupSide(side).map((g) => `${g.emoji} ${g.face} ${TIMES} ${g.count}`);
}

/**
 * The loading summary the share button sends (RBAR-19/44, ADR-0011; reshaped by
 * RBAR-64 into the "D. Plate list" format Caitlin picked):
 *
 *   rack.bar . 142 kg . per side            <- wordmark + Total (display Unit); "."
 *                                              stands in for the middot here
 *   (red square) 25 x 2                     <- one line per Plate group, heaviest
 *   (green square) 10 x 1                      first: emoji, stamped face, count
 *   (green circle) 1 x 1                       ("x" is the multiplication sign)
 *   (lock) collars 2.5 kg                   <- only when Collars are fitted
 *   https://rack.bar                        <- closing link
 *
 * A bare Bar has a single "Bare bar" line in place of the Plate lines. The Plate
 * lines fold via `groupSide`, the same fold the card's chips render, so the faces,
 * order and counts cannot drift. Faces are the Plate's stamp (kg on Eleiko even under
 * an lb Total, lb on iron). The Bar and plate set are deliberately not named: the
 * Total already includes the Bar, and the lines say what to load on each Side.
 */
export function loadingSummary(s: LoadSummary): string {
  const head = `rack.bar ${MIDDOT} ${format(loadTotalKg(s), s.unit)} ${MIDDOT} per side`;
  const plates = plateLines(s.side);
  const collars = s.collarKg > 0 ? [`${LOCK} collars ${format(s.collarKg, 'kg')}`] : [];
  return [head, ...plates, ...collars, SHARE_LINK].join('\n');
}
