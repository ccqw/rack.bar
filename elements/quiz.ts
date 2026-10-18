// <rack-quiz> -- the Loadout quiz page (RBAR-92, slice 1: read the bar), game.html's one
// element. Direction A, the flashcard: one loaded Side is drawn by <rack-sleeve>, the
// lifter types the Total on the keypad and Checks it. Right flashes green and moves on;
// wrong flashes red, names the likely mistake and shows the breakdown ("25 15 2.5 =
// 42.5 x 2 + 20 kg bar = 105 kg"), then Next. A streak and the best streak sit in the
// header; the last ten answers are dots under it.
//
// The core is lib/quiz.ts (pure, seeded): this element only wires the DOM to it
// (ADR-0001). The plate set, Bar, Collar and Plates on hand are the lifter's Setup,
// read through elements/rig.ts; the quiz's own settings and its streak persist under
// `rackbar.quiz` (ADR-0007). The column fits one phone screen (ADR-0013): only the
// bar block flexes.
import './sleeve.ts';
import './quizgear.ts';
import type { GearRig } from './quizgear.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { DISC_FILL } from './discfill.ts';
import { SHORT_SCREEN } from './fit.ts';
import { readPersisted, writePersisted } from './persist.ts';
import { SETUP_LINK, loadRig } from './rig.ts';
import { BACK_GLYPH, GEAR_GLYPH } from './quizglyphs.ts';
import { DEL_ICON } from './delglyph.ts';
import { DISC_INK, darkInk, plateLabel } from '../lib/sleevefit.ts';
import { PLATE_SETS } from '../lib/platesets.ts';
import { barLabel, barsFor } from '../lib/custombars.ts';
import { inventoryOnHand } from '../lib/platesonhand.ts';
import { format } from '../lib/units.ts';
import type { Plate } from '../lib/plates.ts';
import {
  HISTORY_LEN,
  answerOf,
  breakdownTerms,
  collarsOffered,
  diagnose,
  isRight,
  parseQuizSaved,
  quizQuestion,
  scoreAnswer,
  serializeQuizSaved,
  typeKey,
} from '../lib/quiz.ts';
import type { Question, QuizRecord, QuizRig, QuizSettings } from '../lib/quiz.ts';

/** The quiz's own stored value: its settings and its streak (lib/quiz.ts). */
export const QUIZ_KEY = 'rackbar.quiz';

/** How long a right answer shows before the next question. */
export const RIGHT_PAUSE_MS = 750;

type Sleeve = HTMLElement & {
  sideLoad: readonly Plate[];
  /** Draw a Collar on the outer disc (RBAR-96). */
  collars: boolean;
  /** Show the engraved numbers on the discs (iron always shows its stamp). */
  numerals: boolean;
};
type Gear = HTMLElement & {
  settings: QuizSettings;
  rig: GearRig;
  open(): void;
  close(): void;
};

type Phase = 'ask' | 'right' | 'wrong';

const KEYS: readonly (readonly [key: string, label: string])[] = [
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['del', ''],
  ['4', '4'],
  ['5', '5'],
  ['6', '6'],
  ['7', '7'],
  ['8', '8'],
  ['9', '9'],
  ['.', '.'],
  ['0', '0'],
];

class RackQuiz extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private rig!: QuizRig;
  private barName = '';
  private settings!: QuizSettings;
  private record!: QuizRecord;
  private seed = 0;
  private index = 0;
  private q: Question | null = null;
  private draft = '';
  private phase: Phase = 'ask';
  private wrongDraft = '';
  private t0 = 0;
  private ms = 0;
  private advanceTimer: ReturnType<typeof setTimeout> | undefined;

  private sleeve!: Sleeve;
  private gear!: Gear;
  private el: Record<string, HTMLElement> = {};

  connectedCallback(): void {
    // A fixed seed (`seed` attribute) replays one list -- tests, screenshots; a visit
    // otherwise gets a fresh list.
    const fixed = Number(this.getAttribute('seed'));
    this.seed = this.hasAttribute('seed') && Number.isFinite(fixed) ? fixed : randomSeed();
    const saved = parseQuizSaved(readPersisted(QUIZ_KEY));
    this.settings = saved.settings;
    this.record = saved.record;
    this.render();
    this.loadRig();
    this.newQuestion();
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('pageshow', this.onPageShow);
  }

  disconnectedCallback(): void {
    clearTimeout(this.advanceTimer);
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  /** The question on screen (tests read it). */
  get question(): Question | null {
    return this.q;
  }

  // Back from the calculator through the browser's back/forward cache: Setup may have
  // changed, so read the rig again and start a fresh question on it.
  private onPageShow = (e: PageTransitionEvent): void => {
    if (!e.persisted) return;
    this.loadRig();
    this.newQuestion();
  };

  private loadRig(): void {
    const stored = loadRig();
    const set = PLATE_SETS[stored.set];
    this.rig = {
      set: stored.set,
      barKg: stored.barKg,
      collarKg: stored.collarKg,
      inventory: inventoryOnHand(stored.platesOnHand, stored.set),
    };
    const bar = barsFor(set, stored.customBars).find((b) => b.kg === stored.barKg);
    this.barName = bar ? barLabel(bar) : format(stored.barKg, set.unit);
    this.el.qn.innerHTML = `<span class="qp">Loadout quiz &middot; </span>${esc(this.barName)} bar`;
    this.gear.rig = {
      name: `${set.label}, ${this.barName} bar`,
      collarsOffered: collarsOffered(this.rig),
      collarsNote: stored.collarKg > 0 ? 'kg set only' : 'Setup has none',
      iron: set.unit === 'lb',
    };
  }

  private save(): void {
    writePersisted(QUIZ_KEY, serializeQuizSaved({ settings: this.settings, record: this.record }));
  }

  private newQuestion(): void {
    clearTimeout(this.advanceTimer);
    this.q = quizQuestion(this.seed, this.index, this.rig, this.settings);
    this.draft = '';
    this.wrongDraft = '';
    this.phase = 'ask';
    this.t0 = performance.now();
    this.sleeve.sideLoad = this.q?.side ?? [];
    this.sleeve.collars = (this.q?.collarKg ?? 0) > 0;
    this.update();
  }

  private next(): void {
    this.index++;
    this.newQuestion();
  }

  private press(key: string): void {
    if (this.phase !== 'ask' || !this.q) return;
    this.draft = typeKey(this.draft, key);
    this.update();
  }

  // Check the typed answer, or Show the Total (a Show is a miss: it ends the streak).
  // Returns whether it acted (checked, showed, or moved on from a wrong answer).
  private check(show: boolean): boolean {
    const q = this.q;
    if (!q) return false;
    if (this.phase === 'wrong') {
      this.next();
      return true;
    }
    if (this.phase !== 'ask') return false;
    const answer = answerOf(this.draft);
    if (!show && answer === null) return false;
    this.ms = performance.now() - this.t0;
    const right = !show && answer !== null && isRight(q, answer);
    this.record = scoreAnswer(this.record, right);
    this.save();
    this.phase = right ? 'right' : 'wrong';
    this.wrongDraft = show ? '' : this.draft;
    this.update();
    if (right) this.advanceTimer = setTimeout(() => this.next(), RIGHT_PAUSE_MS);
    return true;
  }

  // The physical keyboard: digits, point and Backspace type; Enter checks. Enter on a
  // focused link or button is that control's own (the back link navigates, Show shows,
  // the gear opens), so it is left alone; and Enter is cancelled only when the check
  // actually acted, never swallowed for nothing.
  private onKey = (e: KeyboardEvent): void => {
    if (!this.gear.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter') {
      const target = e.composedPath()[0];
      if (target instanceof Element && target.closest('a, button')) return;
      if (this.check(false)) e.preventDefault();
      return;
    }
    if (/^[0-9.]$/.test(e.key)) this.press(e.key);
    else if (e.key === 'Backspace') this.press('del');
    else return;
    e.preventDefault();
  };

  private changeSettings(next: QuizSettings): void {
    this.settings = next;
    // New settings start a new run: the streak counted on the old ones ends here.
    this.record = { ...this.record, streak: 0 };
    this.save();
    this.newQuestion();
  }

  private render(): void {
    const keys = KEYS.map(([k, label]) =>
      k === 'del'
        ? `<button type="button" class="k fn" data-key="del" aria-label="Delete">${DEL_ICON}</button>`
        : `<button type="button" class="k" data-key="${k}">${label}</button>`,
    );
    // Row by row: 1 2 3 del / 4 5 6 [go] / 7 8 9 / . 0 Show; go spans the last three.
    const pad = [
      ...keys.slice(0, 4),
      ...keys.slice(4, 7),
      `<button type="button" class="go" data-go disabled>Check</button>`,
      ...keys.slice(7, 12),
      `<button type="button" class="k fn" data-show>Show</button>`,
    ].join('');
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host {
          display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%;
          max-width: 520px; margin: 0 auto;
          padding: 0 20px 12px; gap: 10px;
          color: var(--rack-text); font-family: var(--rack-font);
          -webkit-font-smoothing: antialiased;
        }
        /* One phone screen (ADR-0013): every block keeps its height but the bar block,
           which takes what is left (clamped). */
        :host > * { flex: none; }
        button { font-family: inherit; color: inherit; cursor: pointer; }
        button:focus-visible, a:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .hd { height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .back {
          display: inline-flex; align-items: center; gap: 6px; min-height: 44px;
          padding: 0 8px 0 0; color: var(--rack-text); text-decoration: none;
          font-size: 16px; font-weight: 800; letter-spacing: -.01em;
          -webkit-tap-highlight-color: transparent;
        }
        .back .dot { color: var(--rack-accent); }
        .back svg { color: var(--rack-text-dim); display: block; }
        .hdr { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .score {
          display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;
          font: 600 12px var(--rack-font-num); color: var(--rack-text-secondary);
          border: 1px solid var(--rack-border-muted); border-radius: 999px; padding: 8px 12px;
          font-variant-numeric: tabular-nums;
        }
        .score b { color: var(--rack-text); font-weight: 800; }
        .score .sep { width: 1px; height: 12px; background: var(--rack-border-active); }
        .score[data-pop] b[data-streak] { color: var(--rack-accent); }
        .ib {
          position: relative; flex: none; width: 36px; height: 36px; border-radius: 999px;
          border: 1px solid var(--rack-border-muted); background: var(--rack-raised);
          display: grid; place-items: center; padding: 0; color: var(--rack-text-secondary);
        }
        .ib::after { content: ""; position: absolute; inset: -5px; }
        .ib svg { display: block; }
        .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .hist { display: flex; gap: 4px; align-items: center; }
        .hist i { width: 8px; height: 8px; border-radius: 999px; background: var(--rack-border-muted); }
        .hist i[data-r="1"] { background: var(--rack-success); }
        .hist i[data-r="0"] { background: var(--rack-danger); }
        .qn {
          font: 600 11px var(--rack-font-num); color: var(--rack-text-dim);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
        }
        /* The bar block: the one flexing block. The flash ring sits over it. */
        .viz {
          flex: 1 1 auto; min-height: 104px; max-height: 204px;
          display: flex; position: relative;
          /* The Home Screen app's spare height goes under it (RBAR-99, tokens.css). */
          margin-bottom: var(--rack-bar-air);
        }
        .viz rack-sleeve { flex: 1 1 0; min-height: 0; min-width: 0; }
        .flash { position: absolute; inset: 0; border-radius: 14px; pointer-events: none; }
        .viz[data-phase="right"] .flash { box-shadow: inset 0 0 0 2px var(--rack-success); }
        .viz[data-phase="wrong"] .flash { box-shadow: inset 0 0 0 2px var(--rack-danger); }
        .empty {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          text-align: center; font: 500 13px/1.5 var(--rack-font-num); color: var(--rack-text-dim);
        }
        .empty[hidden] { display: none; }
        .empty a { color: var(--rack-accent); }
        .ans { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .big {
          font-weight: 800; font-size: 48px; letter-spacing: -.025em; line-height: 1;
          font-variant-numeric: tabular-nums; min-height: 48px;
          display: flex; align-items: baseline; gap: 8px; white-space: nowrap;
        }
        .big .u { font-size: 20px; font-weight: 600; color: var(--rack-text-dim); letter-spacing: 0; }
        .big .ph { color: var(--rack-text-disabled); }
        .big s {
          font-size: 24px; color: var(--rack-danger); text-decoration-thickness: 2px; font-weight: 700;
        }
        .big[data-phase="right"] { color: var(--rack-success); }
        .fb {
          min-height: 44px; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 5px; text-align: center;
        }
        .lbl {
          font: 600 11px var(--rack-font-num); letter-spacing: .14em; text-transform: uppercase;
          color: var(--rack-text-dim);
        }
        .why { font: 700 13px var(--rack-font); color: var(--rack-accent); }
        .t { font: 500 12px var(--rack-font-num); color: var(--rack-text-dim); }
        .t b { color: var(--rack-text); font-weight: 700; }
        .math {
          display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center;
          font: 600 12px var(--rack-font-num); color: var(--rack-text-secondary);
        }
        .math span { white-space: nowrap; }
        .math span:last-child { color: var(--rack-text); font-weight: 700; }
        .mc {
          --disc: var(--rack-plate-red);
          font: 800 10.5px var(--rack-font-num); line-height: 1; padding: 4px 6px; border-radius: 4px;
          color: ${DISC_INK.light}; ${DISC_FILL} box-shadow: var(--rack-shadow-disc);
        }
        .mc[data-dark] { color: ${DISC_INK.dark}; }
        .pad {
          --kh: 50px;
          display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
          grid-template-rows: repeat(4, var(--kh)); gap: 7px;
        }
        .pad button {
          border-radius: 13px; border: 1px solid var(--rack-border-muted);
          background: var(--rack-raised); font: 700 20px var(--rack-font-num); padding: 0;
          display: grid; place-items: center;
        }
        .pad .k:active { background: var(--rack-selected); }
        .pad .fn { font: 600 13px var(--rack-font); color: var(--rack-text-secondary); }
        .pad .go {
          grid-column: 4; grid-row: 2 / span 3;
          background: var(--rack-accent); border-color: var(--rack-accent);
          color: var(--rack-accent-ink); font: 800 16px var(--rack-font);
        }
        .pad .go:disabled {
          background: var(--rack-raised); border-color: var(--rack-border-muted);
          color: var(--rack-text-disabled); cursor: default;
        }
        .sr {
          position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
          overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
        }
        @media (prefers-reduced-motion: no-preference) {
          .big[data-phase="right"], .score[data-pop] b[data-streak] { animation: pulse .32s ease-out; }
          @keyframes pulse { from { transform: scale(1.12); } to { transform: none; } }
        }
        /* A narrow phone (320 wide): the row names just the Bar, so it is never cut. */
        @media (max-width: 360px) {
          .qp { display: none; }
        }
        /* The short-screen tier (ADR-0013): spacing and the keypad's key height only. */
        @media ${SHORT_SCREEN} {
          :host { gap: 7px; padding-bottom: 10px; }
          .hd { height: 50px; }
          .pad { --kh: 40px; gap: 6px; }
          .big { font-size: 40px; min-height: 40px; }
          .fb { min-height: 40px; }
        }
      </style>
      <header class="hd">
        <a class="back" href="/" aria-label="Back to rack.bar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">${BACK_GLYPH}</svg>
          <span>rack<span class="dot">.</span>bar</span>
        </a>
        <div class="hdr">
          <span class="score" data-score>
            <span>Streak</span><b data-streak>0</b><span class="sep"></span><span>Best</span><b data-best>0</b>
          </span>
          <button type="button" class="ib" data-gear aria-label="Loadout quiz settings"
                  aria-haspopup="dialog">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor"
                 stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${GEAR_GLYPH}</svg>
          </button>
        </div>
      </header>
      <h1 class="sr">Loadout quiz</h1>
      <div class="row">
        <span class="hist" data-hist aria-hidden="true">${'<i></i>'.repeat(HISTORY_LEN)}</span>
        <span class="qn" data-qn></span>
      </div>
      <div class="viz" data-viz>
        <rack-sleeve></rack-sleeve>
        <span class="flash" aria-hidden="true"></span>
        <p class="empty" data-empty hidden>No Plates on hand.<br><a href="${SETUP_LINK}">Set them in Setup</a></p>
      </div>
      <div class="ans">
        <div class="big" data-big></div>
        <div class="fb" data-fb></div>
      </div>
      <div class="pad" data-pad>${pad}</div>
      <p class="sr" role="status" data-announce></p>
      <rack-quiz-gear></rack-quiz-gear>
    `;
    const $ = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    this.el = {
      score: $('[data-score]'),
      streak: $('[data-streak]'),
      best: $('[data-best]'),
      hist: $('[data-hist]'),
      qn: $('[data-qn]'),
      viz: $('[data-viz]'),
      empty: $('[data-empty]'),
      big: $('[data-big]'),
      fb: $('[data-fb]'),
      go: $('[data-go]'),
      announce: $('[data-announce]'),
    };
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;
    this.gear = this.root.querySelector('rack-quiz-gear') as Gear;
    this.gear.settings = this.settings;
    this.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) =>
      b.addEventListener('click', () => this.press(b.dataset.key!)),
    );
    this.el.go.addEventListener('click', () => this.check(false));
    $('[data-show]').addEventListener('click', () => this.check(true));
    const gearBtn = $('[data-gear]');
    gearBtn.addEventListener('click', () => {
      gearBtn.setAttribute('aria-expanded', 'true');
      this.gear.open();
    });
    this.gear.addEventListener('close', () => {
      gearBtn.setAttribute('aria-expanded', 'false');
      gearBtn.focus();
    });
    this.gear.addEventListener('settingschange', (e) =>
      this.changeSettings((e as CustomEvent<QuizSettings>).detail),
    );
  }

  // Bring the screen in line with the state: score, dots, the bar's ring and numbers,
  // the big number, the feedback line and the go key.
  private update(): void {
    const { el, q, phase, record } = this;
    el.streak.textContent = String(record.streak);
    el.best.textContent = String(record.best);
    el.score.setAttribute('aria-label', `Streak ${record.streak}, best ${record.best}`);
    el.score.toggleAttribute('data-pop', phase === 'right');
    const dots = el.hist.children;
    const pad = HISTORY_LEN - record.history.length;
    for (let i = 0; i < HISTORY_LEN; i++) {
      const h = record.history[i - pad];
      if (h === undefined) delete (dots[i] as HTMLElement).dataset.r;
      else (dots[i] as HTMLElement).dataset.r = h ? '1' : '0';
    }
    el.viz.dataset.phase = phase;
    el.empty.hidden = q !== null;
    // Numbers on the discs: the gear's choice, and always on a wrong answer (the
    // breakdown names the Plates; the bar should too).
    this.sleeve.numerals = this.settings.numbers || phase === 'wrong';
    const go = el.go as HTMLButtonElement;
    if (!q) {
      el.big.innerHTML = '';
      el.fb.innerHTML = '';
      go.disabled = true;
      return;
    }
    const unit = `<span class="u">${q.unit}</span>`;
    el.big.dataset.phase = phase;
    if (phase === 'ask') {
      el.big.innerHTML = `${this.draft ? esc(this.draft) : '<span class="ph">?</span>'}${unit}`;
      el.fb.innerHTML = `<span class="lbl">Total</span>`;
      go.textContent = 'Check';
      go.disabled = this.draft === '';
      el.announce.textContent = '';
    } else if (phase === 'right') {
      el.big.innerHTML = `${q.totalShown}${unit}`;
      el.fb.innerHTML = `<span class="t"><b>Right</b> &middot; ${(this.ms / 1000).toFixed(1)} s</span>`;
      go.textContent = 'Check';
      go.disabled = true;
      el.announce.textContent = `Right, ${q.totalShown} ${q.unit}. Streak ${record.streak}.`;
    } else {
      const typed = this.wrongDraft;
      const answer = answerOf(typed);
      const why = answer === null ? '' : diagnose(q, answer);
      el.big.innerHTML = `${typed ? `<s>${esc(typed)}</s>` : ''}${q.totalShown}${unit}`;
      el.fb.innerHTML =
        (why ? `<span class="why" data-why>${esc(why)}</span>` : '') +
        `<div class="math" data-math>${chips(q.side)}${breakdownTerms(q, this.barName)
          .map((t) => `<span>${esc(t)}</span>`)
          .join('')}</div>`;
      go.textContent = 'Next';
      go.disabled = false;
      el.announce.textContent = `${why ? why + '. ' : ''}The Total is ${q.totalShown} ${q.unit}.`;
    }
  }
}

// The breakdown's Plate chips, heaviest first, in their plate colours.
function chips(side: readonly Plate[]): string {
  return side
    .map(
      (p) =>
        `<span class="mc" style="--disc: var(--rack-plate-${p.color})"${darkInk(p.color) ? ' data-dark' : ''}>${plateLabel(p)}</span>`,
    )
    .join('');
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

customElements.define('rack-quiz', RackQuiz);
