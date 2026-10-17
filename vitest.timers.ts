// TEST-ONLY (RBAR-90): the real setImmediate, captured when this module first loads --
// from vitest.setup.ts, before any test can install fake timers -- so a macrotask yield
// still fires under vi.useFakeTimers (a faked one never would). Shared by the setup
// file's after-each yield and nextRun in elements/properties.drivers.ts.
export const realSetImmediate: typeof setImmediate = globalThis.setImmediate;

/** Resolve after one real macrotask (the current task ends first). */
export const nextMacrotask = (): Promise<void> =>
  new Promise((resolve) => realSetImmediate(resolve));
