import { inflateSync } from 'fflate';
import { AppError } from '../../core/errors';
import { sanitizeRelativePath } from '../../utils/filename';
import { crc32 } from './crc32';

/**
 * Safe ZIP reader. Reads only the central directory to list entries, then
 * extracts entries one by one from slices of the Blob (no full-archive copy).
 *
 * Security:
 * - every path is sanitised (no "..", no absolute paths, no drive letters) — zip-slip safe;
 * - encrypted entries and symlinks are reported and never extracted;
 * - declared sizes are bounded (zip-bomb guard) and CRC-32 is verified;
 * - nothing found inside an archive is ever executed.
 */
export interface ZipEntry {
  index: number;
  /** Original name stored in the archive. */
  rawName: string;
  /** Sanitised relative path used for extraction. */
  path: string;
  isDirectory: boolean;
  compressedSize: number;
  size: number;
  method: number;
  crc: number;
  encrypted: boolean;
  symlink: boolean;
  /** The original path tried to escape the folder or was absolute. */
  unsafePath: boolean;
  supported: boolean;
  modified: number | null;
  localHeaderOffset: number;
}

export const MAX_ENTRY_SIZE = 2 * 1024 * 1024 * 1024 - 1; // 2 GB per entry
export const MAX_ENTRIES = 100_000;

const EXECUTABLE = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'jar', 'sh', 'app', 'dmg', 'pkg', 'apk', 'lnk', 'reg', 'hta', 'cpl', 'pif', 'dll', 'msix', 'appx', 'deb', 'rpm']);

export function isExecutableName(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return path.includes('.') && EXECUTABLE.has(ext);
}

const cp437 =
  '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  // Try UTF-8 first (many tools write UTF-8 without the flag), fall back to CP437.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += cp437[b] ?? '?';
    return s;
  }
}

function dosDate(time: number, date: number): number | null {
  if (!date) return null;
  const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

async function readSlice(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Lists entries of a ZIP archive by parsing its central directory. */
export async function listZip(blob: Blob): Promise<ZipEntry[]> {
  if (blob.size < 22) throw new AppError(blob.size === 0 ? 'empty-file' : 'invalid-archive');
  const tailSize = Math.min(blob.size, 65_557 + 20);
  const tailStart = blob.size - tailSize;
  const tail = await readSlice(blob, tailStart, blob.size);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new AppError('invalid-archive', 'End of central directory not found');
  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  // ZIP64
  if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64Offset = Number(dv.getBigUint64(eocd - 20 + 8, true));
    const z64 = await readSlice(blob, z64Offset, z64Offset + 56);
    const zdv = new DataView(z64.buffer, z64.byteOffset, z64.byteLength);
    if (zdv.getUint32(0, true) !== 0x06064b50) throw new AppError('invalid-archive', 'Bad ZIP64 record');
    count = Number(zdv.getBigUint64(32, true));
    cdSize = Number(zdv.getBigUint64(40, true));
    cdOffset = Number(zdv.getBigUint64(48, true));
  }
  if (count > MAX_ENTRIES) throw new AppError('archive-too-large', `${count} entries`);
  if (cdOffset + cdSize > blob.size) throw new AppError('invalid-archive', 'Central directory out of range');

  const cd = await readSlice(blob, cdOffset, cdOffset + cdSize);
  const cdv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: ZipEntry[] = [];
  let o = 0;
  for (let i = 0; i < count; i++) {
    if (o + 46 > cd.length || cdv.getUint32(o, true) !== 0x02014b50) throw new AppError('invalid-archive', 'Corrupt central directory');
    const versionMadeBy = cdv.getUint16(o + 4, true);
    const flags = cdv.getUint16(o + 8, true);
    const method = cdv.getUint16(o + 10, true);
    const time = cdv.getUint16(o + 12, true);
    const date = cdv.getUint16(o + 14, true);
    const crc = cdv.getUint32(o + 16, true);
    let compressedSize = cdv.getUint32(o + 20, true);
    let size = cdv.getUint32(o + 24, true);
    const nameLen = cdv.getUint16(o + 28, true);
    const extraLen = cdv.getUint16(o + 30, true);
    const commentLen = cdv.getUint16(o + 32, true);
    const externalAttrs = cdv.getUint32(o + 38, true);
    let localHeaderOffset = cdv.getUint32(o + 42, true);
    const nameBytes = cd.subarray(o + 46, o + 46 + nameLen);
    // ZIP64 extra field
    let e = o + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cdv.getUint16(e, true);
      const len = cdv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let p = e + 4;
        if (size === 0xffffffff) { size = Number(cdv.getBigUint64(p, true)); p += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(cdv.getBigUint64(p, true)); p += 8; }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(cdv.getBigUint64(p, true)); }
      }
      e += 4 + len;
    }
    o = extraEnd + commentLen;

    const rawName = decodeName(nameBytes, (flags & 0x0800) !== 0);
    const normalized = rawName.replace(/\\/g, '/');
    const isDirectory = normalized.endsWith('/');
    const unsafePath = normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..');
    const unixMode = versionMadeBy >> 8 === 3 ? externalAttrs >>> 16 : 0;
    const symlink = (unixMode & 0o170000) === 0o120000;
    const encrypted = (flags & 0x0001) !== 0;
    entries.push({
      index: i,
      rawName,
      path: sanitizeRelativePath(normalized) || `file-${i + 1}`,
      isDirectory,
      compressedSize,
      size,
      method,
      crc,
      encrypted,
      symlink,
      unsafePath,
      supported: !encrypted && !symlink && (method === 0 || method === 8) && size <= MAX_ENTRY_SIZE,
      modified: dosDate(time, date),
      localHeaderOffset,
    });
  }
  return entries;
}

/** Extracts one entry. Verifies size and CRC-32. */
export async function extractEntry(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new AppError('archive-encrypted');
  if (entry.symlink || entry.isDirectory) throw new AppError('invalid-input', 'Not a regular file');
  if (entry.size > MAX_ENTRY_SIZE) throw new AppError('archive-too-large');
  if (entry.method !== 0 && entry.method !== 8) throw new AppError('unsupported-format', `Compression method ${entry.method}`);
  const header = await readSlice(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const hdv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.length < 30 || hdv.getUint32(0, true) !== 0x04034b50) throw new AppError('invalid-archive', 'Bad local header');
  const dataStart = entry.localHeaderOffset + 30 + hdv.getUint16(26, true) + hdv.getUint16(28, true);
  const end = dataStart + entry.compressedSize;
  if (end > blob.size) throw new AppError('invalid-archive', 'Entry data out of range');
  const compressed = await readSlice(blob, dataStart, end);
  let data: Uint8Array;
  if (entry.method === 0) {
    data = compressed;
  } else {
    try {
      // Pre-sized output: inflation cannot grow beyond the declared size (zip-bomb guard).
      data = inflateSync(compressed, { out: new Uint8Array(entry.size) });
    } catch {
      throw new AppError('invalid-archive', `Corrupt data in ${entry.path}`);
    }
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc) {
    throw new AppError('invalid-archive', `Checksum mismatch in ${entry.path}`);
  }
  return data;
}
