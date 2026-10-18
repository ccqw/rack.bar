// fit-check.js -- the RBAR-67 phone-fit check: no vertical scroll in any default state.
//
// happy-dom cannot measure layout, so this is the layout check the Vitest suite can't
// be. It is a Playwright snippet (one `async (page) => ...` function), run against a
// live dev server -- e.g. through the Playwright MCP's run-code tool with this file as
// its `filename`, after `npm run dev -- --port 5198` (ORIGIN below). It opens its own
// tab, so nothing else driving the shared browser can navigate it mid-run.
// It walks every Must state from the ticket (and, since RBAR-65, the Warm up states) at
// each VISIBLE Safari viewport (toolbars showing -- never the full screen height, which
// hides the overflow) and returns one line per viewport + state (the worst across both
// plate sets and both units): the document's scrollHeight against the viewport's
// innerHeight, `over` = how far the page would scroll (0 = it fits), and the sleeve's
// flexed height. Since RBAR-75 the Share and fullscreen buttons overlap the sleeve's
// top-right, so each state also hit-tests them over its loadout (bare Bar through a full
// sleeve, both plate sets): the centre and the bottom edge of each drawn 30px box must
// land on that button, or the line reads ICONS BLOCKED (ICONS MISSING if the selector no
// longer finds exactly two). The Setup states (RBAR-76) add the sheet's height, how far
// it runs above the viewport (`over`, 0 = it fits), and how far its Bar row scrolls
// sideways inside the sheet. Since RBAR-72 the Setup lines also give how far the
// sheet would scroll inside (the most across both sets and units): any inner scroll
// reads SHEET SCROLLS and adds a FAIL line (since the RBAR-72 SE tightening, the sheet
// fits at every viewport), and the RBAR-72 states open a size's None..All row with
// limits stored. Since RBAR-58 (the By Weight Target block is gone; the Target splits
// off the hero as a "You asked" chip) each state also measures how far the status line
// -- Secondary or chip, plus the pill -- runs past the readout's edges (LINE CLIPPED n),
// and the walk adds the split states: the round-up taken (chip + over pill) and the
// keypad open on a split Target. Since RBAR-72 slice 3 the walk adds Warm up under
// Plate limits with a drifted stair ("~83%"), and each state measures how far the
// widest stair name runs past its column (STAIR NAME CLIPPED n).
// Since RBAR-92 the main header carries the Loadout quiz door left of the Setup pill;
// each state measures how far the header row's items run past it (HEADER CLIPPED n).
// Since RBAR-103 each state also counts the Setup pill label's line boxes: more than one
// reads PILL WRAPS n and adds a FAIL line; a quiz door with no box in the header reads
// QUIZ HIDDEN (and fails); a label cut short by its ellipsis reads "pill cut n px"
// (allowed -- the full text is kept wherever it fits).
// Since RBAR-84 every state runs with five saved maxes stored (Setup's Maxes row shows),
// and the By Weight walk adds a Target typed as a percent of one: the keypad open with
// its lift row, the "82.5% Squat = 115.5 kg" chip on a miss (LINE CLIPPED counts it), and
// the Maxes sheet open on the keypad's add form and on Setup's list (SHEET SCROLLS).
// The quiz page (game.html) is walked too, as "quiz:" lines: a question, a right answer,
// a wrong answer with its named mistake and breakdown, and the gear sheet open, on both
// plate sets with Setup's collars off and on, at Plates per side up to 6. Each line has
// the bar block's height, how far the breakdown line runs past the column (MATH CLIPPED
// n) and how far the gear sheet would scroll inside (SHEET SCROLLS n).
//
//   393x659 -- iPhone 15/16 in Safari (the Must)
//   375x548 -- iPhone SE in Safari (the Nice)
//   430x739 -- Pro Max in Safari (the Should)
//   320x548 -- the narrowest supported width (horizontal-scroll guard)
async (shared) => {
  const ORIGIN = 'http://localhost:5198';
  const page = await shared.context().newPage();
  const SIZES = [
    [393, 659],
    [375, 548],
    [430, 739],
    [320, 548],
  ];
  // Recent Targets, canonical kg: a round-up Target (100.3 -> 100 short, "Round up ->
  // 101"), an exact one on Comp (142), and an over-capacity one
  // ("Bar at capacity").
  const RECENTS = [100.3, 142, 1000, 60, 185, 225];

  // Reach into <rack-app> -> <rack-console> -> (child) shadow roots.
  const inConsole = (fn, arg) =>
    page.evaluate(
      ([src, a]) => {
        const con = document.querySelector('rack-app').shadowRoot.querySelector('rack-console');
        return new Function('con', 'a', src)(con.shadowRoot, a);
      },
      [fn, arg],
    );
  const measure = () =>
    page.evaluate(() => {
      const d = document.documentElement;
      const con = document.querySelector('rack-app').shadowRoot.querySelector('rack-console')
        .shadowRoot;
      // Exactly Share + fullscreen: an empty match must not pass the hit-test vacuously.
      const btns = [...con.querySelectorAll('.icons .iconbtn')];
      const iconsMissing = btns.length !== 2;
      const iconsHit = btns.every((b) => {
        const r = b.getBoundingClientRect();
        const x = r.left + r.width / 2;
        return [r.top + r.height / 2, r.bottom - 2].every(
          (y) => con.elementFromPoint(x, y)?.closest('button') === b,
        );
      });
      // The Setup sheet (RBAR-76): when open, how far its panel runs above the viewport
      // top (0 = the whole sheet shows) and how far its Bar row scrolls sideways (the
      // custom Bars scroll inside the row, never the page).
      const setup = document.querySelector('rack-app').shadowRoot.querySelector('rack-setup');
      const row = setup.shadowRoot.querySelector('[data-bar-tiles]');
      // The Another way sheet (RBAR-66) is measured the same way when it is the open one;
      // it scrolls inside itself, so `inner` is how far its own list would scroll.
      const ways = con.querySelector('rack-ways');
      const maxes = document.querySelector('rack-app').shadowRoot.querySelector('rack-maxes');
      const open = !maxes.hidden ? maxes : !setup.hidden ? setup : !ways.hidden ? ways : null;
      const panel = open ? open.shadowRoot.querySelector('[data-panel]') : null;
      // The round-up row (RBAR-66 adds Another way beside the round-up): its shown items
      // plus gaps must fit its width on one line, or the row would wrap or clip.
      const ru = con.querySelector('[data-roundup-row]');
      const items = [...ru.children].filter((k) => k.getClientRects().length > 0);
      const itemsW = items.reduce((s, k) => s + k.getBoundingClientRect().width, 0);
      const gap = parseFloat(getComputedStyle(ru).columnGap) || 0;
      const ruOver = items.length
        ? Math.max(0, Math.ceil(itemsW + gap * (items.length - 1) - ru.clientWidth))
        : 0;
      // The status line's visible children against the readout's box (RBAR-58).
      const ro = con.querySelector('.readout').getBoundingClientRect();
      const kids = [...con.querySelectorAll('.statusline > *')].filter((k) => !k.hidden);
      const lineClip = kids.reduce((m, k) => {
        const r = k.getBoundingClientRect();
        return Math.max(m, Math.ceil(ro.left - r.left), Math.ceil(r.right - ro.right));
      }, 0);
      // The Warm up stair names (RBAR-72 slice 3: a drifted row reads "~83%"): how far
      // the widest one runs past its stair's column (0 = every name fits).
      const nameClip = [
        ...con.querySelector('rack-warmup').shadowRoot.querySelectorAll('.st .nm'),
      ].reduce((m, n) => Math.max(m, n.scrollWidth - n.clientWidth), 0);
      // The header row (RBAR-92 adds the quiz door): how far its items run past it.
      const head = document.querySelector('rack-app').shadowRoot.querySelector('header');
      const hr = head.getBoundingClientRect();
      const headClip = [...head.children].reduce((m, k) => {
        const r = k.getBoundingClientRect();
        return Math.max(m, Math.ceil(hr.left + 22 - r.left), Math.ceil(r.right - (hr.right - 22)));
      }, 0);
      // The Setup pill (RBAR-103): its label's line boxes (one = it stays on one
      // line), how far its ellipsis cuts it, and whether the quiz door still shows
      // inside the header row.
      const label = head.querySelector('[data-pill-label]');
      const range = document.createRange();
      range.selectNodeContents(label);
      const pillLines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      const pillCut = label.scrollWidth - label.clientWidth;
      const qr = head.querySelector('[data-quiz-link]')?.getBoundingClientRect();
      const quizHidden = !qr || qr.width < 1 || qr.left < hr.left || qr.right > hr.right;
      return {
        headClip,
        pillLines,
        pillCut,
        quizHidden,
        ruOver,
        lineClip,
        nameClip,
        iconsMissing,
        iconsHit,
        sheetOver: panel ? Math.max(0, -Math.floor(panel.getBoundingClientRect().top)) : 0,
        sheetH: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
        rowScroll: open === setup ? row.scrollWidth - row.clientWidth : 0,
        sheetScroll: panel ? panel.scrollHeight - panel.clientHeight : 0,
        scrollH: d.scrollHeight,
        innerH: window.innerHeight,
        over: Math.max(0, d.scrollHeight - window.innerHeight),
        hscroll: Math.max(0, d.scrollWidth - window.innerWidth),
        sleeve: document
          .querySelector('rack-app')
          .shadowRoot.querySelector('rack-console')
          .shadowRoot.querySelector('rack-sleeve').clientHeight,
      };
    });

  const rows = [];
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const plateSet of ['comp', 'training']) {
      for (const unit of ['kg', 'lb']) {
        const reset = async (recents) => {
          await page.goto(ORIGIN + '/');
          await page.evaluate(
            ([set, u, r]) => {
              localStorage.clear();
              localStorage.setItem('rackbar.plateSet', set);
              localStorage.setItem('rackbar.unit', u);
              localStorage.setItem('rackbar.maxes', JSON.stringify([
                { name: 'Squat', value: 140, unit: 'kg' },
                { name: 'Bench', value: 85, unit: 'kg' },
                { name: 'Deadlift', value: 170, unit: 'kg' },
                { name: 'Front squat', value: 120, unit: 'kg' },
                { name: 'Clean', value: 100, unit: 'kg' },
              ]));
              if (r) localStorage.setItem('rackbar.recents', JSON.stringify(r));
            },
            [plateSet, unit, recents],
          );
          await page.reload();
          await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        };
        const record = async (state) =>
          rows.push({ size: `${w}x${h}`, plateSet, unit, state, ...(await measure()) });
        // Tap the Recent chip holding this kg Target (chips carry their canonical kg).
        const chip = (kg) =>
          inConsole(
            `con.querySelector('rack-recents').shadowRoot.querySelector('[data-target="' + a + '"]').click()`,
            kg,
          );

        await reset(null);
        await record('weight: fresh');
        await reset(RECENTS);
        await record('weight: recents, no Target');
        await chip(142);
        await record('weight: recents + loaded');
        // Another way (RBAR-66): a bar tap puts "Another way 2/5" in the round-up row.
        const tapBar = () => inConsole(`con.querySelector('rack-sleeve').click()`);
        await tapBar();
        await record('weight: another way 2/5');
        await chip(100.3);
        await record('weight: round-up offered');
        await tapBar();
        await record('weight: round-up + another way 2/5');
        await inConsole(`con.querySelector('[data-another]').click()`);
        await record('weight: another way sheet');
        await inConsole(
          `con.querySelector('rack-ways').shadowRoot.querySelector('[data-done]').click()`,
        );
        await inConsole(`con.querySelector('[data-over]').click()`);
        await record('weight: round-up taken');
        await inConsole(`con.querySelector('[data-asked]').click()`);
        await record('weight: keypad on a split Target');
        await inConsole(
          `con.querySelector('rack-entry').shadowRoot.querySelector('[data-done]').click()`,
        );
        await chip(1000);
        await record('weight: at capacity');
        // A percent of a saved max (RBAR-84): pick Squat in the keypad's lift row and
        // type 82.5 (115.5 kg, a miss on both sets), then the Maxes sheet's add form.
        const inEntry = (src) =>
          inConsole(`const e = con.querySelector('rack-entry').shadowRoot; ${src}`);
        await inConsole(`con.querySelector('[data-total-tap]').click()`);
        await inEntry(
          `e.querySelector('[data-lift="Squat"]').click();` +
            `for (const k of ['8','2','.','5']) e.querySelector('[data-key="' + k + '"]').click()`,
        );
        await record('weight: keypad on 82.5% of a max');
        await inEntry(`e.querySelector('[data-lift-add]').click()`);
        await page.evaluate(() => {
          const m = document.querySelector('rack-app').shadowRoot.querySelector('rack-maxes');
          m.shadowRoot.querySelector('[data-act="custom"]').click();
        });
        await record('maxes: add form');
        await page.evaluate(() => {
          const m = document.querySelector('rack-app').shadowRoot.querySelector('rack-maxes');
          m.shadowRoot.querySelector('[data-act="cancel"]').click();
        });
        await inEntry(`e.querySelector('[data-done]').click()`);
        await record('weight: 82.5% of a max');
        await inConsole(`con.querySelector('[data-mode="encode"]').click()`);
        await record('plates: empty');
        await inConsole(
          `const k=[...con.querySelector('rack-palette').shadowRoot.querySelectorAll('.key')];` +
            `for (const i of [0,0,1,2,3,4,k.length-1]) k[Math.min(i,k.length-1)].click()`,
        );
        await record('plates: loaded');
        // Warm up (RBAR-65 slice 2): the working-weight row + stairs + Next, keypad
        // closed. With no Target yet (the prompt), then a saved one (rackbar.target, RBAR-87;
        // 140 kg -- 309 lb) on the bare-Bar row, the 90% row (a swap on Comp kg) and the Working set.
        await reset(null);
        await inConsole(`con.querySelector('[data-mode="warmup"]').click()`);
        await record('warmup: no working weight');
        await page.evaluate(() => localStorage.setItem('rackbar.target', '140'));
        await page.reload();
        await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        await inConsole(`con.querySelector('[data-mode="warmup"]').click()`);
        const stair = (i) =>
          inConsole(
            `con.querySelector('rack-warmup').shadowRoot.querySelectorAll('.st')[a].click()`,
            i,
          );
        await record('warmup: Bar row');
        await stair(3);
        await record('warmup: 90% row');
        await stair(4);
        await record('warmup: Working set');
        // Warm up under Plate limits (RBAR-72 slice 3): no change Plates on hand, so a
        // 60 kg Comp Ramp's 90% set drifts to 50 kg and its stair reads "~83%" (Training
        // keeps only its big Plates). The drifted row selected, then the Working set.
        await page.evaluate(() => {
          localStorage.setItem('rackbar.target', '60');
          localStorage.setItem(
            'rackbar.platesOnHand',
            JSON.stringify({
              comp: { 2.5: 0, 2: 0, 1.5: 0, 1: 0, 0.5: 0 },
              training: { 10: 0, 5: 0, 2.5: 0 },
            }),
          );
        });
        await page.reload();
        await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        await inConsole(`con.querySelector('[data-mode="warmup"]').click()`);
        await stair(3);
        await record('warmup: drifted row (limits)');
        await stair(2);
        await record('warmup: Next to a drifted row (limits)');

        // The Setup sheet (RBAR-76, ADR-0017): bare, with the "+" entry open, and with
        // the three custom Bars the cap allows (one selected).
        const inApp = (src) =>
          page.evaluate((s) => {
            const sh = document.querySelector('rack-app').shadowRoot;
            return new Function('app', 'setup', s)(sh, sh.querySelector('rack-setup').shadowRoot);
          }, src);
        await reset(null);
        await inApp(`app.querySelector('[data-setup-pill]').click()`);
        await record('setup: open');
        await inApp(`setup.querySelector('[data-bar-add]').click()`);
        await record('setup: + entry');
        await page.evaluate(() => {
          localStorage.setItem(
            'rackbar.customBars',
            JSON.stringify([
              { value: 35, unit: 'lb' },
              { value: 15.9, unit: 'kg' },
              { value: 110, unit: 'lb' },
            ]),
          );
          localStorage.setItem('rackbar.barKg', String(110 * 0.45359237));
        });
        await page.reload();
        await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        await inApp(`app.querySelector('[data-setup-pill]').click()`);
        await record('setup: 3 custom Bars');
        // Pairs of Plates on Hand (RBAR-72): limits stored on both sets and the sheet
        // open; then the first size's None..All row opened.
        await page.evaluate(() =>
          localStorage.setItem(
            'rackbar.platesOnHand',
            JSON.stringify({ comp: { 25: 1, 15: 0, 0.5: 2 }, training: { 45: 1, 2.5: 0 } }),
          ),
        );
        await page.reload();
        await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        await inApp(`app.querySelector('[data-setup-pill]').click()`);
        await record('setup: limits stored');
        // Opening a row scrolls it into view inside the sheet (RBAR-72 review).
        await inApp(`setup.querySelector('[data-face]').click()`);
        await record('setup: size row open');
        // The Maxes row gives way to an open size row; closed again, it opens the list.
        await inApp(`setup.querySelector('[data-face]').click()`);
        await inApp(`setup.querySelector('[data-maxes-row]').click()`);
        await record('maxes: list over Setup');
      }
    }
  }
  // One line per viewport + state, worst case across the plate sets and units:
  // "393x659 weight: fresh -- scroll 659/659 over 0, sleeve 150px" (over 0 = it fits).
  const worst = new Map();
  // The Loadout quiz (RBAR-92, game.html): the flashcard column must fit the same
  // visible viewports, the bar block being the one block that gives.
  const quizRows = [];
  const quizMeasure = () =>
    page.evaluate(() => {
      const d = document.documentElement;
      const q = document.querySelector('rack-quiz').shadowRoot;
      const host = document.querySelector('rack-quiz').getBoundingClientRect();
      const math = q.querySelector('[data-math]');
      let mathClip = 0;
      if (math) {
        for (const k of math.children) {
          const r = k.getBoundingClientRect();
          mathClip = Math.max(mathClip, Math.ceil(host.left + 20 - r.left), Math.ceil(r.right - (host.right - 20)));
        }
      }
      const gear = q.querySelector('rack-quiz-gear');
      const panel = gear.hidden ? null : gear.shadowRoot.querySelector('[data-panel]');
      return {
        over: Math.max(0, d.scrollHeight - window.innerHeight),
        scrollH: d.scrollHeight,
        innerH: window.innerHeight,
        hscroll: Math.max(0, d.scrollWidth - window.innerWidth),
        sleeve: q.querySelector('rack-sleeve').clientHeight,
        mathClip,
        sheetH: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
        sheetOver: panel ? Math.max(0, -Math.floor(panel.getBoundingClientRect().top)) : 0,
        sheetScroll: panel ? panel.scrollHeight - panel.clientHeight : 0,
      };
    });
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const plateSet of ['comp', 'training']) {
      for (const collar of ['0', '2.5']) {
        await page.goto(ORIGIN + '/game.html');
        await page.evaluate(
          ([set, c]) => {
            localStorage.clear();
            localStorage.setItem('rackbar.plateSet', set);
            localStorage.setItem('rackbar.collarKg', c);
            localStorage.setItem(
              'rackbar.quiz',
              JSON.stringify({ settings: { maxPlates: 6, collars: 'always' } }),
            );
          },
          [plateSet, collar],
        );
        await page.reload();
        await page.waitForFunction(() => !!document.querySelector('rack-quiz')?.question);
        const record = async (state) =>
          quizRows.push({ key: `${w}x${h} quiz: ${state}`, ...(await quizMeasure()) });
        const inQuiz = (src) =>
          page.evaluate((s) => {
            const el = document.querySelector('rack-quiz');
            return new Function('el', 'q', s)(el, el.shadowRoot);
          }, src);
        const type = (v) =>
          inQuiz(
            `for (const c of ${JSON.stringify(String(v))}) q.querySelector('[data-key="' + c + '"]').click();` +
              `q.querySelector('[data-go]').click()`,
          );
        await record('question');
        await type(await inQuiz('return el.question.totalShown'));
        await record('right answer');
        await page.waitForTimeout(900);
        // Forgetting the Bar: the named mistake plus the longest breakdown (collars on).
        await type(await inQuiz('return 2 * (el.question.sideShown + el.question.collarKg)'));
        await record('wrong answer + breakdown');
        await inQuiz(`q.querySelector('[data-gear]').click()`);
        await record('gear open');
      }
    }
  }
  for (const r of quizRows) {
    const prev = worst.get(r.key);
    if (!prev || r.over > prev.over || (r.over === prev.over && r.sleeve < prev.sleeve)) {
      worst.set(r.key, {
        ...r,
        quiz: true,
        mathClip: Math.max(r.mathClip, prev?.mathClip ?? 0),
        sheetScroll: Math.max(r.sheetScroll, prev?.sheetScroll ?? 0),
        hscroll: Math.max(r.hscroll, prev?.hscroll ?? 0),
      });
    } else {
      prev.mathClip = Math.max(prev.mathClip, r.mathClip);
      prev.sheetScroll = Math.max(prev.sheetScroll, r.sheetScroll);
      prev.hscroll = Math.max(prev.hscroll, r.hscroll);
    }
  }
  await page.close();
  for (const r of rows) {
    const key = `${r.size} ${r.state}`;
    const prev = worst.get(key);
    const worse = (a, b) => a.over + a.sheetOver - (b.over + b.sheetOver);
    if (!prev || worse(r, prev) > 0 || (worse(r, prev) === 0 && r.sleeve < prev.sleeve)) {
      worst.set(key, {
        ...r,
        iconsHit: r.iconsHit && (prev?.iconsHit ?? true),
        iconsMissing: r.iconsMissing || (prev?.iconsMissing ?? false),
        sheetScroll: Math.max(r.sheetScroll, prev?.sheetScroll ?? 0),
        ruOver: Math.max(r.ruOver, prev?.ruOver ?? 0),
        lineClip: Math.max(r.lineClip, prev?.lineClip ?? 0),
        nameClip: Math.max(r.nameClip, prev?.nameClip ?? 0),
        headClip: Math.max(r.headClip, prev?.headClip ?? 0),
        pillLines: Math.max(r.pillLines, prev?.pillLines ?? 0),
        pillCut: Math.max(r.pillCut, prev?.pillCut ?? 0),
        quizHidden: r.quizHidden || (prev?.quizHidden ?? false),
      });
    } else {
      prev.ruOver = Math.max(prev.ruOver, r.ruOver);
      if (!r.iconsHit) prev.iconsHit = false;
      if (r.iconsMissing) prev.iconsMissing = true;
      prev.sheetScroll = Math.max(prev.sheetScroll, r.sheetScroll);
      prev.lineClip = Math.max(prev.lineClip, r.lineClip);
      prev.nameClip = Math.max(prev.nameClip, r.nameClip);
      prev.headClip = Math.max(prev.headClip, r.headClip);
      prev.pillLines = Math.max(prev.pillLines, r.pillLines);
      prev.pillCut = Math.max(prev.pillCut, r.pillCut);
      if (r.quizHidden) prev.quizHidden = true;
    }
  }
  // The calculator lines first, then the quiz lines (a stable sort keeps each in order).
  const lines = [...worst.entries()].sort(([, a], [, b]) => (a.quiz ? 1 : 0) - (b.quiz ? 1 : 0)).map(([key, r]) =>
    r.quiz
      ? `${key} -- scroll ${r.scrollH}/${r.innerH} over ${r.over}` +
        `${r.hscroll ? ` HSCROLL ${r.hscroll}` : ''}, sleeve ${r.sleeve}px` +
        `${r.mathClip > 0 ? ` MATH CLIPPED ${r.mathClip}` : ''}` +
        (r.sheetH
          ? `, sheet ${r.sheetH}px over ${r.sheetOver}` +
            `${r.sheetScroll ? ` SHEET SCROLLS ${r.sheetScroll}px` : ''}`
          : '')
      :
      `${key} -- scroll ${r.scrollH}/${r.innerH} over ${r.over}` +
      `${r.hscroll ? ` HSCROLL ${r.hscroll}` : ''}, sleeve ${r.sleeve}px` +
      `${r.iconsMissing ? ' ICONS MISSING' : r.iconsHit ? '' : ' ICONS BLOCKED'}` +
      `${r.ruOver ? ` ROUND-UP ROW OVER ${r.ruOver}px` : ''}` +
      `${r.lineClip > 0 ? ` LINE CLIPPED ${r.lineClip}` : ''}` +
      `${r.nameClip > 0 ? ` STAIR NAME CLIPPED ${r.nameClip}` : ''}` +
      `${r.headClip > 0 ? ` HEADER CLIPPED ${r.headClip}` : ''}` +
      `${r.pillLines > 1 ? ` PILL WRAPS ${r.pillLines}` : ''}` +
      `${r.quizHidden ? ' QUIZ HIDDEN' : ''}` +
      `${r.pillCut > 0 ? `, pill cut ${r.pillCut}px` : ''}` +
      (r.sheetH
        ? `, sheet ${r.sheetH}px over ${r.sheetOver}, Bar row scrolls ${r.rowScroll}px` +
          `${r.sheetScroll ? ` SHEET SCROLLS ${r.sheetScroll}px` : ''}`
        : ''),
  );
  // The Setup sheet must fit without scrolling inside at every viewport, a None..All
  // row open included (RBAR-72, ADR-0013): any inner scroll fails the run.
  const scrolling = [...worst.entries()].filter(([, r]) => r.sheetScroll > 0).map(([k]) => k);
  if (scrolling.length) lines.push(`FAIL: a sheet scrolls inside at ${scrolling.join('; ')}`);
  // The header's Setup pill stays one line and the quiz door stays in view (RBAR-103).
  const header = [...worst.entries()]
    .filter(([, r]) => !r.quiz && (r.pillLines !== 1 || r.quizHidden))
    .map(([k]) => k);
  if (header.length) lines.push(`FAIL: the header pill wraps or the quiz door hides at ${header.join('; ')}`);
  return lines;
}
