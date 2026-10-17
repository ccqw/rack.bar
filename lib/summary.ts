// Loading summary -- the share card's text (RBAR-19, ADR-0011). Pure core (ADR-0001):
// it folds a snapshot of the current load into the per-Side Plate groups the card
// renders as colour chips and the short Wordle-style text the Copy button writes to
// the clipboard (an emoji row per Side plus the plain count line, RBAR-64). Both the
// visible chips and the copied text derive from here, so they cannot drift. No DOM, no clipboard -- the element wires those.
//
// Plate faces stay the Plate's own stamp (`label ?? kg`): kg on the Eleiko set even
// when the display Unit is lb (the same kg-face-under-an-lb-readout convention the
// sleeve and palette use). The Total and config lines carry the Unit via `format`.
import type { Plate, PlateColor } from './plates.ts';
import { barWithCollars, totalKg } from './plates.ts';
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
  /** The display Unit the Total and config read in; the secondary reads the other. */
  readonly unit: Unit;
}

/** The bare-bar stand-in shown on the per-Side line when nothing is loaded. */
export const BARE_BAR = 'Bare bar - no plates';

/**
 * The achieved Total for a snapshot: Bar + 2 x Collar + 2 x Side Load, via the
 * existing core (ADR-0002/0008). The single place the card's Total is computed --
 * the element and the plain text both read it, so they cannot disagree.
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
  /** How many of this Plate sit on the Side. */
  readonly count: number;
}

/** A Plate's face stamp: its lb `label` when it has one (iron), else its kg. */
function plateFace(p: Plate): string {
  return p.label ?? String(p.kg);
}

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
      groups.push({ face, color: p.color, count: 1 });
    }
  }
  return groups;
}

/**
 * One per-Side group as `N x face` -- the count ALWAYS shows, singles included
 * (`1x 25`), so a glance never has to infer whether a bare face means one Plate
 * (RBAR-44, prototype L888). Exported so the card's chips and the plain text render
 * the group label from ONE place -- the "cannot drift" guarantee (ADR-0011) covers
 * the rendered label, not just the fold.
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
 * display Unit. Shared by the plain text, the card caption (which appends "per
 * side"), and the fullscreen caption, so the config wording cannot drift.
 */
export function configText(barKg: number, collarKg: number, setLabel: string): string {
  const bar = `${shownIn(barKg, 'kg')} kg / ${toLbWhole(barKg)} lb bar`;
  const rig = collarKg > 0 ? `${bar}, collars ${format(collarKg, 'kg')}` : bar;
  return `${rig} - ${setLabel}`;
}

/** The closing link line of the copied text, so a paste advertises the app (RBAR-64). */
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

// A Plate lighter than this is "small" in the emoji row: the Eleiko change Plates
// (2.5 kg and down; the 5 kg white stays a square) and the iron 10 / 5 / 2.5 lb.
const SMALL_PLATE_BELOW_KG = 5;

/** One Plate's emoji: its colour, a square when big, the small glyph when small. */
export function plateEmoji(p: Plate): string {
  const glyphs = PLATE_EMOJI[p.color];
  return p.kg < SMALL_PLATE_BELOW_KG ? glyphs.small : glyphs.big;
}

/**
 * The Wordle-style emoji row (RBAR-64): one emoji per Plate on a Side, in loading
 * order (heaviest first), so the colour run shows the plan at a glance. It reads the
 * same Side Load `groupSide` folds, so its order and counts match the count line
 * (asserted in summary.test.ts). An empty Side is an empty row.
 */
export function emojiRow(side: readonly Plate[]): string {
  return side.map(plateEmoji).join('');
}

/**
 * The loading summary the Copy button writes (RBAR-19/44, ADR-0011; reshaped into a
 * Wordle-style paste by RBAR-64):
 *
 *   rack.bar - 100 kg                       <- wordmark + Total (display Unit)
 *   (emoji row)                             <- one glyph per Plate on a Side
 *   Per side: 2x 25  1x 15                  <- groups, counts always, two-space join
 *   20 kg / 44 lb bar - Competition         <- the config caption the card shows
 *   https://rack.bar                        <- closing link
 *
 * The emoji row is the flourish; the count line is the instruction (and what a
 * screen reader or colour-blind reader relies on), so both always ship together. A
 * bare Bar has no emoji row and keeps the "Bare bar - no plates" line. Collars stay
 * on the config line only -- they are not Plates. The Total reads in `unit`; the
 * config line is dual-unit by construction. The Total is derived from the rig + Side
 * Load (`loadTotalKg`), and the group label, bare-bar text, and config all come from
 * the shared helpers -- so the text and the card cannot diverge. `setLabel` is the
 * active plate set's lifter-facing name (the element resolves it).
 */
export function loadingSummary(s: LoadSummary, setLabel: string): string {
  const head = `rack.bar - ${format(loadTotalKg(s), s.unit)}`;
  const plan =
    s.side.length === 0
      ? [BARE_BAR]
      : [emojiRow(s.side), `Per side: ${groupSide(s.side).map(groupText).join('  ')}`];
  return [head, ...plan, configText(s.barKg, s.collarKg, setLabel), SHARE_LINK].join('\n');
}
