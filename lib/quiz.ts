// The Loadout quiz core (RBAR-92, slice 1: read the bar). Pure and seeded (ADR-0001):
// the page (game.html, elements/quiz.ts) shows one loaded Side, the lifter types the
// Total, and this module decides what the question is, whether the answer is right,
// and which plausible mistake a wrong answer most likely was.
//
//   - A question is drawn from (seed, index): the same seed always gives the same
//     list, so a test or a reload can replay it.
//   - Its Side Load comes from the solver's exact search (lib/sideloads.ts,
//     canonicalSide): the fewest Plates for that Side sum on the lifter's Inventory,
//     Plate limits included (ADR-0003, ADR-0012, ADR-0016). Never a greedy fill.
//   - The Bar, the plate set and the Collar come from the lifter's Setup (ADR-0007).
//     Collars appear only when Setup has them on, only on the kg set, and never on a
//     bare Bar (a question always has a Plate).
//   - Answers are read in the plate set's own Unit: kg on Competition, lb on Training.
import { canonicalSide } from './sideloads.ts';
import { plateFace, withLimits } from './plates.ts';
import type { InventoryEntry, Plate } from './plates.ts';
import { PLATE_SETS } from './platesets.ts';
import type { PlateSetKey } from './platesets.ts';
import { kgToLb, lbToKg } from './units.ts';
import type { Unit } from './units.ts';

/** How often a question carries Collars, when Setup has them on. */
export type CollarsMode = 'off' | 'some' | 'always';
export const COLLARS_MODES: readonly CollarsMode[] = ['off', 'some', 'always'];

/** The most Plates on the Side: "1-2", "Up to 4", "Up to 6". */
export type MaxPlates = 2 | 4 | 6;
export const MAX_PLATES_CHOICES: readonly MaxPlates[] = [2, 4, 6];

/** The quiz gear's settings. */
export interface QuizSettings {
  readonly maxPlates: MaxPlates;
  /** Whether change Plates (under 5 kg, under 10 lb) can appear. */
  readonly change: boolean;
  readonly collars: CollarsMode;
  /** Numbers on the discs. Off by default (Caitlin, 2026-10-17): colours only. Iron
   * Plates always show their stamp, so this only reads on the kg set. */
  readonly numbers: boolean;
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  maxPlates: 4,
  change: true,
  collars: 'some',
  numbers: false,
};

/** The lifter's rig, read from Setup. `collarKg` is Setup's Collar (0 = none). */
export interface QuizRig {
  readonly set: PlateSetKey;
  readonly barKg: number;
  readonly collarKg: number;
  /** The set's Inventory with the lifter's Plate limits applied (inventoryOnHand). */
  readonly inventory: readonly InventoryEntry[];
}

/** One question: a loaded Side and the Total it makes. */
export interface Question {
  readonly index: number;
  /** The plate set it was drawn on. */
  readonly set: PlateSetKey;
  /** One Side's Plates, heaviest first. Never empty. */
  readonly side: readonly Plate[];
  readonly barKg: number;
  /** The Collar on each Side in this question: 0, or Setup's Collar. */
  readonly collarKg: number;
  /** Bar + 2 x Collar + 2 x Side Load, in kg (ADR-0002, ADR-0008). */
  readonly totalKg: number;
  /** The Unit the answer is read in: the plate set's own. */
  readonly unit: Unit;
  /** The Side Load in `unit`: the sum of the Plates' faces (exact). */
  readonly sideShown: number;
  /** The Total in `unit`, as the app shows it (whole lb, kg to 2 decimals). */
  readonly totalShown: number;
}

// Each set's question shape, in the set's own Unit: the Side sums each "Plates per
// side" choice draws from, the steps those sums move in (with and without change
// Plates), the lightest Plate that is not a change Plate, and the pairs of sizes a
// lifter confuses by eye (neighbours in colour and width). From the prototype.
interface Shape {
  readonly side: Readonly<Record<MaxPlates, readonly [number, number]>>;
  readonly steps: { readonly off: readonly number[]; readonly on: readonly number[] };
  readonly small: number;
  readonly near: readonly (readonly [number, number])[];
}

const SHAPES: Readonly<Record<PlateSetKey, Shape>> = {
  comp: {
    side: { 2: [5, 50], 4: [20, 95], 6: [45, 130] },
    steps: { off: [5], on: [5, 2.5, 2.5, 1, 0.5] },
    small: 5,
    near: [
      [25, 20],
      [20, 15],
      [15, 10],
      [2.5, 2],
      [2, 1.5],
      [1.5, 1],
      [1, 0.5],
    ],
  },
  training: {
    side: { 2: [10, 90], 4: [45, 180], 6: [90, 260] },
    steps: { off: [5, 10], on: [5, 2.5] },
    small: 10,
    near: [
      [45, 35],
      [35, 25],
      [25, 10],
      [10, 5],
      [5, 2.5],
    ],
  },
};

/** The fewest Plates a question has for each "Plates per side" choice (when it can). */
export const MIN_PLATES: Readonly<Record<MaxPlates, number>> = { 2: 1, 4: 2, 6: 3 };

/** The lightest Plate face that is not a change Plate, on `set`. */
export function smallestFullPlate(set: PlateSetKey): number {
  return SHAPES[set].small;
}

/** Whether questions on `rig` can carry Collars: Setup has them on, on the kg set. */
export function collarsOffered(rig: QuizRig): boolean {
  return rig.collarKg > 0 && PLATE_SETS[rig.set].unit === 'kg';
}

// A small seeded PRNG (mulberry32): fast, 32-bit state, good enough for a quiz.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The question's own stream: depends on (seed, index) only, so question i is the same
// whatever came before it.
function stream(seed: number, index: number): () => number {
  return mulberry32((Math.imul(seed | 0, 2654435761) ^ Math.imul(index + 1, 40503)) >>> 0);
}

const r2 = (n: number): number => Number(n.toFixed(2));

/** A weight in `unit` as the app shows it: whole lb, kg to two decimals. */
export function shownValue(n: number, unit: Unit): number {
  return unit === 'lb' ? Math.round(n) : r2(n);
}

// The Inventory a question draws from: the lifter's, with change Plates removed when
// the gear has them off.
function drawFrom(rig: QuizRig, change: boolean): readonly InventoryEntry[] {
  if (change) return rig.inventory;
  const small = SHAPES[rig.set].small;
  const none: Record<string, number> = {};
  for (const p of rig.inventory) if (Number(plateFace(p)) < small) none[plateFace(p)] = 0;
  return withLimits(rig.inventory, none);
}

// The Side sum in `unit` as kg.
const unitToKg = (n: number, unit: Unit): number => (unit === 'lb' ? lbToKg(n) : n);
const kgToUnit = (kg: number, unit: Unit): number => (unit === 'lb' ? kgToLb(kg) : kg);

/** The Side Load of `side` in its faces' Unit (exact: the faces are what is stamped). */
export function faceSum(side: readonly Plate[]): number {
  return r2(side.reduce((s, p) => s + Number(plateFace(p)), 0));
}

// The tries a question makes for a Side its settings and the Plate limits allow, before
// it falls back to one Plate.
const TRIES = 400;

/**
 * Question `index` of the list `seed` makes on `rig` under `settings`: a Side sum drawn
 * from the set's range for the "Plates per side" choice, loaded the way Decode would
 * (canonicalSide: fewest Plates, heaviest first, within the Sleeve and the Plate limits),
 * kept only when its Plate count fits the choice. If no draw fits (tight Plate limits),
 * the question is one Plate: the heaviest the lifter has. Null only when the lifter has
 * no Plates at all.
 */
export function quizQuestion(
  seed: number,
  index: number,
  rig: QuizRig,
  settings: QuizSettings,
): Question | null {
  const shape = SHAPES[rig.set];
  const unit = PLATE_SETS[rig.set].unit;
  const r = stream(seed, index);
  const inventory = drawFrom(rig, settings.change);
  const [lo, hi] = shape.side[settings.maxPlates];
  const minN = MIN_PLATES[settings.maxPlates];
  const steps = settings.change ? shape.steps.on : shape.steps.off;
  let side: readonly Plate[] | null = null;
  for (let t = 0; t < TRIES && side === null; t++) {
    const step = steps[Math.floor(r() * steps.length)];
    const first = Math.ceil(lo / step);
    const k = first + Math.floor(r() * (Math.floor(hi / step) - first + 1));
    const sideU = k * step;
    const loaded = canonicalSide(unitToKg(sideU, unit), inventory);
    if (loaded && loaded.length >= minN && loaded.length <= settings.maxPlates) side = loaded;
  }
  if (side === null) {
    const one =
      inventory.find((p) => p.maxPerSide !== 0) ?? rig.inventory.find((p) => p.maxPerSide !== 0);
    if (!one) return null;
    side = [one];
  }
  const withCollar =
    collarsOffered(rig) &&
    (settings.collars === 'always' ||
      (settings.collars === 'some' && (index === 0 || r() < 0.4)));
  const collarKg = withCollar ? rig.collarKg : 0;
  const sideKg = side.reduce((s, p) => s + p.kg, 0);
  const totalKg = rig.barKg + 2 * collarKg + 2 * sideKg;
  return {
    index,
    set: rig.set,
    side,
    barKg: rig.barKg,
    collarKg,
    totalKg,
    unit,
    sideShown: faceSum(side),
    totalShown: shownValue(kgToUnit(totalKg, unit), unit),
  };
}

/** Whether `answer` (in the question's Unit) is the Total. */
export function isRight(q: Question, answer: number): boolean {
  if (!Number.isFinite(answer)) return false;
  return (
    Math.abs(answer - q.totalShown) < 1e-9 ||
    Math.abs(answer - kgToUnit(q.totalKg, q.unit)) < 0.005
  );
}

/** A wrong Total a lifter plausibly reaches, and what it says they did. */
export interface Mistake {
  /** The Total that mistake gives, in the question's Unit. */
  readonly value: number;
  readonly why: string;
}

/**
 * The mistakes a lifter actually makes reading this Side, each with the wrong Total it
 * gives: forgetting the Bar, forgetting the Collars, counting one Side, reading a Plate
 * as its neighbour (a 25 as a 20), and missing the outer Plate. In that order, none
 * equal to the right Total or to an earlier one, none zero or below.
 */
export function mistakes(q: Question): Mistake[] {
  const u = q.unit;
  const bar = kgToUnit(q.barKg, u);
  const col = kgToUnit(q.collarKg, u);
  const total = kgToUnit(q.totalKg, u);
  const side = q.sideShown;
  const out: Mistake[] = [];
  const seen = new Set([shownValue(total, u)]);
  const add = (v: number, why: string): void => {
    const value = r2(v);
    const key = shownValue(value, u);
    if (value > 0 && !seen.has(key)) {
      seen.add(key);
      out.push({ value, why });
    }
  };
  add(2 * (side + col), 'Forgot the Bar');
  if (q.collarKg > 0) add(total - 2 * col, 'Forgot the collars');
  add(bar + side + col, 'Counted one side');
  const faces = [...new Set(q.side.map((p) => Number(plateFace(p))))];
  for (const v of faces) {
    for (const [a, b] of SHAPES[q.set].near) {
      if (a === v) add(total - 2 * (a - b), `Read a ${faceText(a)} as a ${faceText(b)}`);
      if (b === v) add(total + 2 * (a - b), `Read a ${faceText(b)} as a ${faceText(a)}`);
    }
  }
  const last = Number(plateFace(q.side[q.side.length - 1]));
  add(total - 2 * last, `Missed the ${faceText(last)}`);
  return out;
}

// A Plate face the way the disc reads it: "0.5" -> ".5".
function faceText(v: number): string {
  return v < 1 ? String(v).replace(/^0/, '') : String(v);
}

/**
 * Why `answer` is wrong, in a few words: the named mistake it matches (within the
 * Unit's rounding), "That is one side" for the bare Side sum, else how far off it is
 * ("+5 kg off", "-2.5 kg off"). For a right answer, the empty string.
 */
export function diagnose(q: Question, answer: number): string {
  if (isRight(q, answer)) return '';
  const tol = q.unit === 'lb' ? 0.5 : 0.005;
  const hit = mistakes(q).find((m) => Math.abs(m.value - answer) <= tol);
  if (hit) return hit.why;
  if (Math.abs(answer - q.sideShown) <= tol) return 'That is one side';
  const d = r2(answer - q.totalShown);
  return `${d > 0 ? '+' : ''}${d} ${q.unit} off`;
}

/**
 * The breakdown's arithmetic after the Plate chips: "= 37.5 x 2 + 20 kg bar + 2 x 2.5 kg
 * collars = 100 kg". `barName` is the Bar as Setup names it ("20 kg", "45 lb").
 */
export function breakdownText(q: Question, barName: string): string {
  const collars = q.collarKg > 0 ? ` + 2 x ${r2(q.collarKg)} kg collars` : '';
  return `= ${q.sideShown} x 2 + ${barName} bar${collars} = ${q.totalShown} ${q.unit}`;
}

// ----- the keypad -----

/** The longest answer the keypad takes. */
export const MAX_ANSWER_CHARS = 6;

/**
 * The answer after one key: a digit appends (a lone "0" is replaced), "." appends once
 * after a digit, "del" drops the last character. Never longer than MAX_ANSWER_CHARS.
 */
export function typeKey(draft: string, key: string): string {
  if (key === 'del') return draft.slice(0, -1);
  if (draft.length >= MAX_ANSWER_CHARS && draft !== '0') return draft;
  if (key === '.') return draft.length > 0 && !draft.includes('.') ? draft + '.' : draft;
  if (!/^[0-9]$/.test(key)) return draft;
  return (draft === '0' ? '' : draft) + key;
}

/** The typed answer as a number, or null when nothing is typed. "12." reads as 12. */
export function answerOf(draft: string): number | null {
  if (draft === '' || draft === '.') return null;
  const n = Number(draft);
  return Number.isFinite(n) ? n : null;
}

// ----- the streak -----

/** How many past answers the history row shows. */
export const HISTORY_LEN = 10;

export interface QuizRecord {
  readonly streak: number;
  readonly best: number;
  /** The last answers, oldest first, true = right. At most HISTORY_LEN. */
  readonly history: readonly boolean[];
}

export const EMPTY_RECORD: QuizRecord = { streak: 0, best: 0, history: [] };

/** The record after one answer: a right one adds to the streak (and the best, when it
 * passes it); a wrong one, or a Show, ends the streak. */
export function scoreAnswer(rec: QuizRecord, right: boolean): QuizRecord {
  const streak = right ? rec.streak + 1 : 0;
  return {
    streak,
    best: Math.max(rec.best, streak),
    history: [...rec.history, right].slice(-HISTORY_LEN),
  };
}

// ----- persistence (the shell stores this under rackbar.quiz, ADR-0007) -----

/** What the quiz keeps between visits: its gear settings, the streak and the best. */
export interface QuizSaved {
  readonly settings: QuizSettings;
  readonly record: QuizRecord;
}

export const DEFAULT_SAVED: QuizSaved = { settings: DEFAULT_QUIZ_SETTINGS, record: EMPTY_RECORD };

/** The stored value: `{"v":1,"settings":{...},"streak":3,"best":9,"history":[...]}`. */
export function serializeQuizSaved(s: QuizSaved): string {
  return JSON.stringify({
    v: 1,
    settings: s.settings,
    streak: s.record.streak,
    best: s.record.best,
    history: s.record.history,
  });
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Read the stored value (ADR-0007: validate on read, never throw). Missing or malformed
 * storage reads as the defaults; inside a well-formed value each field is checked on
 * its own, and a bad one falls back to its default while the rest stand. A best below
 * the streak is raised to it.
 */
export function parseQuizSaved(raw: string | null): QuizSaved {
  if (raw === null) return DEFAULT_SAVED;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_SAVED;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return DEFAULT_SAVED;
  const o = v as Record<string, unknown>;
  const s = (typeof o.settings === 'object' && o.settings !== null ? o.settings : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_QUIZ_SETTINGS;
  const settings: QuizSettings = {
    maxPlates: (MAX_PLATES_CHOICES as readonly unknown[]).includes(s.maxPlates)
      ? (s.maxPlates as MaxPlates)
      : d.maxPlates,
    change: typeof s.change === 'boolean' ? s.change : d.change,
    collars: (COLLARS_MODES as readonly unknown[]).includes(s.collars)
      ? (s.collars as CollarsMode)
      : d.collars,
    numbers: typeof s.numbers === 'boolean' ? s.numbers : d.numbers,
  };
  const streak = isCount(o.streak) ? o.streak : 0;
  const best = Math.max(isCount(o.best) ? o.best : 0, streak);
  const history =
    Array.isArray(o.history) && o.history.every((h) => typeof h === 'boolean')
      ? (o.history as boolean[]).slice(-HISTORY_LEN)
      : [];
  return { settings, record: { streak, best, history } };
}
