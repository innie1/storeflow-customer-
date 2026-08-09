/**
 * Defensive localStorage helpers for a mobile/PWA environment.
 *
 * Storage can fail because of privacy mode, quota limits, browser settings,
 * or malformed persisted data. These helpers deliberately fail soft so a
 * storage problem cannot take down the customer app.
 */
export function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveItem(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeGetJSON<T>(key: string, fallback: T): T {
  const raw = safeGetItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeSetJSON(key: string, value: unknown): boolean {
  try {
    return safeSetItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
