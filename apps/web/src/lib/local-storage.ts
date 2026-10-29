/**
 * Guarded access to `localStorage`. Storage can be unavailable in private browsing modes or when
 * site data is blocked, and the application must keep working in that case.
 */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persistence is a convenience only; ignore quota and access errors.
  }
}

export function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing is stored when storage is unavailable.
  }
}
