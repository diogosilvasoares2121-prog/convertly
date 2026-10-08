import { AppError } from '../../core/errors';
import { NameDeduper, sanitizeRelativePath } from '../../utils/filename';

/**
 * Minimal POSIX ustar writer (with PAX headers for long/unicode names) — enough for
 * creating .tar and .tar.gz archives that every tool (tar, 7-Zip, macOS, Windows) opens.
 */
const BLOCK = 512;
const enc = new TextEncoder();

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

function header(name: string, size: number, mtime: number, type: '0' | 'x', prefix = ''): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const put = (text: string | Uint8Array, offset: number, length: number) => {
    const bytes = typeof text === 'string' ? enc.encode(text) : text;
    h.set(bytes.subarray(0, length), offset);
  };
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(Math.floor(mtime / 1000), 12), 136, 12);
  put('        ', 148, 8); // checksum placeholder
  put(type, 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(octal(sum, 7) + ' ', 148, 8);
  return h;
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = enc.encode(body).length;
  len += String(len).length;
  if (String(len).length !== String(len - String(len).length).length) len++;
  return `${len}${body}`;
}

/** Splits a path into ustar name/prefix, or returns null when a PAX header is required. */
function ustarName(path: string): { name: string; prefix: string } | null {
  if (!/^[\x20-\x7e]*$/.test(path)) return null;
  if (enc.encode(path).length <= 100) return { name: path, prefix: '' };
  const slash = path.lastIndexOf('/', 155);
  if (slash > 0 && path.length - slash - 1 <= 100) return { name: path.slice(slash + 1), prefix: path.slice(0, slash) };
  return null;
}

const pad = (n: number) => (BLOCK - (n % BLOCK)) % BLOCK;

export async function createTar(
  inputs: Array<{ path: string; blob: Blob; lastModified?: number }>,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  if (!inputs.length) throw new AppError('invalid-input', 'No files to add');
  const parts: BlobPart[] = [];
  const dedupe = new NameDeduper();
  const total = inputs.reduce((n, f) => n + f.blob.size, 0) || 1;
  let done = 0;
  for (const input of inputs) {
    const path = dedupe.unique(sanitizeRelativePath(input.path) || 'file');
    const mtime = input.lastModified ?? Date.now();
    const plain = ustarName(path);
    if (plain) {
      parts.push(header(plain.name, input.blob.size, mtime, '0', plain.prefix) as BlobPart);
    } else {
      const pax = enc.encode(paxRecord('path', path));
      parts.push(header(`PaxHeaders/${String(parts.length)}`, pax.length, mtime, 'x') as BlobPart, pax as BlobPart, new Uint8Array(pad(pax.length)));
      parts.push(header(path.replace(/[^\x20-\x7e]/g, '_').slice(-100), input.blob.size, mtime, '0') as BlobPart);
    }
    parts.push(input.blob, new Uint8Array(pad(input.blob.size)));
    done += input.blob.size;
    onProgress?.(done / total);
  }
  parts.push(new Uint8Array(BLOCK * 2));
  return new Blob(parts, { type: 'application/x-tar' });
}
