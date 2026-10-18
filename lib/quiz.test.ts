import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUIZ_SETTINGS,
  DEFAULT_SAVED,
  EMPTY_RECORD,
  HISTORY_LEN,
  answerOf,
  breakdownText,
  collarsOffered,
  diagnose,
  isRight,
  mistakes,
  parseQuizSaved,
  quizQuestion,
  scoreAnswer,
  serializeQuizSaved,
  typeKey,
} from './quiz.ts';
import type { Question, QuizRig, QuizSettings } from './quiz.ts';
import { ELEIKO_KG, IRON_LB, plateFace, withLimits } from './plates.ts';
import type { Plate } from './plates.ts';
import { lbToKg } from './units.ts';

const COMP: QuizRig = { set: 'comp', barKg: 20, collarKg: 0, inventory: ELEIKO_KG };
const COMP_COLLARS: QuizRig = { ...COMP, collarKg: 2.5 };
const TRAINING: QuizRig = { set: 'training', barKg: lbToKg(45), collarKg: 0, inventory: IRON_LB };
const kg = (n: number): Plate => ELEIKO_KG.find((p) => p.kg === n)!;
const lb = (face: string): Plate => IRON_LB.find((p) => p.label === face)!;

// A hand-made question, for the scoring and wording tests.
function q(side: Plate[], rig: QuizRig, collarKg = 0): Question {
  const sideKg = side.reduce((s, p) => s + p.kg, 0);
  const totalKg = rig.barKg + 2 * collarKg + 2 * sideKg;
  const lbSet = rig.set === 'training';
  const sideShown = side.reduce((s, p) => s + Number(plateFace(p)), 0);
  return {
    index: 0,
    set: rig.set,
    side,
    barKg: rig.barKg,
    collarKg,
    totalKg,
    unit: lbSet ? 'lb' : 'kg',
    sideShown,
    totalShown: lbSet ? Math.round(totalKg / 0.45359237) : totalKg,
  };
}

describe('quizQuestion', () => {
  it('is the same question for the same seed and index', () => {
    const a = quizQuestion(7, 3, COMP, DEFAULT_QUIZ_SETTINGS);
    const b = quizQuestion(7, 3, COMP, DEFAULT_QUIZ_SETTINGS);
    expect(a).toEqual(b);
  });

  it('different seeds give different lists', () => {
    const list = (seed: number) =>
      Array.from({ length: 8 }, (_, i) => quizQuestion(seed, i, COMP, DEFAULT_QUIZ_SETTINGS)!.totalShown);
    expect(list(1)).not.toEqual(list(2));
  });

  it('adds up Bar + 2 x Side on Competition, in kg', () => {
    const x = quizQuestion(11, 0, COMP, DEFAULT_QUIZ_SETTINGS)!;
    expect(x.unit).toBe('kg');
    expect(x.collarKg).toBe(0);
    expect(x.side.length).toBeGreaterThan(0);
    expect(x.totalShown).toBeCloseTo(20 + 2 * x.sideShown, 9);
  });

  it('reads Training in lb, from the stamps', () => {
    const x = quizQuestion(11, 0, TRAINING, DEFAULT_QUIZ_SETTINGS)!;
    expect(x.unit).toBe('lb');
    expect(x.side.every((p) => p.color === 'iron')).toBe(true);
    expect(x.totalShown).toBe(45 + 2 * x.sideShown);
  });

  it('question 1 carries the Collars when Setup has them and the gear says Some', () => {
    const x = quizQuestion(5, 0, COMP_COLLARS, DEFAULT_QUIZ_SETTINGS)!;
    expect(x.collarKg).toBe(2.5);
    expect(x.totalShown).toBeCloseTo(25 + 2 * x.sideShown, 9);
  });

  it('never carries Collars when Setup has none, whatever the gear says', () => {
    const always: QuizSettings = { ...DEFAULT_QUIZ_SETTINGS, collars: 'always' };
    for (let i = 0; i < 20; i++) expect(quizQuestion(3, i, COMP, always)!.collarKg).toBe(0);
  });

  it('never carries Collars on the lb set (they are kg collars)', () => {
    const rig = { ...TRAINING, collarKg: 2.5 };
    expect(collarsOffered(rig)).toBe(false);
    const always: QuizSettings = { ...DEFAULT_QUIZ_SETTINGS, collars: 'always' };
    for (let i = 0; i < 10; i++) expect(quizQuestion(3, i, rig, always)!.collarKg).toBe(0);
  });

  it('has no change Plates when the gear turns them off', () => {
    const off: QuizSettings = { ...DEFAULT_QUIZ_SETTINGS, change: false };
    for (let i = 0; i < 30; i++) {
      expect(quizQuestion(9, i, COMP, off)!.side.every((p) => p.kg >= 5)).toBe(true);
      expect(quizQuestion(9, i, TRAINING, off)!.side.every((p) => Number(p.label) >= 10)).toBe(true);
    }
  });

  it('keeps to the Plates per side choice', () => {
    for (const maxPlates of [2, 4, 6] as const) {
      for (let i = 0; i < 30; i++) {
        const x = quizQuestion(4, i, COMP, { ...DEFAULT_QUIZ_SETTINGS, maxPlates })!;
        expect(x.side.length).toBeLessThanOrEqual(maxPlates);
      }
    }
  });

  it('honours the Plates on hand: a None size never appears', () => {
    const rig = { ...COMP, inventory: withLimits(ELEIKO_KG, { 25: 0, 20: 0 }) };
    for (let i = 0; i < 30; i++) {
      expect(quizQuestion(2, i, rig, DEFAULT_QUIZ_SETTINGS)!.side.some((p) => p.kg >= 20)).toBe(false);
    }
  });

  it('falls back to one Plate when the limits allow no Side in range', () => {
    const only = Object.fromEntries(ELEIKO_KG.filter((p) => p.kg !== 0.5).map((p) => [plateFace(p), 0]));
    const rig = { ...COMP, inventory: withLimits(ELEIKO_KG, { ...only, 0.5: 1 }) };
    const x = quizQuestion(1, 0, rig, { ...DEFAULT_QUIZ_SETTINGS, maxPlates: 6 })!;
    expect(x.side.map((p) => p.kg)).toEqual([0.5]);
  });

  it('is null when the lifter has no Plates at all', () => {
    const none = Object.fromEntries(ELEIKO_KG.map((p) => [plateFace(p), 0]));
    expect(quizQuestion(1, 0, { ...COMP, inventory: withLimits(ELEIKO_KG, none) }, DEFAULT_QUIZ_SETTINGS)).toBeNull();
  });
});

describe('isRight and diagnose', () => {
  const x = q([kg(25), kg(15), kg(2.5)], COMP); // 42.5 a side: 105 kg

  it('takes the Total, and only the Total', () => {
    expect(isRight(x, 105)).toBe(true);
    expect(isRight(x, 105.5)).toBe(false);
    expect(isRight(x, NaN)).toBe(false);
    expect(diagnose(x, 105)).toBe('');
  });

  it('names the plausible mistakes', () => {
    expect(diagnose(x, 85)).toBe('Forgot the Bar');
    expect(diagnose(x, 62.5)).toBe('Counted one side');
    expect(diagnose(x, 95)).toBe('Read a 25 as a 20');
    expect(diagnose(x, 100)).toBe('Missed the 2.5');
    expect(diagnose(x, 42.5)).toBe('That is one side');
  });

  it('says how far off anything else is', () => {
    expect(diagnose(x, 107)).toBe('+2 kg off');
    expect(diagnose(x, 103.5)).toBe('-1.5 kg off');
  });

  it('names forgotten Collars', () => {
    const c = q([kg(20)], COMP_COLLARS, 2.5); // 20 + 5 + 40 = 65
    expect(c.totalShown).toBe(65);
    expect(diagnose(c, 60)).toBe('Forgot the collars');
  });

  it('reads lb answers on the iron set', () => {
    const t = q([lb('45'), lb('25'), lb('2.5')], TRAINING); // 72.5 a side: 190 lb
    expect(t.totalShown).toBe(190);
    expect(isRight(t, 190)).toBe(true);
    expect(diagnose(t, 145)).toBe('Forgot the Bar');
    expect(diagnose(t, 185)).toBe('Missed the 2.5');
  });

  it('no mistake is the right Total, and none repeats', () => {
    const ms = mistakes(x);
    expect(ms.some((m) => m.value === 105)).toBe(false);
    expect(new Set(ms.map((m) => m.value)).size).toBe(ms.length);
  });
});

describe('breakdownText', () => {
  it('adds the Bar, and the Collars when on', () => {
    expect(breakdownText(q([kg(25), kg(15), kg(2.5)], COMP), '20 kg')).toBe(
      '= 42.5 x 2 + 20 kg bar = 105 kg',
    );
    expect(breakdownText(q([kg(20)], COMP_COLLARS, 2.5), '20 kg')).toBe(
      '= 20 x 2 + 20 kg bar + 2 x 2.5 kg collars = 65 kg',
    );
  });
});

describe('typeKey and answerOf', () => {
  const typed = (keys: string[]) => keys.reduce(typeKey, '');
  it('types digits, one point, and deletes', () => {
    expect(typed(['1', '0', '2', '.', '5'])).toBe('102.5');
    expect(typed(['1', '.', '.', '5'])).toBe('1.5');
    expect(typed(['.', '5'])).toBe('5');
    expect(typed(['0', '7'])).toBe('7');
    expect(typed(['9', '9', 'del'])).toBe('9');
    expect(typed(['1', '2', '3', '4', '5', '6', '7'])).toBe('123456');
  });
  it('reads the answer', () => {
    expect(answerOf('')).toBeNull();
    expect(answerOf('12.')).toBe(12);
    expect(answerOf('102.5')).toBe(102.5);
  });
});

describe('scoreAnswer', () => {
  it('counts the streak, keeps the best, ends on a miss', () => {
    let r = EMPTY_RECORD;
    r = scoreAnswer(r, true);
    r = scoreAnswer(r, true);
    expect(r).toEqual({ streak: 2, best: 2, history: [true, true] });
    r = scoreAnswer(r, false);
    expect(r).toEqual({ streak: 0, best: 2, history: [true, true, false] });
  });
  it('keeps the last ten answers', () => {
    let r = EMPTY_RECORD;
    for (let i = 0; i < 15; i++) r = scoreAnswer(r, i % 2 === 0);
    expect(r.history).toHaveLength(HISTORY_LEN);
  });
});

describe('parseQuizSaved', () => {
  it('reads nothing or junk as the defaults', () => {
    expect(parseQuizSaved(null)).toEqual(DEFAULT_SAVED);
    expect(parseQuizSaved('{')).toEqual(DEFAULT_SAVED);
    expect(parseQuizSaved('[]')).toEqual(DEFAULT_SAVED);
  });
  it('round-trips', () => {
    const s = {
      settings: { maxPlates: 6, change: false, collars: 'always', numbers: true } as const,
      record: { streak: 3, best: 9, history: [true, false, true] },
    };
    expect(parseQuizSaved(serializeQuizSaved(s))).toEqual(s);
  });
  it('drops a bad field and keeps the rest', () => {
    const raw = JSON.stringify({ settings: { maxPlates: 5, numbers: true }, streak: 4, best: 2 });
    const s = parseQuizSaved(raw);
    expect(s.settings).toEqual({ ...DEFAULT_QUIZ_SETTINGS, numbers: true });
    expect(s.record.best).toBe(4);
  });
});
