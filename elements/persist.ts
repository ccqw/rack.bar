// Shell-side persistence primitives (ADR-0007). Every piece of lifter configuration
// and state survives a reload under its own `rackbar.*` localStorage key, owned by a
// shell element -- never the pure core (ADR-0001). These two wrappers are the one
// place that touches `localStorage`, so the best-effort contract lives in exactly one
// spot: a blocked, quota-full, or private-mode Storage degrades to "no persistence"
// rather than throwing into the caller. Persistence is a convenience, not core
// function -- losing it must never break a session.
//
// Validation and (de)serialization stay with each concern (the Bar against its offered
// set, recents through parseRecents): these helpers only move opaque strings in and out.
// Extracted at the third `rackbar.*` key (recents, RBAR-20) to dedupe the Bar/Collar
// load/save boilerplate the RBAR-16 audit flagged.

/** Read a persisted string, or null if absent or storage is unreadable. Never throws. */
export function readPersisted(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked (private mode); best-effort per ADR-0007.
  }
}

/** Write a persisted string, best-effort. A failed write (quota, private mode) is
 * swallowed -- the session keeps working without persistence. Never throws. */
export function writePersisted(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* persistence is best-effort; the session keeps working without it. */
  }
}
