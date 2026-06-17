import { describe, it, expect } from 'vitest';
import { decode } from './decode.ts';
import { ELEIKO_KG, totalKg } from './plates.ts';

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
        // The miss is always smaller than the 1 kg grid step.
        expect(primary.delta).toBeGreaterThan(-1);
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

    it('handles a very heavy Target from the unlimited set', () => {
      // 500 -> 240 per Side -> 25 x 9 + 15. Total exactly 500.
      const { primary } = decode(500);
      expect(primary.total).toBe(500);
      expect(primary.delta).toBe(0);
      expect(totalKg(primary.side)).toBe(500);
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

    it('emits `over` Plates in non-increasing order, like primary', () => {
      const { over } = decode(187.3);
      const kgs = over!.side.map((p) => p.kg);
      expect(kgs).toEqual([...kgs].sort((a, b) => b - a));
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
