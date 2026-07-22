import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Web Storage polyfill for newer Node runtimes.
//
// Node >= 26 ships a native experimental Web Storage API: reading the global
// `localStorage`/`sessionStorage` without `--localstorage-file` yields
// `undefined` and emits an ExperimentalWarning. In vitest's jsdom environment
// `globalThis` and `window` are the same object, so this native global shadows
// jsdom's Storage and breaks every test that touches localStorage. Install a
// spec-compliant in-memory Storage only when the current global one is unusable,
// so jsdom's real Storage is still used on Node 20/22 where it works.
function createMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map();
    },
    getItem(key: string) {
      const value = store.get(key);
      return value === undefined ? null : value;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as unknown as Storage;
}

function hasWorkingStorage(name: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const candidate = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
    return !!candidate && typeof candidate.clear === 'function' && typeof candidate.setItem === 'function';
  } catch {
    return false;
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (!hasWorkingStorage(name)) {
    Object.defineProperty(globalThis, name, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

// Cleanup after each test case (important for React Testing Library)
afterEach(() => {
  cleanup();
});

// Add custom matchers
expect.extend({});

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
