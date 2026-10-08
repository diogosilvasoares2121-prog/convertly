/** Formats milliseconds as e.g. "850 ms", "1.8 s", "2 min 05 s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  if (m < 60) return `${m} min ${String(rem).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Formats seconds as an HH:MM:SS(.mmm) timecode. */
export function formatTimecode(seconds: number, withMillis = false): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalMs = Math.round(safe * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withMillis ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

/**
 * Parses "HH:MM:SS(.mmm)", "MM:SS" or "SS(.mmm)" into seconds.
 * Returns null for invalid input.
 */
export function parseTimecode(input: string): number | null {
  const text = input.trim().replace(',', '.');
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text)) return null;
  const [main, frac] = text.split('.') as [string, string | undefined];
  const parts = main.split(':').map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  if (frac) seconds += Number(`0.${frac}`);
  return seconds;
}
