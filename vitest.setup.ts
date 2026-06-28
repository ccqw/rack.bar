// Test-only Web Storage polyfill. happy-dom under Node does not expose `localStorage`
// (Node gates its own behind a flag), so the shell-side persistence the app relies on
// (ADR-0007, `rackbar.barKg`) has nowhere to write in tests. This installs a tiny
// in-memory Storage so the persistence behaviour is genuinely exercised, not mocked
// away. Browsers provide the real thing; this never loads outside the test run.
class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
}

if (!('localStorage' in globalThis) || globalThis.localStorage == null) {
  const ls = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: ls, configurable: true });
  }
}
