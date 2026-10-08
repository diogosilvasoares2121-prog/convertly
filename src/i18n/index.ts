import { createStore, useStore } from '../core/store';
import { en } from './locales/en';
import { pt } from './locales/pt';

export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, string>;
export type Lang = 'en' | 'pt';

/** Adding a language = adding a dictionary here (typed against English, so nothing can be missing). */
export const DICTIONARIES: Record<Lang, Dictionary> = { en, pt };
export const LANGUAGES: Array<{ id: Lang; label: string; locale: string }> = [
  { id: 'en', label: 'English', locale: 'en' },
  { id: 'pt', label: 'Português', locale: 'pt-PT' },
];

export const langStore = createStore<Lang>('en');

export type Params = Record<string, string | number>;

/** Browser UI language → supported language (fallback English). */
export function detectLanguage(): Lang {
  let ui = '';
  try {
    ui = typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage ? chrome.i18n.getUILanguage() : '';
  } catch {
    ui = '';
  }
  if (!ui && typeof navigator !== 'undefined') ui = navigator.language;
  return ui.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function setLanguage(pref: 'auto' | Lang): void {
  const lang = pref === 'auto' ? detectLanguage() : pref;
  langStore.set(lang);
  if (typeof document !== 'undefined') document.documentElement.lang = currentLocale();
}

export function currentLocale(): string {
  return LANGUAGES.find((l) => l.id === langStore.get())?.locale ?? 'en';
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function hasMessage(key: string): key is MessageKey {
  return key in en;
}

export function t(key: MessageKey, params?: Params): string {
  const dict = DICTIONARIES[langStore.get()];
  return interpolate(dict[key] ?? en[key] ?? key, params);
}

type PluralBase<K> = K extends `${infer B}_one` ? B : never;
export type PluralKey = PluralBase<MessageKey>;

/** Plural-aware translation: looks up `${key}_one` / `${key}_other`. */
export function tn(key: PluralKey, count: number, params?: Params): string {
  const rule = new Intl.PluralRules(currentLocale()).select(count);
  const k = (rule === 'one' ? `${key}_one` : `${key}_other`) as MessageKey;
  return t(k, { count: formatNumber(count), ...params });
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocale(), options).format(n);
}

export function formatDate(ts: number): string {
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
}

/** Re-renders the component when the language changes; returns the translator. */
export function useI18n(): { t: typeof t; tn: typeof tn; lang: Lang } {
  const lang = useStore(langStore);
  return { t, tn, lang };
}
