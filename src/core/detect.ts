import { FORMATS, formatFromExtension, formatFromMime, type Category, type FormatId } from '../registry/formats';
import { splitName } from '../utils/filename';
import { MB, GB } from '../utils/bytes';

export type SizeClass = 'light' | 'medium' | 'heavy' | 'very-heavy';

export interface DetectedFile {
  file: File;
  name: string;
  ext: string;
  mime: string;
  size: number;
  format: FormatId | null;
  category: Category | null;
  /** How the format was determined: file signature (most reliable), extension or MIME. */
  source: 'signature' | 'extension' | 'mime' | 'none';
  /** True when the extension says one thing and the content another (e.g. a PNG named .jpg). */
  extensionMismatch: boolean;
  sizeClass: SizeClass;
  empty: boolean;
}

export function sizeClassOf(bytes: number): SizeClass {
  if (bytes >= GB) return 'very-heavy';
  if (bytes >= 500 * MB) return 'heavy';
  if (bytes >= 100 * MB) return 'medium';
  return 'light';
}

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  let s = '';
  for (let i = start; i < start + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
};

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0): boolean =>
  sig.every((b, i) => bytes[offset + i] === b);

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const QT_BRANDS = new Set(['qt  ']);
const M4A_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);
const GPP_BRANDS = /^3g[2p]/;

/** Reads ISO-BMFF `ftyp` major + compatible brands. */
function ftypBrands(bytes: Uint8Array): string[] | null {
  if (ascii(bytes, 4, 4) !== 'ftyp') return null;
  const size = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const end = Math.min(size, bytes.length);
  const brands = [ascii(bytes, 8, 4)];
  for (let o = 16; o + 4 <= end; o += 4) brands.push(ascii(bytes, o, 4));
  return brands;
}

/**
 * Identifies a format from the first bytes of a file ("magic numbers").
 * Needs at least 64 bytes for reliable results; returns null when unknown.
 */
export function detectFromSignature(bytes: Uint8Array): FormatId | null {
  if (bytes.length < 4) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  const head4 = ascii(bytes, 0, 4);
  if (head4 === 'GIF8') return 'gif';
  if (head4 === 'RIFF') {
    const kind = ascii(bytes, 8, 4);
    if (kind === 'WEBP') return 'webp';
    if (kind === 'WAVE') return 'wav';
    if (kind === 'AVI ') return 'avi';
    return null;
  }
  if (head4 === '%PDF') return 'pdf';
  // PDF headers are allowed to start within the first 1024 bytes.
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes('%PDF-')) return 'pdf';
  if (head4 === 'II*\u0000' || head4 === 'MM\u0000*') return 'tiff';
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) && bytes[4]! > 0) return 'ico';
  if (head4 === 'OggS') {
    return ascii(bytes, 0, Math.min(bytes.length, 128)).includes('OpusHead') ? 'opus' : 'ogg';
  }
  if (head4 === 'fLaC') return 'flac';
  if (head4 === 'FORM') return null;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return 'zip';
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (head4 === 'Rar!') return 'rar';
  if (startsWith(bytes, [0x1f, 0x8b])) return 'gz';
  if (ascii(bytes, 0, 3) === 'BZh') return 'bz2';
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  if (ascii(bytes, 257, 5) === 'ustar') return 'tar';
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = ascii(bytes, 0, Math.min(bytes.length, 64));
    return head.includes('webm') ? 'webm' : 'mkv';
  }
  if (startsWith(bytes, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return 'wmv';
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0xba]) || startsWith(bytes, [0x00, 0x00, 0x01, 0xb3])) return 'mpeg';
  const brands = ftypBrands(bytes);
  if (brands) {
    const major = brands[0]!;
    if (AVIF_BRANDS.has(major)) return 'avif';
    if (HEIC_BRANDS.has(major)) return 'heic';
    if (major === 'mif1' || major === 'msf1') {
      if (brands.some((b) => AVIF_BRANDS.has(b))) return 'avif';
      return 'heic';
    }
    if (QT_BRANDS.has(major)) return 'mov';
    if (M4A_BRANDS.has(major)) return 'm4a';
    if (GPP_BRANDS.test(major)) return '3gp';
    return 'mp4';
  }
  if (ascii(bytes, 4, 4) === 'moov' || ascii(bytes, 4, 4) === 'mdat' || ascii(bytes, 4, 4) === 'wide') return 'mov';
  if (head4.startsWith('BM') && bytes.length >= 26) {
    // BMP: file size field + reserved zeros + DIB header size 12/40/52/56/108/124
    const dib = bytes[14]! | (bytes[15]! << 8);
    if ([12, 40, 52, 56, 64, 108, 124].includes(dib)) return 'bmp';
  }
  if (head4.startsWith('ID3')) return 'mp3';
  if (bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return 'aac'; // ADTS sync (layer bits 00)
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 && (bytes[1]! & 0x06) !== 0) return 'mp3'; // MPEG audio frame
  return null;
}

/** Light-weight text sniffing for data formats when there is no binary signature. */
export function sniffText(bytes: Uint8Array): FormatId | null {
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 512)).replace(/^\uFEFF/, '').trimStart();
  if (!sample) return null;
  if (/[\u0000-\u0008\u000e-\u001f]/.test(sample)) return null; // binary
  if (/<svg[\s>]/i.test(sample) && /^(<\?xml|<!--|<!DOCTYPE svg|<svg)/i.test(sample)) return 'svg';
  if (/^(<!doctype html|<html[\s>])/i.test(sample)) return 'html';
  if (sample.startsWith('<?xml') || /^<[a-zA-Z][\w:-]*[\s>]/.test(sample)) return 'xml';
  if (sample.startsWith('{') || sample.startsWith('[')) return 'json';
  return null;
}

/** Formats that share a container, where the extension is the better hint (e.g. .weba vs .webm). */
const COMPATIBLE: Partial<Record<FormatId, FormatId[]>> = {
  mp4: ['m4a', 'mov', '3gp'],
  mov: ['mp4', 'm4a'],
  m4a: ['mp4'],
  webm: ['weba', 'mkv'],
  mkv: ['webm', 'weba'],
  ogg: ['opus'],
  opus: ['ogg'],
  wmv: ['wma'],
  mp3: ['aac'],
  zip: ['xlsx'],
  gz: ['tar'],
  xml: ['svg', 'html'],
  html: ['xml'],
  svg: ['xml'],
  heic: ['avif'],
};

export function resolveFormat(name: string, mime: string, head: Uint8Array): Omit<DetectedFile, 'file' | 'size' | 'sizeClass' | 'empty' | 'name'> {
  const ext = splitName(name).ext;
  const byExt = ext ? formatFromExtension(ext) : null;
  const byMime = mime ? formatFromMime(mime) : null;
  let bySig = detectFromSignature(head);
  if (!bySig && (!byExt || FORMATS[byExt].category === 'data' || byExt === 'svg')) {
    const sniffed = sniffText(head);
    if (sniffed && (!byExt || byExt === 'txt' || byExt === 'svg' || (sniffed === 'svg' && byExt === 'xml'))) bySig = sniffed;
  }

  let format: FormatId | null = null;
  let source: DetectedFile['source'] = 'none';
  let mismatch = false;
  if (bySig) {
    // Prefer the extension when it names a sibling format of the same container.
    if (byExt && byExt !== bySig && COMPATIBLE[bySig]?.includes(byExt)) {
      format = byExt;
    } else {
      format = bySig;
      if (byExt && byExt !== bySig && !(byExt === 'xml' && bySig === 'xml')) {
        // A .txt file holding JSON is not "wrong", just generic.
        mismatch = !(FORMATS[byExt].category === 'data' && FORMATS[bySig].category === 'data');
      }
    }
    source = 'signature';
  } else if (byExt) {
    // Text formats and a few others have no signature; trust the extension.
    format = byExt;
    source = 'extension';
  } else if (byMime) {
    format = byMime;
    source = 'mime';
  }

  return {
    ext,
    mime: mime || (format ? FORMATS[format].mimes[0]! : ''),
    format,
    category: format ? FORMATS[format].category : null,
    source,
    extensionMismatch: mismatch,
  };
}

/** Detects the real type of a file using its signature, extension and MIME type. Reads only 4 KB. */
export async function detectFile(file: File): Promise<DetectedFile> {
  const head = file.size > 0 ? new Uint8Array(await file.slice(0, 4096).arrayBuffer()) : new Uint8Array();
  const resolved = resolveFormat(file.name, file.type, head);
  return {
    file,
    name: file.name,
    size: file.size,
    sizeClass: sizeClassOf(file.size),
    empty: file.size === 0,
    ...resolved,
  };
}

/** Detects whether an image is animated (GIF / animated WebP / APNG). */
export async function isAnimatedImage(file: Blob, format: FormatId): Promise<boolean> {
  if (format === 'webp') {
    const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    return ascii(head, 12, 4) === 'VP8X' && (head[20]! & 0x02) !== 0;
  }
  if (format === 'png') {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
    let o = 8;
    while (o + 8 <= bytes.length) {
      const len = ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
      const type = ascii(bytes, o + 4, 4);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      o += 12 + len;
    }
    return false;
  }
  if (format === 'gif') {
    return countGifFrames(new Uint8Array(await file.arrayBuffer()), 2) > 1;
  }
  return false;
}

/** Counts GIF image descriptors, stopping early at `stopAt`. */
export function countGifFrames(bytes: Uint8Array, stopAt = Infinity): number {
  if (ascii(bytes, 0, 4) !== 'GIF8') return 0;
  let o = 13;
  const flags = bytes[10] ?? 0;
  if (flags & 0x80) o += 3 * (1 << ((flags & 0x07) + 1));
  let frames = 0;
  const skipSubBlocks = () => {
    while (o < bytes.length) {
      const size = bytes[o++]!;
      if (size === 0) break;
      o += size;
    }
  };
  while (o < bytes.length) {
    const block = bytes[o++];
    if (block === 0x2c) {
      frames++;
      if (frames >= stopAt) return frames;
      const f = bytes[o + 8] ?? 0;
      o += 9;
      if (f & 0x80) o += 3 * (1 << ((f & 0x07) + 1));
      o++; // LZW minimum code size
      skipSubBlocks();
    } else if (block === 0x21) {
      o++; // label
      skipSubBlocks();
    } else {
      break; // 0x3b trailer or corrupt data
    }
  }
  return frames;
}
