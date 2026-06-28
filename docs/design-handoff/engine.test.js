/**
 * rack.bar engine — contract examples
 * ============================================================================
 * Framework-free assertions documenting the expected behaviour of engine.js.
 * Runs in plain Node with no test runner:  node engine.test.js
 * (Adapt to Jest/Vitest in your codebase — the cases are the point, not the
 * harness.) These pin the invariants a rewrite must preserve.
 * ============================================================================
 */
import {
  decode, fillSide, total, sideKg, groupSide, toLbWhole, draftToKg,
  ELEIKO, IRON, SLEEVE_MM, sideWidth,
} from './engine.js';

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'} — ${label}` + (ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}
function approx(label, got, want, tol = 1e-6) {
  const ok = Math.abs(got - want) <= tol;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'} — ${label}` + (ok ? '' : `  got ${got} want ${want}`));
  ok ? pass++ : fail++;
}

// 142.5 kg on a 20 kg bar, no collars → 61.25 kg/side → 25 + 25 + 10 + 1.25? no: greedy.
// per side = (142.5 - 20)/2 = 61.25 → 25,25,10,1(...) actually fills to ≤ 61.25.
{
  const r = decode(142.5, 20, 0, ELEIKO);
  approx('142.5 target → exact total', r.primary.total, 142.5);
  eq('142.5 → per-side plates (kg)', r.primary.side.map((p) => p.kg), [25, 25, 10, 1, 0.5]);
}

// Exact target leaves no "over" candidate.
{
  const r = decode(60, 20, 0, ELEIKO);
  approx('60 kg exact total', r.primary.total, 60);
  eq('60 kg has no round-up', r.over, undefined);
}

// A target that can't be hit exactly offers a round-up that exceeds it.
{
  const r = decode(61, 20, 0, ELEIKO);
  if (!r.over) { console.error('FAIL — 61 kg should offer a round-up'); fail++; }
  else {
    const under = r.primary.total <= 61 + 1e-9;
    const over = r.over.total > 61;
    console.log(under && over ? 'PASS — 61 kg: primary ≤ target < over' : 'FAIL — 61 kg round-up bracket'); under && over ? pass++ : fail++;
  }
}

// Collars add 2 × collarKg to the total.
{
  const r = decode(145, 20, 2.5, ELEIKO);   // bar 20 + 2×2.5 collars = 25 before plates
  approx('collars counted in total', r.primary.total - 2 * sideKg(r.primary.side), 25);
}

// Sleeve cap: a huge target can't load past the physical sleeve width.
{
  const r = decode(99999, 20, 0, ELEIKO);
  const ok = sideWidth(r.primary.side) <= SLEEVE_MM + 1e-9;
  console.log(ok ? 'PASS — never exceeds sleeve width' : 'FAIL — exceeded sleeve cap'); ok ? pass++ : fail++;
}

// Unit conversions.
approx('100 kg → 220 lb', toLbWhole(100), 220, 1);
approx('225 lb entry → kg', draftToKg('225', 'lb'), 225 / 2.2046226218);
eq('blank entry → null', draftToKg('', 'kg'), null);

// Grouping collapses runs of equal plates.
eq('groupSide collapses pairs', groupSide([{ kg: 25 }, { kg: 25 }, { kg: 10 }]).map((g) => `${g.count}x${g.kg}`), ['2x25', '1x10']);

// Iron (lb) set fills correctly: 135 lb target ≈ 61.235 kg total on a 45 lb (20.41 kg) bar.
{
  const r = decode(draftToKg('135', 'lb'), IRON[0].kg, 0, IRON);
  eq('135 lb → 45 + 45 per side', r.primary.side.map((p) => p.label), ['45', '45']);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (typeof process !== 'undefined' && fail) process.exitCode = 1;
