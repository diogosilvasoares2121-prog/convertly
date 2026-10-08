import { createStore } from '../core/store';
import { onKeyChanged, readKey, writeKey } from './storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'auto' | 'en' | 'pt';

export interface Settings {
  theme: ThemePreference;
  language: LanguagePreference;
  /** Default JPG/WEBP/AVIF quality, 10–100. */
  imageQuality: number;
  /** Optional sub-folder inside the browser's Downloads folder. */
  downloadFolder: string;
  /** Ask where to save each download (Chrome "Save as" dialog). */
  askWhereToSave: boolean;
  /** Ask for confirmation before heavy conversions of large files. */
  confirmLargeFiles: boolean;
  /** Keep a list of recently used tools (tool ids + timestamps only). */
  rememberRecent: boolean;
  onboardingDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'auto',
  imageQuality: 90,
  downloadFolder: '',
  askWhereToSave: false,
  confirmLargeFiles: true,
  rememberRecent: true,
  onboardingDone: false,
};

const KEY = 'settings';

export const settingsStore = createStore<Settings>(DEFAULT_SETTINGS);

function normalize(raw: unknown): Settings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>;
  const merged = { ...DEFAULT_SETTINGS, ...value };
  merged.imageQuality = Math.min(100, Math.max(10, Math.round(Number(merged.imageQuality) || 90)));
  if (!['system', 'light', 'dark'].includes(merged.theme)) merged.theme = 'system';
  if (!['auto', 'en', 'pt'].includes(merged.language)) merged.language = 'auto';
  merged.downloadFolder = sanitizeFolder(String(merged.downloadFolder ?? ''));
  return merged;
}

/** Keeps the folder a simple relative path inside Downloads. */
export function sanitizeFolder(folder: string): string {
  return folder
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/')
    .slice(0, 80);
}

export async function loadSettings(): Promise<Settings> {
  const value = normalize(await readKey<unknown>(KEY, DEFAULT_SETTINGS));
  settingsStore.set(value);
  onKeyChanged(KEY, (next) => settingsStore.set(normalize(next)));
  return value;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const next = normalize({ ...settingsStore.get(), ...patch });
  settingsStore.set(next);
  await writeKey(KEY, next);
}
