/**
 * Thin wrapper around chrome.storage.local.
 * Only small preference values are stored here (settings, tool ids, timestamps).
 * File contents and file names are never written to storage.
 */
type Listener = (value: unknown) => void;

const memory = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

function area(): chrome.storage.StorageArea | null {
  try {
    return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
  } catch {
    return null;
  }
}

let wired = false;
function wireChanges(): void {
  if (wired) return;
  wired = true;
  try {
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        listeners.get(key)?.forEach((l) => l(change.newValue));
      }
    });
  } catch {
    /* not running as an extension (tests) */
  }
}

export async function readKey<T>(key: string, fallback: T): Promise<T> {
  const a = area();
  if (!a) return memory.has(key) ? (memory.get(key) as T) : fallback;
  try {
    const result = await a.get(key);
    return key in result ? (result[key] as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeKey(key: string, value: unknown): Promise<void> {
  const a = area();
  if (!a) {
    memory.set(key, value);
    listeners.get(key)?.forEach((l) => l(value));
    return;
  }
  await a.set({ [key]: value });
}

/** Subscribes to changes made from any extension page (e.g. popup and app tab). */
export function onKeyChanged(key: string, listener: Listener): () => void {
  wireChanges();
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => set.delete(listener);
}
