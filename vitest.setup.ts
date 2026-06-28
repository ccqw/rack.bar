// Test-only Web Storage polyfill. The shell-side persistence the app relies on
// (ADR-0007, `rackbar.barKg` / `rackbar.collarKg`) needs a `localStorage` to write to in
// tests. happy-dom provides one, but it is a proxy-backed Storage that `vi.spyOn` cannot
// cleanly restore across runtimes (see the per-test reinstall below). So we install our
// own plain in-memory Storage and own it outright -- the persistence behaviour is then
// genuinely exercised, not mocked away, on an object we fully control. Browsers provide
// the real thing; this never loads outside the test run.
import { beforeEach } from 'vitest';

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

// Install a brand-new MemoryStorage as `localStorage`, overriding whatever the runtime
// supplied. `configurable: true` lets the next install replace it again. We override even
// when a localStorage already exists, and we do it at module load (before any test) so the
// object a test spies on is always this plain MemoryStorage. The reason we don't simply
// trust the framework's spy restore: a test that mocks a Storage method with
// `vi.spyOn(localStorage, 'setItem')` (the blocked-read / quota-write cases) installs a spy
// that `vi.restoreAllMocks()` did NOT reliably remove across runtimes -- originally seen on
// happy-dom's proxy Storage under Node 22, where the spy leaked into the next describe block
// and threw the prior test's DOMException (green on Node 26 locally, red on CI). Swapping in
// a fresh object before every test sidesteps restore entirely: the spied object is discarded
// wholesale, so no spy can survive into the next test.
function installFreshStorage(): void {
  const ls = new MemoryStorage();
  const targets: object[] = [globalThis];
  if (typeof window !== 'undefined' && window !== globalThis) targets.push(window);
  for (const target of targets) {
    try {
      Object.defineProperty(target, 'localStorage', {
        value: ls,
        configurable: true,
        writable: true,
      });
    } catch {
      /* a locked binding can't be swapped; nothing more we can do here */
    }
  }
}

installFreshStorage();
beforeEach(installFreshStorage);
