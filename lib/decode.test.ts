import { describe, it, expect } from 'vitest';
import { decode } from './decode.ts';
import {
  ELEIKO_KG,
  IRON_LB,
  SLEEVE_MM,
  totalKg,
  sideLoadKg,
  sideWidthMm,
  atSleeveCapacity,
  barWithCollars,
} from './plates.ts';
import { lbToKg, toLbWhole } from './units.ts';

describe('decode (at-or-under loading core, ADR-0003)', () => {
  it('decodes an exact Target into the canonical fewest-Plate Side Load, biggest-first', () => {
    // 100 on a 20 kg Bar -> 40 per Side -> 25 + 15 (two Plates, heaviest-first)
    const { primary } = decode(100);
    expect(primary.side.map((p) => p.kg)).toEqual([25, 15]);
    expect(primary.side.map((p) => p.color)).toEqual(['red', 'yellow']);
    expect(primary.total).toBe(100);
    expect(primary.delta).toBe(0);
  });

  it('builds a half-kilo Side Load from change Plates (the 1 kg Total grid)', () => {
    // 101 IS on the grid: 40.5 per Side -> 25 + 15 + 0.5. Exact, not rounded down.
    const { primary } = decode(101);
    expect(primary.side.map((p) => p.kg)).toEqual([25, 15, 0.5]);
    expect(primary.total).toBe(101);
    expect(primary.delta).toBe(0);
  });

  describe('nearest achievable Total at-or-under (never overshoots)', () => {
    it('rounds an off-grid half-kilo Target down to the nearest whole-kg Total', () => {
      // 100.5 is off the 1 kg grid -> nearest at-or-under is 100, 0.5 short.
      const { primary } = decode(100.5);
      expect(primary.side.map((p) => p.kg)).toEqual([25, 15]);
      expect(primary.total).toBe(100);
      expect(primary.delta).toBe(-0.5);
    });

    it('respects the grid on a larger fractional Target (142.5 -> 142)', () => {
      // 61.25 per Side -> 25 + 25 + 10 + 1, leftover 0.25 dropped. Total 142.
      const { primary } = decode(142.5);
      expect(primary.side.map((p) => p.kg)).toEqual([25, 25, 10, 1]);
      expect(primary.total).toBe(142);
      expect(primary.delta).toBe(-0.5);
    });

    it('never returns a Total above the Target for any Target at or above the Bar', () => {
      for (let target = 20; target <= 400; target += 0.25) {
        const { primary } = decode(target);
        expect(primary.total).toBeLessThanOrEqual(target + 1e-9);
        expect(primary.delta).toBeLessThanOrEqual(1e-9);
        // The miss is smaller than the 1 kg grid step -- UNLESS the sleeve is full
        // (ADR-0012; first binds at Target 349 on the default rig), where the miss
        // is whatever physically fits. The capped band is pinned by the RBAR-31
        // describe below, DP oracle included.
        if (!atSleeveCapacity(primary.side, ELEIKO_KG)) {
          expect(primary.delta, `target ${target}`).toBeGreaterThan(-1);
        }
      }
    });
  });

  describe('canonical Side Load: fewest Plates, heaviest-first', () => {
    it('uses the fewest Plates for a heavy Target (unlimited Inventory)', () => {
      // 250 -> 115 per Side -> 25 x 4 + 15. Five Plates, none smaller needed.
      const { primary } = decode(250);
      expect(primary.side.map((p) => p.kg)).toEqual([25, 25, 25, 25, 15]);
      expect(primary.total).toBe(250);
    });

    it('emits Plates in non-increasing order (load order at the collar)', () => {
      const { primary } = decode(187.5);
      const kgs = primary.side.map((p) => p.kg);
      const sorted = [...kgs].sort((a, b) => b - a);
      expect(kgs).toEqual(sorted);
    });
  });

  describe('edge cases', () => {
    it('returns the empty Side Load at the bare Bar for a Target equal to the Bar', () => {
      const { primary } = decode(20);
      expect(primary.side).toEqual([]);
      expect(primary.total).toBe(20);
      expect(primary.delta).toBe(0);
    });

    it('floors a sub-Bar Target at the bare Bar (the only case delta is positive)', () => {
      // 10 kg can't go under the 20 kg Bar; total is 20, 10 kg over the Target.
      const { primary } = decode(10);
      expect(primary.side).toEqual([]);
      expect(primary.total).toBe(20);
      expect(primary.delta).toBe(10);
    });

    it('caps a very heavy Target at the sleeve, not an unrackable Total (ADR-0012)', () => {
      // 500 used to decode "exactly" via 9 x 25 + 15 per Side -- 561 mm of plates on
      // a 415 mm sleeve. The capped core (RBAR-31) loads the widest fitting Side
      // instead: 7 x 25 (406 mm), Total 370, honestly 130 short.
      const { primary } = decode(500);
      expect(primary.side.map((p) => p.kg)).toEqual([25, 25, 25, 25, 25, 25, 25]);
      expect(primary.total).toBe(370);
      expect(primary.delta).toBe(-130);
      expect(totalKg(primary.side)).toBe(370);
    });

    it('degrades a non-finite Target to the bare Bar instead of looping forever', () => {
      // Infinity (e.g. from a "1e999" entry) would spin the greedy loop forever;
      // NaN would yield a NaN delta. Both degrade to the bare Bar, zero delta.
      for (const bad of [Infinity, -Infinity, NaN]) {
        const { primary } = decode(bad);
        expect(primary.side).toEqual([]);
        expect(primary.total).toBe(20);
        expect(primary.delta).toBe(0);
      }
    });
  });

  describe('over-target opt-in alternative (ADR-0003, RBAR-11)', () => {
    it('offers `over` as the least achievable Total above an off-grid Target', () => {
      // 100.5 is off the 1 kg grid: primary lands at 100 (-0.5); the next grid
      // step up is 101, reached by adding a single 0.5 change Plate.
      const { primary, over } = decode(100.5);
      expect(primary.total).toBe(100);
      expect(over).toBeDefined();
      expect(over!.side.map((p) => p.kg)).toEqual([25, 15, 0.5]);
      expect(over!.total).toBe(101);
      expect(over!.delta).toBe(0.5); // positive: the deliberate overshoot
    });

    it('finds the fewest-Plate `over`, re-greedying the step (not primary + 0.5)', () => {
      // 142.5 -> primary 142 (61 per Side: 25+25+10+1). The over step is 143
      // (61.5 per Side): re-greedying collapses the +0.5 carry into a single 1.5
      // yellow (25+25+10+1.5, four Plates) rather than tacking on a fifth 0.5.
      const { primary, over } = decode(142.5);
      expect(primary.total).toBe(142);
      expect(over!.side.map((p) => p.kg)).toEqual([25, 25, 10, 1.5]);
      expect(over!.total).toBe(143);
      expect(over!.delta).toBe(0.5);
    });

    it('offers `over` even when primary is the closer miss (always offer when under)', () => {
      // 187.3 -> primary 187 (-0.3) is closer than over 188 (+0.7), yet the opt-in
      // is still offered: the round-up is the lifter's choice, not gated on which
      // miss is smaller. The step re-greedies the trailing 1 up to a 1.5 (yellow),
      // biggest-first, rather than appending a 0.5.
      const { primary, over } = decode(187.3);
      expect(primary.total).toBe(187);
      expect(over!.side.map((p) => p.kg)).toEqual([25, 25, 25, 5, 2.5, 1.5]);
      expect(over!.total).toBe(188);
      expect(over!.delta).toBeCloseTo(0.7, 10);
      const kgs = over!.side.map((p) => p.kg);
      expect(kgs).toEqual([...kgs].sort((a, b) => b - a)); // non-increasing, like primary
    });

    it('computes `over` on a non-default Bar (threads bar through the step)', () => {
      // 15 kg Bar, Target 56.5 -> 20.75 per Side. Primary 56 (20 + 0.5 per Side,
      // -0.5); the step up is 57 (21 per Side: 20 + 1), +0.5 over.
      const { primary, over } = decode(56.5, 15);
      expect(primary.total).toBe(56);
      expect(over!.side.map((p) => p.kg)).toEqual([20, 1]);
      expect(over!.total).toBe(57);
      expect(over!.delta).toBe(0.5);
    });

    it('never auto-selects `over`: primary is still at or under the Target', () => {
      const { primary, over } = decode(123.4);
      expect(primary.total).toBeLessThanOrEqual(123.4);
      expect(over!.total).toBeGreaterThan(123.4);
    });

    it('omits `over` for an exactly achievable Target (nothing to round up to)', () => {
      expect(decode(100).over).toBeUndefined();
      expect(decode(101).over).toBeUndefined();
    });

    it('omits `over` for a sub-Bar Target (primary already sits above it)', () => {
      // 10 floors at the bare Bar (20), already over the Target -- no over option.
      expect(decode(10).over).toBeUndefined();
    });

    it('omits `over` for a non-finite Target', () => {
      for (const bad of [Infinity, -Infinity, NaN]) {
        expect(decode(bad).over).toBeUndefined();
      }
    });

    it('omits `over` when the Inventory cannot exceed the Target', () => {
      // Empty Inventory builds nothing -- there is no higher Total to offer.
      expect(decode(100, 20, []).over).toBeUndefined();
    });

    it('steps `over` by the Inventory grid on a restricted set', () => {
      // Bumpers only (smallest 2.5 -> 5 kg Total grid). 103 -> primary 100 (-3);
      // the next step up is 105, reached by adding one 2.5 bumper per Side.
      const bumpers = ELEIKO_KG.filter((p) => p.kg >= 2.5);
      const { primary, over } = decode(103, 20, bumpers);
      expect(primary.total).toBe(100);
      expect(over!.side.map((p) => p.kg)).toEqual([25, 15, 2.5]);
      expect(over!.total).toBe(105);
      expect(over!.delta).toBe(2);
    });
  });

  describe('parameterized core (ADR-0002)', () => {
    it('honors a non-default Bar weight', () => {
      // 15 kg Bar, Target 55 -> 20 per Side -> a single blue.
      const { primary } = decode(55, 15);
      expect(primary.side.map((p) => p.kg)).toEqual([20]);
      expect(primary.total).toBe(55);
    });

    it('honors a restricted Inventory (no change Plates -> coarser grid)', () => {
      // Bumpers only (down to 2.5): 100.5 -> nearest at-or-under is 100.
      const bumpers = ELEIKO_KG.filter((p) => p.kg >= 2.5);
      const { primary } = decode(103, 20, bumpers);
      // 41.5 per Side off this grid -> 25 + 15 = 40 per Side, leftover 1.5 dropped.
      expect(primary.total).toBe(100);
      expect(primary.delta).toBe(-3);
    });

    it('falls back to the bare Bar when the Inventory cannot reach the Target', () => {
      // An empty Inventory builds nothing -- the at-or-under answer is the bare
      // Bar, a large negative delta. (Surfacing this distinctly is the finite-
      // Inventory slice's job; here we just pin the never-overshoot contract.)
      const { primary } = decode(100, 20, []);
      expect(primary.side).toEqual([]);
      expect(primary.total).toBe(20);
      expect(primary.delta).toBe(-80);
    });
  });
});

describe('decode against a collar baseline (ADR-0008)', () => {
  // A Standard 2.5 kg collar folds into the effective Bar (barWithCollars): the
  // solver loads from Bar + 2 x collar, so the grid and floor shift up by 5 kg on
  // a 20 kg Bar, and the loader is otherwise unchanged (greedy, biggest-first).
  const collared = barWithCollars(20, 2.5); // 25

  it('decodes an exact collared Target into the fewest Plates', () => {
    // 95 = 25 baseline + 70 -> 35 per Side -> 25 + 10. Total = 25 + 2 x 35.
    const { primary } = decode(95, collared);
    expect(primary.side.map((p) => p.kg)).toEqual([25, 10]);
    expect(primary.total).toBe(95);
    expect(primary.total).toBe(totalKg(primary.side, collared));
    expect(primary.delta).toBe(0);
  });

  it('floors at the bare rig (Bar + 2 x collar) for a sub-baseline Target', () => {
    // 22 is below the 25 kg collared baseline -> empty Side, floored at the rig.
    const { primary } = decode(22, collared);
    expect(primary.side).toEqual([]);
    expect(primary.total).toBe(25);
    expect(primary.delta).toBe(3); // positive: the Target is below the floor
  });

  it('offers the over-target round-up measured from the collared baseline', () => {
    // 100.5 off the grid: primary lands at 100 (25 baseline + 75), over steps to 101.
    const { primary, over } = decode(100.5, collared);
    expect(primary.total).toBe(100);
    expect(primary.delta).toBe(-0.5);
    expect(over?.total).toBe(101);
    expect(over?.delta).toBe(0.5);
    expect(over?.total).toBe(totalKg(over!.side, collared));
  });
});

describe('decode on the iron training set (RBAR-17, ADR-0010)', () => {
  const bar = lbToKg(45); // the 45 lb training Bar

  it('lands whole-lb Targets exactly on the iron grid', () => {
    // 135 lb = 45 Bar + one 45 lb pair; 225 lb = 45 Bar + two 45 lb pairs.
    expect(toLbWhole(decode(lbToKg(135), bar, IRON_LB).primary.total)).toBe(135);
    expect(toLbWhole(decode(lbToKg(225), bar, IRON_LB).primary.total)).toBe(225);
  });

  it('never overshoots: the primary Total is at or under the Target', () => {
    for (let lb = 45; lb <= 405; lb += 1) {
      const { primary } = decode(lbToKg(lb), bar, IRON_LB);
      expect(toLbWhole(primary.total)).toBeLessThanOrEqual(lb);
    }
  });

  it('caps on the iron sleeve too (one constant for every Bar, ADR-0012)', () => {
    // 10 x 45 lb per Side is 500 mm of iron on a 415 mm sleeve: the cap holds it at
    // 8 (400 mm), then fills narrower -- the same guard as the kg set, no per-set fork.
    const { primary } = decode(lbToKg(945), bar, IRON_LB);
    expect(sideWidthMm(primary.side)).toBeLessThanOrEqual(SLEEVE_MM);
    expect(primary.side.filter((p) => p.label === '45').length).toBeLessThanOrEqual(8);
  });

  it('is the GREATEST achievable Total at or under Target (greedy is optimal -- iron is canonical)', () => {
    // Independent oracle: DP for the best coin sum <= budget, iron lb x2 to stay
    // integer ([45,35,25,10,5,2.5] lb -> [90,70,50,20,10,5]). If greedy ever lost to
    // a non-greedy combo this fails -- the regression guard ADR-0010 leans on.
    const coins = [90, 70, 50, 20, 10, 5];
    const N = 360; // budget = (totalLb - 45 Bar), up to 405 lb total
    const best = new Array(N + 1).fill(0);
    for (let t = 1; t <= N; t++) {
      for (const c of coins) if (c <= t) best[t] = Math.max(best[t], c + best[t - c]);
    }
    for (let totalLb = 45; totalLb <= 405; totalLb += 5) {
      const { primary } = decode(lbToKg(totalLb), bar, IRON_LB);
      // The side's plate faces, x2, sum to (achieved Total - 45 Bar) in lb.
      const decodeSideLbX2 = primary.side.reduce((s, p) => s + Number(p.label) * 2, 0);
      const optimalSideLbX2 = best[totalLb - 45];
      expect(decodeSideLbX2).toBe(optimalSideLbX2);
    }
  });
});

describe('the sleeve caps decode (RBAR-31, ADR-0012)', () => {
  it('never returns a Side Load wider than the sleeve, over included', () => {
    for (let target = 20; target <= 800; target += 2.5) {
      const { primary, over } = decode(target);
      expect(sideWidthMm(primary.side)).toBeLessThanOrEqual(SLEEVE_MM + 1e-9);
      expect(primary.total).toBeLessThanOrEqual(target + 1e-9); // never-overshoot holds capped
      if (over) expect(sideWidthMm(over.side)).toBeLessThanOrEqual(SLEEVE_MM + 1e-9);
    }
  });

  it('caps an overflowing Target at the widest fitting Side (7 reds, Total 370)', () => {
    const { primary, over } = decode(1000);
    expect(primary.side.map((p) => p.kg)).toEqual([25, 25, 25, 25, 25, 25, 25]);
    expect(sideWidthMm(primary.side)).toBe(406);
    expect(primary.total).toBe(370);
    expect(primary.delta).toBe(-630);
    expect(over).toBeUndefined(); // nothing heavier fits: no physical round-up
  });

  it('lands exactly on a boundary Target that nearly fills the sleeve', () => {
    // 365 = 20 Bar + 2 x 172.5; greedy: 6 x 25 (348 mm) + 20 (398) + 2.5 (413).
    // Exact hit with 2 mm to spare -- the cap must not turn a fitting stack away.
    const { primary, over } = decode(365);
    expect(primary.side.map((p) => p.kg)).toEqual([25, 25, 25, 25, 25, 25, 20, 2.5]);
    expect(sideWidthMm(primary.side)).toBe(413);
    expect(primary.total).toBe(365);
    expect(primary.delta).toBe(0);
    expect(over).toBeUndefined(); // exact: nothing to round up to
  });

  it('finds a RESHUFFLED over when a heavier stack fits where the primary cannot grow', () => {
    // 346.8: the capped primary is 346 (163/side, 414 mm) -- nothing can be ADDED to
    // that side. But the over step re-solves and reshuffles into 163.5/side within
    // 413 mm (5 x 25 + 20 + 15 + 2.5 + 1), so a physical round-up DOES exist. The
    // "at capacity" reading must come from over's absence, not from whether the
    // primary side itself has room (the RBAR-31 audit's contradiction case).
    const { primary, over } = decode(346.8);
    expect(primary.total).toBe(346);
    expect(over?.total).toBe(347);
    expect(sideWidthMm(over!.side)).toBeLessThanOrEqual(SLEEVE_MM);
  });

  it('omits `over` in the CORE when a sleeve-full primary has no physical round-up', () => {
    // 371: the capped primary is 370 (-1). The over step re-fills under the same cap
    // and cannot exceed the Target, so the core carries no over at all -- the view no
    // longer has to suppress one (ADR-0003 dated note).
    const { primary, over } = decode(371);
    expect(primary.total).toBe(370);
    expect(primary.delta).toBe(-1);
    expect(over).toBeUndefined();
  });

  it('keeps the round-up for off-grid Targets the sleeve does not bind (regression)', () => {
    const { over } = decode(142.5);
    expect(over?.total).toBe(143);
    expect(over?.delta).toBe(0.5);
  });

  it('honors a custom sleeveMm (the parameterized length, ADR-0012)', () => {
    // A 100 mm sleeve: 25 (58 mm) + 15 (39 mm) = 97 mm fits -> 100 lands exact.
    const roomy = decode(100, 20, ELEIKO_KG, 100);
    expect(roomy.primary.side.map((p) => p.kg)).toEqual([25, 15]);
    expect(roomy.primary.total).toBe(100);
    // A 58 mm sleeve holds a single red: capped at 70, and no physical round-up.
    const tight = decode(100, 20, ELEIKO_KG, 58);
    expect(tight.primary.side.map((p) => p.kg)).toEqual([25]);
    expect(tight.primary.total).toBe(70);
    expect(tight.over).toBeUndefined();
  });

  it('stays at-or-under-optimal within the width budget (DP oracle)', () => {
    // Independent oracle: minWidth[k] = the narrowest stack summing to k (kg x 2 so
    // the grid is integer). A Side sum is physically achievable iff its NARROWEST
    // realization fits the sleeve; the optimum for a Target is then the greatest
    // achievable sum at or under the weight budget. Greedy must match it across the
    // region where the cap binds -- the regression guard ADR-0012 leans on, the same
    // shape as the iron oracle above.
    const kg2 = ELEIKO_KG.map((p) => Math.round(p.kg * 2));
    const widths = ELEIKO_KG.map((p) => p.widthMm);
    const MAX = 600; // side sums to 300 kg cover Targets to 620
    const minWidth: number[] = new Array(MAX + 1).fill(Infinity);
    minWidth[0] = 0;
    for (let k = 1; k <= MAX; k++) {
      for (let i = 0; i < kg2.length; i++) {
        if (kg2[i] <= k && minWidth[k - kg2[i]] + widths[i] < minWidth[k]) {
          minWidth[k] = minWidth[k - kg2[i]] + widths[i];
        }
      }
    }
    for (let target = 320; target <= 620; target += 0.5) {
      const budget2 = Math.floor(((target - 20) / 2) * 2 + 1e-9);
      let optimal2 = 0;
      for (let k = Math.min(budget2, MAX); k >= 0; k--) {
        if (minWidth[k] <= SLEEVE_MM) {
          optimal2 = k;
          break;
        }
      }
      const { primary } = decode(target);
      expect(Math.round(sideLoadKg(primary.side) * 2), `target ${target}`).toBe(optimal2);
    }
  });
});
