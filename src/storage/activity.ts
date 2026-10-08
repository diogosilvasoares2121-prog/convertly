import { createStore } from '../core/store';
import { onKeyChanged, readKey, writeKey } from './storage';
import { settingsStore } from './settings';

/**
 * Recent activity stores ONLY a tool id, a timestamp and a generic category.
 * No file names, no file contents, no history leaves the device.
 */
export interface RecentEntry {
  toolId: string;
  ts: number;
  kind: string;
}

const RECENT_KEY = 'recentTools';
const FAVORITES_KEY = 'favoriteTools';
const MAX_RECENT = 12;

export const recentStore = createStore<RecentEntry[]>([]);
export const favoritesStore = createStore<string[]>([]);

function cleanRecent(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is RecentEntry => typeof e === 'object' && e !== null && typeof (e as RecentEntry).toolId === 'string')
    .map((e) => ({ toolId: e.toolId, ts: Number(e.ts) || 0, kind: String(e.kind ?? '') }))
    .slice(0, MAX_RECENT);
}

function cleanFavorites(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string').slice(0, 50) : [];
}

export async function loadActivity(): Promise<void> {
  recentStore.set(cleanRecent(await readKey<unknown>(RECENT_KEY, [])));
  favoritesStore.set(cleanFavorites(await readKey<unknown>(FAVORITES_KEY, [])));
  onKeyChanged(RECENT_KEY, (v) => recentStore.set(cleanRecent(v)));
  onKeyChanged(FAVORITES_KEY, (v) => favoritesStore.set(cleanFavorites(v)));
}

export async function recordToolUse(toolId: string, kind: string): Promise<void> {
  if (!settingsStore.get().rememberRecent) return;
  const next = [{ toolId, ts: Date.now(), kind }, ...recentStore.get().filter((e) => e.toolId !== toolId)].slice(0, MAX_RECENT);
  recentStore.set(next);
  await writeKey(RECENT_KEY, next);
}

export async function clearRecent(): Promise<void> {
  recentStore.set([]);
  await writeKey(RECENT_KEY, []);
}

export async function toggleFavorite(toolId: string): Promise<void> {
  const current = favoritesStore.get();
  const next = current.includes(toolId) ? current.filter((id) => id !== toolId) : [...current, toolId];
  favoritesStore.set(next);
  await writeKey(FAVORITES_KEY, next);
}
