/**
 * The only module allowed to touch browser storage.
 *
 * FE4 enforces it. Two reasons:
 *
 * 1. **Portability.** A future Android target reimplements this interface and
 *    every feature keeps working. A `localStorage` call inside a feature is a
 *    portability bug even though it works today.
 *
 * 2. **It throws.** `localStorage` raises in Safari private mode and when a
 *    quota is exceeded. A component that calls it directly crashes a render
 *    over a preference nobody would miss.
 *
 * **Never store a credential here.** Anything readable by script is readable
 * by injected script; the access token stays in memory and the refresh token
 * is an httpOnly cookie.
 */

export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function isAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage != null;
  } catch {
    // Accessing the property itself throws when cookies are blocked entirely.
    return false;
  }
}

export const storage: KeyValueStorage = {
  get(key) {
    if (!isAvailable()) return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  set(key, value) {
    if (!isAvailable()) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // A failed preference write is not worth breaking a render for.
    }
  },

  remove(key) {
    if (!isAvailable()) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // As above.
    }
  },
};
