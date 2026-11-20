import { vi } from 'vitest';

/**
 * Makes every read and write of localStorage throw, as a private window or
 * blocked site data does, and answers the function that puts it back.
 *
 * jsdom's storage is a `Storage` (patched on the prototype: assigning to an
 * instance would store an item named "getItem"); the memory polyfill of newer
 * Node runtimes is a plain object (patched in place).
 */
export const breakStorage = (): (() => void) => {
  const fail = () => { throw new Error('SecurityError'); };
  const storage = globalThis.localStorage as Storage;
  if (typeof Storage !== 'undefined' && storage instanceof Storage) {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
    return () => {
      getItem.mockRestore();
      setItem.mockRestore();
    };
  }
  const original = { getItem: storage.getItem, setItem: storage.setItem };
  storage.getItem = fail;
  storage.setItem = fail;
  return () => Object.assign(storage, original);
};
