const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human readable size using 1024 multiples (matches what OS file managers show). */
export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return `${formatted} ${UNITS[unit]}`;
}

/** Percentage saved going from `before` to `after` (negative when the file grew). */
export function savedPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round((1 - after / before) * 100);
}

export const KB = 1024;
export const MB = 1024 * 1024;
export const GB = 1024 * MB;
