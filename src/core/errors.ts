/**
 * Centralised error model. Every failure shown to the user maps to one of these
 * codes, each with a translated title, explanation and suggestions.
 */
export type ErrorCode =
  | 'unsupported-format'
  | 'corrupted-file'
  | 'empty-file'
  | 'pdf-encrypted'
  | 'pdf-wrong-password'
  | 'out-of-memory'
  | 'unsupported-codec'
  | 'no-audio-track'
  | 'no-video-track'
  | 'invalid-archive'
  | 'archive-encrypted'
  | 'archive-wrong-password'
  | 'archive-too-large'
  | 'browser-limitation'
  | 'invalid-input'
  | 'target-unreachable'
  | 'cancelled'
  | 'conversion-failed';

export interface SerializedError {
  __appError: true;
  code: ErrorCode;
  message: string;
  detail?: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }

  serialize(): SerializedError {
    return { __appError: true, code: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

export function isSerializedError(value: unknown): value is SerializedError {
  return typeof value === 'object' && value !== null && (value as SerializedError).__appError === true;
}

const OOM_PATTERNS = [
  /array buffer allocation failed/i,
  /out of memory/i,
  /cannot enlarge memory/i,
  /could not allocate memory/i,
  /allocation failed/i,
  /invalid array length/i,
  /invalid typed array length/i,
  /maximum call stack/i,
  /Aborted\(OOM\)/i,
];

/** Converts anything thrown (by our code, a library, the browser or a worker) into an AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (isSerializedError(err)) return new AppError(err.code, err.detail);
  if (err instanceof DOMException && err.name === 'AbortError') return new AppError('cancelled');
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const name = err instanceof Error ? err.name : '';
  if (OOM_PATTERNS.some((re) => re.test(message))) return new AppError('out-of-memory', message, { cause: err });
  if (name === 'QuotaExceededError') return new AppError('out-of-memory', message, { cause: err });
  if (name === 'EncryptedPDFError' || /is encrypted/i.test(message)) return new AppError('pdf-encrypted', undefined, { cause: err });
  if (name === 'PasswordException') {
    return /incorrect/i.test(message)
      ? new AppError('pdf-wrong-password', undefined, { cause: err })
      : new AppError('pdf-encrypted', undefined, { cause: err });
  }
  if (name === 'InvalidPDFException' || /invalid pdf|failed to parse pdf|no pdf header/i.test(message)) {
    return new AppError('corrupted-file', message, { cause: err });
  }
  if (name === 'EncodingError' || /could not be decoded|source image cannot be decoded/i.test(message)) {
    return new AppError('corrupted-file', message, { cause: err });
  }
  return new AppError('conversion-failed', message || String(err), { cause: err });
}

export function isCancelled(err: unknown): boolean {
  return (err instanceof AppError && err.code === 'cancelled') || (err instanceof DOMException && err.name === 'AbortError');
}

/** Throws a cancellation AppError when the signal is aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AppError('cancelled');
}
