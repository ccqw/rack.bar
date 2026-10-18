// RBAR-94 (ADR-0019): the Rest timer's pure state machine, by example. The rules that
// hold across all inputs (time from timestamps, pause holds time, +15/-15 cancel, the
// round trip through storage) are properties in lib/properties.test.ts.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REST_S,
  DEFAULT_REST_SETTINGS,
  MAX_REST_S,
  MIN_REST_S,
  REST_PRESETS,
  STALE_OVERTIME_MS,
  STALE_PAUSE_MS,
  adjustRest,
  clearRest,
  formatClock,
  idleRest,
  isLive,
  parseRest,
  parseRestSettings,
  pauseRest,
  readRest,
  restartRest,
  resumeRest,
  serializeRest,
  serializeRestSettings,
  settleRest,
  startRest,
  toggleRest,
} from './rest.ts';

const T = 1_700_000_000_000; // an arbitrary epoch-ms "now"
const s = (n: number) => n * 1000;

describe('the Rest presets and defaults (RBAR-94)', () => {
  it('offers 1:30 / 2:00 / 3:00 / 5:00 and starts a fresh lifter on 2:00', () => {
    expect(REST_PRESETS.map(formatClock)).toEqual(['1:30', '2:00', '3:00', '5:00']);
    expect(idleRest()).toEqual({ phase: 'idle', last: DEFAULT_REST_S });
    expect(readRest(idleRest(), T).text).toBe('2:00');
  });

  it('defaults the settings to chime off, start after Next on', () => {
    expect(DEFAULT_REST_SETTINGS).toEqual({ chime: false, autoStart: true });
  });
});

describe('counting down', () => {
  it('reads the second in progress, and 0:00 never shows before zero', () => {
    const r = startRest(idleRest(), 90, T);
    expect(readRest(r, T)).toMatchObject({ phase: 'run', text: '1:30', fraction: 1, length: '1:30' });
    expect(readRest(r, T + 400).text).toBe('1:30');
    expect(readRest(r, T + s(1)).text).toBe('1:29');
    expect(readRest(r, T + s(89) + 999).text).toBe('0:01');
    expect(readRest(r, T + s(45)).fraction).toBeCloseTo(0.5);
  });

  it('a preset becomes the remembered Rest, and a restart runs it again', () => {
    const r = startRest(idleRest(), 300, T);
    expect(r.last).toBe(300);
    const again = restartRest(clearRest(r), T + s(10));
    expect(again).toEqual({ phase: 'run', last: 300, dur: 300, endAt: T + s(310) });
  });
});

describe('zero and overtime', () => {
  it('passes zero into overtime, counting up from the true zero', () => {
    const r = startRest(idleRest(), 90, T);
    expect(readRest(r, T + s(90))).toMatchObject({ phase: 'over', text: '+0:00', fraction: 0 });
    expect(readRest(r, T + s(102)).text).toBe('+0:12');
    expect(settleRest(r, T + s(102))).toEqual({ phase: 'done', last: 90, dur: 90, endAt: T + s(90) });
  });

  it('clears an overtime left for half an hour', () => {
    const r = startRest(idleRest(), 90, T);
    expect(settleRest(r, T + s(90) + STALE_OVERTIME_MS - 1).phase).toBe('done');
    expect(settleRest(r, T + s(90) + STALE_OVERTIME_MS)).toEqual({ phase: 'idle', last: 90 });
  });

  it('isLive is anything but idle', () => {
    const r = startRest(idleRest(), 90, T);
    expect(isLive(idleRest())).toBe(false);
    expect([r, pauseRest(r, T + 1), settleRest(r, T + s(91))].every(isLive)).toBe(true);
  });
});

describe('pause and the primary button', () => {
  it('pause freezes the time left; resume carries on from it', () => {
    const r = startRest(idleRest(), 120, T);
    const p = pauseRest(r, T + s(20));
    expect(p).toEqual({ phase: 'pause', last: 120, dur: 120, leftMs: s(100), pausedAt: T + s(20) });
    expect(readRest(p, T + s(500)).text).toBe('1:40');
    const back = resumeRest(p, T + s(500));
    expect(readRest(back, T + s(510)).text).toBe('1:30');
  });

  it('toggle: run -> pause -> run, and idle or done restarts the remembered Rest', () => {
    const r = startRest(idleRest(), 120, T);
    expect(toggleRest(r, T + 1).phase).toBe('pause');
    expect(toggleRest(toggleRest(r, T + 1), T + 2).phase).toBe('run');
    expect(toggleRest(idleRest(180), T)).toEqual({ phase: 'run', last: 180, dur: 180, endAt: T + s(180) });
    expect(toggleRest(r, T + s(200))).toEqual({ phase: 'run', last: 120, dur: 120, endAt: T + s(320) });
  });

  it('a pause left for half an hour clears itself, like a stale overtime', () => {
    const p = pauseRest(startRest(idleRest(), 120, T), T + s(20));
    expect(settleRest(p, T + s(20) + STALE_PAUSE_MS - 1).phase).toBe('pause');
    expect(settleRest(p, T + s(20) + STALE_PAUSE_MS)).toEqual({ phase: 'idle', last: 120 });
    expect(readRest(p, T + s(20) + STALE_PAUSE_MS).phase).toBe('idle');
    expect(resumeRest(p, T + s(20) + STALE_PAUSE_MS)).toEqual({ phase: 'idle', last: 120 });
  });

  it('pausing a run already past zero settles it instead', () => {
    const r = startRest(idleRest(), 90, T);
    expect(pauseRest(r, T + s(95)).phase).toBe('done');
  });
});

describe('-15 / +15', () => {
  it('moves the time left of a running Rest, growing the ring past its length', () => {
    const r = startRest(idleRest(), 90, T);
    const more = adjustRest(r, 15, T + s(10));
    expect(readRest(more, T + s(10)).text).toBe('1:35');
    expect(more).toMatchObject({ dur: 95 });
    expect(readRest(more, T + s(10)).fraction).toBe(1);
    const less = adjustRest(r, -15, T + s(10));
    expect(readRest(less, T + s(10)).text).toBe('1:05');
    expect(less).toMatchObject({ dur: 90 });
  });

  it('a -15 past zero finishes the Rest now, at +0:00', () => {
    const r = startRest(idleRest(), 90, T);
    const z = adjustRest(r, -15, T + s(80));
    expect(z).toEqual({ phase: 'done', last: 90, dur: 90, endAt: T + s(80) });
    expect(readRest(z, T + s(80)).text).toBe('+0:00');
  });

  it('moves a paused Rest too, and to zero finishes it', () => {
    const p = pauseRest(startRest(idleRest(), 90, T), T + s(30));
    expect(adjustRest(p, 15, T + s(40))).toEqual({
      phase: 'pause',
      last: 90,
      dur: 90,
      leftMs: s(75),
      pausedAt: T + s(30),
    });
    expect(adjustRest(p, -60, T + s(40)).phase).toBe('done');
  });

  it('idle, it nudges the remembered Rest within its bounds', () => {
    expect(adjustRest(idleRest(120), 15, T)).toEqual({ phase: 'idle', last: 135 });
    expect(adjustRest(idleRest(MIN_REST_S), -15, T)).toEqual({ phase: 'idle', last: MIN_REST_S });
    expect(adjustRest(idleRest(MAX_REST_S), 15, T)).toEqual({ phase: 'idle', last: MAX_REST_S });
  });

  it('a finished Rest ignores it; the time left never passes an hour', () => {
    const done = settleRest(startRest(idleRest(), 90, T), T + s(100));
    expect(adjustRest(done, 15, T + s(100))).toBe(done);
    const top = adjustRest(startRest(idleRest(), MAX_REST_S, T), 15, T);
    expect(readRest(top, T).text).toBe('60:00');
  });
});

describe('persistence (ADR-0007 boundary)', () => {
  it('round-trips every phase', () => {
    const r = startRest(idleRest(), 120, T);
    for (const x of [idleRest(90), r, pauseRest(r, T + s(5)), settleRest(r, T + s(130))]) {
      expect(parseRest(serializeRest(x))).toEqual(x);
    }
  });

  it('reads anything malformed as null', () => {
    for (const raw of [
      null,
      '',
      'nope',
      '42',
      'null',
      '{}',
      '{"phase":"idle","last":5}',
      '{"phase":"idle","last":99999}',
      '{"phase":"run","last":90,"dur":90}',
      '{"phase":"run","last":90,"dur":0,"endAt":1}',
      '{"phase":"pause","last":90,"dur":90,"leftMs":-1,"pausedAt":1}',
      '{"phase":"pause","last":90,"dur":90,"leftMs":5000}',
      '{"phase":"warp","last":90,"dur":90,"endAt":1}',
    ]) {
      expect(parseRest(raw)).toBeNull();
    }
  });

  it('settings: each field validated alone, defaults for the rest', () => {
    expect(parseRestSettings(null)).toEqual(DEFAULT_REST_SETTINGS);
    expect(parseRestSettings('garbage')).toEqual(DEFAULT_REST_SETTINGS);
    expect(parseRestSettings('{"chime":true}')).toEqual({ chime: true, autoStart: true });
    expect(parseRestSettings('{"chime":"yes","autoStart":false}')).toEqual({
      chime: false,
      autoStart: false,
    });
    const x = { chime: true, autoStart: false };
    expect(parseRestSettings(serializeRestSettings(x))).toEqual(x);
  });
});
