import { AppError } from '../../core/errors';

/** Parses "00:01:23.45" (HH:MM:SS.xx) into seconds. */
export function parseClock(value: string): number | null {
  const m = /^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!m) return null;
  const seconds = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return m[1] ? -seconds : seconds;
}

/** Tracks FFmpeg log output to compute real progress from "time=" stats lines. */
export class ProgressTracker {
  private duration: number | null;

  constructor(duration: number | null) {
    this.duration = duration && duration > 0 ? duration : null;
  }

  /** Returns progress 0..1, or undefined when the line carries no progress information. */
  update(line: string): number | undefined {
    if (!this.duration) {
      const d = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(line);
      if (d) {
        const seconds = parseClock(d[1]!);
        if (seconds && seconds > 0) this.duration = seconds;
      }
    }
    const t = /time=\s*(-?\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(line);
    if (!t || !this.duration) return undefined;
    const seconds = parseClock(t[1]!);
    if (seconds === null || seconds < 0) return undefined;
    return Math.max(0, Math.min(0.99, seconds / this.duration));
  }
}

/** Maps FFmpeg log output (last lines) to a meaningful AppError. */
export function errorFromLogs(logs: string[], kind: 'convert' | 'audio' = 'convert'): AppError {
  const text = logs.join('\n');
  const detail = logs
    .filter((l) => /error|invalid|failed|not found|unknown|unsupported|could not|cannot|matches no streams/i.test(l))
    .slice(-3)
    .join(' · ');
  if (/cannot allocate memory|out of memory|OOM|Cannot enlarge memory/i.test(text)) return new AppError('out-of-memory', detail);
  if (/matches no streams|does not contain any stream|Output file #0 does not contain/i.test(text)) {
    return new AppError(kind === 'audio' ? 'no-audio-track' : 'no-video-track', detail);
  }
  if (/Decoder \(codec [\w-]+\) not found|Unknown decoder|unsupported codec|Codec [\w-]+ is not supported|No decoder for|Failed to get pixel format|Your platform doesn't support hardware accelerated/i.test(text)) {
    return new AppError('unsupported-codec', detail);
  }
  if (/Unknown encoder|Encoder not found|codec not currently supported in container|Could not find tag for codec/i.test(text)) {
    return new AppError('unsupported-codec', detail);
  }
  if (/Invalid data found when processing input|moov atom not found|EBML header parsing failed|could not find codec parameters|Invalid argument/i.test(text)) {
    return new AppError('corrupted-file', detail);
  }
  return new AppError('conversion-failed', detail || logs.slice(-2).join(' · '));
}
