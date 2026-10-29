// tests/client/helpers/setupLocalStorage.ts
//
// happy-dom does not expose `localStorage` on the global scope by default
// (it requires `window.localStorage` to be set up via a Window with a
// non-`about:blank` URL, and even then Vitest's `populateGlobal` does not
// copy the getter onto the global). For tests that need to read/write
// `localStorage`, install a tiny Map-backed shim on `globalThis.localStorage`.
// The shim implements the minimum surface the app uses: `getItem`, `setItem`,
// `removeItem`, `clear`, `key`, `length`. The `throw` tests still mock
// `Storage.prototype.getItem`/`setItem` directly via `vi.spyOn` — when the
// shim is in place, the production code calls the shim's methods, NOT
// `Storage.prototype`. Update those tests to spy on the shim instead.

export interface LocalStorageShim {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

export function makeLocalStorageShim(): LocalStorageShim {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
    clear: () => {
      m.clear();
    },
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/**
 * Install a fresh, empty localStorage shim on `globalThis.localStorage`.
 * Returns the shim so tests can spy on it directly.
 */
export function installLocalStorageShim(): LocalStorageShim {
  const shim = makeLocalStorageShim();
  (globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = shim;
  return shim;
}
