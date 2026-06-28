import { describe, it, expect, vi, afterEach } from 'vitest';
import { readPersisted, writePersisted } from './persist.ts';

describe('shell-side persistence helpers (ADR-0007/0009)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('round-trips a written value', () => {
    writePersisted('rackbar.test', 'hello');
    expect(readPersisted('rackbar.test')).toBe('hello');
  });

  it('reads a never-written key as null', () => {
    expect(readPersisted('rackbar.absent')).toBeNull();
  });

  it('reads null (never throws) when localStorage.getItem throws -- blocked storage', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });
    expect(readPersisted('rackbar.test')).toBeNull();
  });

  it('swallows a thrown write (never throws) -- quota / private mode', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });
    expect(() => writePersisted('rackbar.test', 'x')).not.toThrow();
  });
});
