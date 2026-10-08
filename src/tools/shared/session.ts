import { useCallback, useState } from 'preact/hooks';

/**
 * Per-tool UI state that survives navigating away and back (in memory only,
 * for the lifetime of the tab). File objects are references, not copies.
 */
const sessions = new Map<string, unknown>();

export function useSession<T>(scope: string, key: string, initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const id = `${scope}:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (sessions.has(id)) return sessions.get(id) as T;
    const v = typeof initial === 'function' ? (initial as () => T)() : initial;
    sessions.set(id, v);
    return v;
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        sessions.set(id, v);
        return v;
      });
    },
    [id],
  );
  return [value, set];
}

/** Pre-sets a session value (e.g. the output format chosen on the detection screen). */
export function setSessionValue(scope: string, key: string, value: unknown): void {
  sessions.set(`${scope}:${key}`, value);
}

export function clearSession(scope: string, keys?: string[]): void {
  for (const id of [...sessions.keys()]) {
    if (!id.startsWith(`${scope}:`)) continue;
    if (!keys || keys.includes(id.slice(scope.length + 1))) sessions.delete(id);
  }
}
