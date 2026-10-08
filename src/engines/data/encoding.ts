/** Base64 and URL encoding helpers (UTF-8 safe, chunked for large inputs). */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  const parts: string[] = [];
  const CHUNK = 0x8000 * 3; // multiple of 3 so chunks concatenate cleanly
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, Math.min(bytes.length, i + CHUNK));
    let binary = '';
    for (let k = 0; k < sub.length; k += 0x8000) binary += String.fromCharCode(...sub.subarray(k, k + 0x8000));
    parts.push(btoa(binary));
  }
  const out = parts.join('');
  return urlSafe ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out;
}

export class Base64Error extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'Base64Error';
  }
}

/** Decodes standard or URL-safe Base64; ignores whitespace and missing padding. */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  for (let i = 0; i < clean.length; i++) {
    if (!ALPHABET.includes(clean[i]!)) throw new Base64Error(`Invalid character "${clean[i]}"`, i);
  }
  if (clean.length % 4 === 1) throw new Base64Error('Invalid length', clean.length);
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function textToBase64(text: string, urlSafe = false): string {
  return bytesToBase64(new TextEncoder().encode(text), urlSafe);
}

/** Returns the decoded text, or null when the bytes are not valid UTF-8 (binary data). */
export function base64ToText(input: string): { text: string | null; bytes: Uint8Array } {
  const bytes = base64ToBytes(input);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes };
  } catch {
    return { text: null, bytes };
  }
}

/** Splits "data:image/png;base64,AAAA" into its MIME type and payload. */
export function parseDataUrl(input: string): { mime: string | null; payload: string } {
  const m = /^\s*data:([\w.+-]+\/[\w.+-]+)?(?:;[\w-]+=[\w.-]+)*;base64,/i.exec(input);
  if (!m) return { mime: null, payload: input };
  return { mime: m[1]?.toLowerCase() ?? null, payload: input.slice(m[0].length) };
}

export type UrlMode = 'component' | 'full';

export function urlEncode(text: string, mode: UrlMode): string {
  return mode === 'full' ? encodeURI(text) : encodeURIComponent(text);
}

export class UrlDecodeError extends Error {
  constructor(readonly position: number) {
    super(`Malformed percent-encoding at position ${position + 1}`);
    this.name = 'UrlDecodeError';
  }
}

export function urlDecode(text: string, plusAsSpace: boolean): string {
  const input = plusAsSpace ? text.replace(/\+/g, ' ') : text;
  try {
    return decodeURIComponent(input);
  } catch {
    // Locate the first malformed sequence for a helpful message.
    const re = /%[0-9a-fA-F]{2}(?:%[0-9a-fA-F]{2})*|%/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input))) {
      try {
        decodeURIComponent(m[0]);
      } catch {
        throw new UrlDecodeError(m.index);
      }
    }
    throw new UrlDecodeError(0);
  }
}
