import type { MetadataEntry, MetadataReport } from './types';

/**
 * Dependency-free image metadata reader and byte-level stripper.
 * Supports EXIF/GPS in JPEG, PNG (eXIf), WebP, TIFF and HEIC/AVIF (Exif item),
 * plus detection of XMP, IPTC, ICC profiles and text comments.
 * All parsing is bounds-checked; malformed data is ignored rather than trusted.
 */

const td = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8', { fatal: false });
const str = (b: Uint8Array, start: number, len: number) => td.decode(b.subarray(start, Math.min(b.length, start + len)));

export function emptyReport(): MetadataReport {
  return {
    hasExif: false,
    hasGps: false,
    hasXmp: false,
    hasIptc: false,
    hasIcc: false,
    hasComments: false,
    orientation: null,
    colorSpace: null,
    bitDepth: null,
    entries: [],
  };
}

// ───────────────────────── TIFF / EXIF ─────────────────────────

const IFD0_TAGS: Record<number, [MetadataEntry['group'], string]> = {
  0x010e: ['image', 'Description'],
  0x010f: ['camera', 'Make'],
  0x0110: ['camera', 'Model'],
  0x0131: ['image', 'Software'],
  0x0132: ['image', 'Modified'],
  0x013b: ['text', 'Artist'],
  0x8298: ['text', 'Copyright'],
};
const EXIF_TAGS: Record<number, [MetadataEntry['group'], string]> = {
  0x829a: ['exif', 'Exposure time'],
  0x829d: ['exif', 'F-number'],
  0x8827: ['exif', 'ISO'],
  0x9003: ['exif', 'Date taken'],
  0x920a: ['exif', 'Focal length'],
  0xa405: ['exif', 'Focal length (35mm)'],
  0xa430: ['text', 'Camera owner'],
  0xa431: ['camera', 'Body serial number'],
  0xa433: ['camera', 'Lens make'],
  0xa434: ['camera', 'Lens model'],
  0xa001: ['image', 'Color space'],
};

interface TiffReader {
  u16(o: number): number;
  u32(o: number): number;
  base: number;
  bytes: Uint8Array;
}

function tiffReader(bytes: Uint8Array, base: number): TiffReader | null {
  if (base + 8 > bytes.length) return null;
  const order = str(bytes, base, 2);
  const le = order === 'II';
  if (!le && order !== 'MM') return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r: TiffReader = {
    base,
    bytes,
    u16: (o) => (o + 2 <= bytes.length ? dv.getUint16(o, le) : 0),
    u32: (o) => (o + 4 <= bytes.length ? dv.getUint32(o, le) : 0),
  };
  if (r.u16(base + 2) !== 42) return null;
  return r;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
}

function readIfd(r: TiffReader, offset: number): { entries: IfdEntry[]; next: number } {
  const start = r.base + offset;
  const n = r.u16(start);
  if (!n || n > 1000 || start + 2 + n * 12 > r.bytes.length) return { entries: [], next: 0 };
  const entries: IfdEntry[] = [];
  for (let i = 0; i < n; i++) {
    const e = start + 2 + i * 12;
    const type = r.u16(e + 2);
    const count = r.u32(e + 4);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const valueOffset = size <= 4 ? e + 8 : r.base + r.u32(e + 8);
    entries.push({ tag: r.u16(e), type, count, valueOffset });
  }
  return { entries, next: r.u32(start + 2 + n * 12) };
}

function rational(r: TiffReader, o: number): number {
  const den = r.u32(o + 4);
  return den ? r.u32(o) / den : 0;
}

function entryValue(r: TiffReader, e: IfdEntry): string | number | number[] | null {
  if (e.valueOffset < 0 || e.valueOffset >= r.bytes.length) return null;
  switch (e.type) {
    case 2:
      return utf8.decode(r.bytes.subarray(e.valueOffset, Math.min(r.bytes.length, e.valueOffset + Math.min(e.count, 512)))).replace(/\0+$/, '').trim();
    case 3:
      return e.count === 1 ? r.u16(e.valueOffset) : Array.from({ length: Math.min(e.count, 16) }, (_, i) => r.u16(e.valueOffset + i * 2));
    case 4:
      return e.count === 1 ? r.u32(e.valueOffset) : Array.from({ length: Math.min(e.count, 16) }, (_, i) => r.u32(e.valueOffset + i * 4));
    case 5:
    case 10:
      return e.count === 1 ? rational(r, e.valueOffset) : Array.from({ length: Math.min(e.count, 16) }, (_, i) => rational(r, e.valueOffset + i * 8));
    default:
      return null;
  }
}

function formatValue(tag: number, v: string | number | number[]): string {
  if (Array.isArray(v)) return v.map((x) => (Number.isInteger(x) ? String(x) : x.toFixed(2))).join(', ');
  if (typeof v === 'string') return v;
  if (tag === 0x829a) return v > 0 && v < 1 ? `1/${Math.round(1 / v)} s` : `${v} s`;
  if (tag === 0x829d) return `f/${v.toFixed(1)}`;
  if (tag === 0x920a) return `${v.toFixed(1)} mm`;
  if (tag === 0xa001) return v === 1 ? 'sRGB' : v === 0xffff ? 'Uncalibrated' : String(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

function dmsToDecimal(dms: number[] | number | string | null, ref: string): number | null {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const value = dms[0]! + dms[1]! / 60 + dms[2]! / 3600;
  return ref === 'S' || ref === 'W' ? -value : value;
}

/** Parses a TIFF-structured EXIF block starting at `base` (the "II*\0"/"MM\0*" header). */
export function parseExif(bytes: Uint8Array, base: number, report: MetadataReport): void {
  const r = tiffReader(bytes, base);
  if (!r) return;
  report.hasExif = true;
  const ifd0 = readIfd(r, r.u32(base + 4));
  let exifPtr = 0;
  let gpsPtr = 0;
  for (const e of ifd0.entries) {
    if (e.tag === 0x8769) exifPtr = r.u32(e.valueOffset);
    else if (e.tag === 0x8825) gpsPtr = r.u32(e.valueOffset);
    else if (e.tag === 0x0112) report.orientation = r.u16(e.valueOffset);
    else if (IFD0_TAGS[e.tag]) {
      const v = entryValue(r, e);
      if (v !== null && v !== '') report.entries.push({ group: IFD0_TAGS[e.tag]![0], key: IFD0_TAGS[e.tag]![1], value: formatValue(e.tag, v) });
    }
  }
  if (exifPtr) {
    for (const e of readIfd(r, exifPtr).entries) {
      const def = EXIF_TAGS[e.tag];
      if (!def) continue;
      const v = entryValue(r, e);
      if (v === null || v === '') continue;
      if (e.tag === 0xa001) report.colorSpace = formatValue(e.tag, v);
      report.entries.push({ group: def[0], key: def[1], value: formatValue(e.tag, v) });
    }
  }
  if (gpsPtr) {
    const gps = readIfd(r, gpsPtr).entries;
    const get = (tag: number) => {
      const e = gps.find((x) => x.tag === tag);
      return e ? entryValue(r, e) : null;
    };
    const lat = dmsToDecimal(get(2) as number[] | null, String(get(1) ?? 'N'));
    const lon = dmsToDecimal(get(4) as number[] | null, String(get(3) ?? 'E'));
    if (gps.length) report.hasGps = true;
    if (lat !== null && lon !== null) {
      report.entries.push({ group: 'gps', key: 'GPS position', value: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
    }
    const alt = get(6);
    if (typeof alt === 'number') report.entries.push({ group: 'gps', key: 'GPS altitude', value: `${alt.toFixed(1)} m` });
  }
}

// ───────────────────────── Container walkers ─────────────────────────

export interface JpegSegment {
  marker: number;
  start: number;
  /** Offset just after the segment. */
  end: number;
  dataStart: number;
}

/** Lists JPEG marker segments up to (not including) the SOS scan data. */
export function jpegSegments(bytes: Uint8Array): { segments: JpegSegment[]; scanStart: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const segments: JpegSegment[] = [];
  let o = 2;
  while (o + 4 <= bytes.length) {
    if (bytes[o] !== 0xff) return null;
    let marker = bytes[o + 1]!;
    while (marker === 0xff && o + 2 < bytes.length) {
      o++;
      marker = bytes[o + 1]!;
    }
    if (marker === 0xda) return { segments, scanStart: o };
    if (marker >= 0xd0 && marker <= 0xd7) {
      o += 2;
      continue;
    }
    const len = (bytes[o + 2]! << 8) | bytes[o + 3]!;
    if (len < 2) return null;
    segments.push({ marker, start: o, end: o + 2 + len, dataStart: o + 4 });
    o += 2 + len;
  }
  return null;
}

function readJpeg(bytes: Uint8Array, report: MetadataReport): void {
  const parsed = jpegSegments(bytes);
  if (!parsed) return;
  for (const s of parsed.segments) {
    const sig = str(bytes, s.dataStart, 32);
    if (s.marker === 0xe1 && sig.startsWith('Exif\0')) parseExif(bytes, s.dataStart + 6, report);
    else if (s.marker === 0xe1 && sig.startsWith('http://ns.adobe.com/xap')) report.hasXmp = true;
    else if (s.marker === 0xed && sig.startsWith('Photoshop 3.0')) report.hasIptc = true;
    else if (s.marker === 0xe2 && sig.startsWith('ICC_PROFILE')) report.hasIcc = true;
    else if (s.marker === 0xfe) report.hasComments = true;
    else if (s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc) {
      report.bitDepth = bytes[s.dataStart] ?? null;
      const comps = bytes[s.dataStart + 5];
      if (!report.colorSpace) report.colorSpace = comps === 1 ? 'Grayscale' : comps === 4 ? 'CMYK' : 'YCbCr';
    }
  }
}

interface PngChunk {
  type: string;
  start: number;
  end: number;
  dataStart: number;
  length: number;
}

export function pngChunks(bytes: Uint8Array): PngChunk[] | null {
  if (bytes[0] !== 0x89 || str(bytes, 1, 3) !== 'PNG') return null;
  const chunks: PngChunk[] = [];
  let o = 8;
  while (o + 12 <= bytes.length) {
    const length = ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
    const type = str(bytes, o + 4, 4);
    const end = o + 12 + length;
    if (end > bytes.length) break;
    chunks.push({ type, start: o, end, dataStart: o + 8, length });
    o = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

const PNG_COLOR: Record<number, string> = { 0: 'Grayscale', 2: 'RGB', 3: 'Indexed', 4: 'Grayscale + alpha', 6: 'RGBA' };

function readPng(bytes: Uint8Array, report: MetadataReport): void {
  const chunks = pngChunks(bytes);
  if (!chunks) return;
  for (const c of chunks) {
    if (c.type === 'IHDR') {
      report.bitDepth = bytes[c.dataStart + 8] ?? null;
      report.colorSpace = PNG_COLOR[bytes[c.dataStart + 9] ?? -1] ?? null;
    } else if (c.type === 'eXIf') parseExif(bytes, c.dataStart, report);
    else if (c.type === 'iCCP') report.hasIcc = true;
    else if (c.type === 'tEXt' || c.type === 'iTXt' || c.type === 'zTXt') {
      const keyword = str(bytes, c.dataStart, Math.min(79, c.length)).split('\0')[0] ?? '';
      if (keyword === 'XML:com.adobe.xmp') report.hasXmp = true;
      else {
        report.hasComments = true;
        if (c.type === 'tEXt' && keyword) {
          const value = utf8.decode(bytes.subarray(c.dataStart + keyword.length + 1, Math.min(c.end - 4, c.dataStart + keyword.length + 1 + 200)));
          report.entries.push({ group: 'text', key: keyword, value });
        }
      }
    }
  }
}

interface RiffChunk {
  type: string;
  start: number;
  end: number;
  dataStart: number;
  length: number;
}

export function webpChunks(bytes: Uint8Array): RiffChunk[] | null {
  if (str(bytes, 0, 4) !== 'RIFF' || str(bytes, 8, 4) !== 'WEBP') return null;
  const chunks: RiffChunk[] = [];
  let o = 12;
  while (o + 8 <= bytes.length) {
    const length = (bytes[o + 4]! | (bytes[o + 5]! << 8) | (bytes[o + 6]! << 16) | (bytes[o + 7]! << 24)) >>> 0;
    const end = o + 8 + length + (length & 1);
    chunks.push({ type: str(bytes, o, 4), start: o, end: Math.min(end, bytes.length), dataStart: o + 8, length });
    o = end;
  }
  return chunks;
}

function readWebp(bytes: Uint8Array, report: MetadataReport): void {
  const chunks = webpChunks(bytes);
  if (!chunks) return;
  for (const c of chunks) {
    if (c.type === 'EXIF') {
      const off = str(bytes, c.dataStart, 6) === 'Exif\0\0' ? 6 : 0;
      parseExif(bytes, c.dataStart + off, report);
    } else if (c.type === 'XMP ') report.hasXmp = true;
    else if (c.type === 'ICCP') report.hasIcc = true;
  }
}

/** Finds the EXIF payload of a HEIF/AVIF file via its `meta` box (iinf + iloc). */
function readHeif(bytes: Uint8Array, report: MetadataReport): void {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (o: number) => (o + 4 <= bytes.length ? dv.getUint32(o) : 0);
  const u16 = (o: number) => (o + 2 <= bytes.length ? dv.getUint16(o) : 0);
  const boxes = (start: number, end: number) => {
    const out: Array<{ type: string; start: number; end: number; body: number }> = [];
    let o = start;
    while (o + 8 <= end) {
      let size = u32(o);
      let header = 8;
      if (size === 1) {
        size = Number(dv.getBigUint64(o + 8));
        header = 16;
      } else if (size === 0) size = end - o;
      if (size < header || o + size > end) break;
      out.push({ type: str(bytes, o + 4, 4), start: o, end: o + size, body: o + header });
      o += size;
    }
    return out;
  };
  const meta = boxes(0, bytes.length).find((b) => b.type === 'meta');
  if (!meta) return;
  const children = boxes(meta.body + 4, meta.end);
  const iinf = children.find((b) => b.type === 'iinf');
  const iloc = children.find((b) => b.type === 'iloc');
  if (children.some((b) => b.type === 'iprp')) {
    const iprp = children.find((b) => b.type === 'iprp')!;
    const ipco = boxes(iprp.body, iprp.end).find((b) => b.type === 'ipco');
    if (ipco && boxes(ipco.body, ipco.end).some((b) => b.type === 'colr')) report.hasIcc = true;
  }
  if (!iinf || !iloc) return;
  const iinfVersion = bytes[iinf.body]!;
  const entryStart = iinf.body + 4 + (iinfVersion === 0 ? 2 : 4);
  let exifId = -1;
  for (const infe of boxes(entryStart, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const v = bytes[infe.body]!;
    if (v < 2) continue;
    const id = v === 2 ? u16(infe.body + 4) : u32(infe.body + 4);
    const typeOffset = infe.body + 4 + (v === 2 ? 2 : 4) + 2;
    const itemType = str(bytes, typeOffset, 4);
    if (itemType === 'Exif') exifId = id;
    if (itemType === 'mime') {
      const rest = str(bytes, typeOffset + 4, Math.min(80, infe.end - typeOffset - 4));
      if (rest.includes('xmp') || rest.includes('rdf+xml')) report.hasXmp = true;
    }
  }
  if (exifId < 0) return;
  // iloc
  const v = bytes[iloc.body]!;
  let o = iloc.body + 4;
  const sizes1 = bytes[o]!;
  const sizes2 = bytes[o + 1]!;
  o += 2;
  const offSize = sizes1 >> 4;
  const lenSize = sizes1 & 15;
  const baseSize = sizes2 >> 4;
  const idxSize = v === 1 || v === 2 ? sizes2 & 15 : 0;
  const readN = (n: number, at: number) => (n === 0 ? 0 : n === 4 ? u32(at) : n === 8 ? Number(dv.getBigUint64(at)) : n === 2 ? u16(at) : 0);
  const count = v < 2 ? u16(o) : u32(o);
  o += v < 2 ? 2 : 4;
  for (let i = 0; i < count && o < iloc.end; i++) {
    const id = v < 2 ? u16(o) : u32(o);
    o += v < 2 ? 2 : 4;
    if (v === 1 || v === 2) o += 2; // construction method
    o += 2; // data reference index
    const base = readN(baseSize, o);
    o += baseSize;
    const extents = u16(o);
    o += 2;
    for (let k = 0; k < extents; k++) {
      o += idxSize;
      const extOff = readN(offSize, o);
      o += offSize;
      const extLen = readN(lenSize, o);
      o += lenSize;
      if (id === exifId && k === 0) {
        const start = base + extOff;
        if (start + 4 > bytes.length || extLen < 8) return;
        const tiffOffset = u32(start);
        parseExif(bytes, start + 4 + tiffOffset, report);
        return;
      }
    }
  }
}

/** Reads all metadata Convertly can identify. `format` is the detected format id. */
export function readMetadata(bytes: Uint8Array, format: string): MetadataReport {
  const report = emptyReport();
  try {
    if (format === 'jpg') readJpeg(bytes, report);
    else if (format === 'png') readPng(bytes, report);
    else if (format === 'webp') readWebp(bytes, report);
    else if (format === 'tiff') parseExif(bytes, 0, report);
    else if (format === 'heic' || format === 'avif') readHeif(bytes, report);
  } catch {
    /* Malformed metadata is reported as absent, never trusted. */
  }
  return report;
}

// ───────────────────────── Byte-level stripping ─────────────────────────

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Removes EXIF, XMP, IPTC and comments from a JPEG without re-encoding.
 * Keeps JFIF (APP0), ICC colour profiles (APP2) and Adobe colour info (APP14).
 */
export function stripJpeg(bytes: Uint8Array): { data: Uint8Array; removed: string[] } | null {
  const parsed = jpegSegments(bytes);
  if (!parsed) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const removed = new Set<string>();
  for (const s of parsed.segments) {
    const sig = str(bytes, s.dataStart, 32);
    const isApp = s.marker >= 0xe0 && s.marker <= 0xef;
    const keep = !isApp ? s.marker !== 0xfe : s.marker === 0xe0 || (s.marker === 0xe2 && sig.startsWith('ICC_PROFILE')) || s.marker === 0xee;
    if (keep) parts.push(bytes.subarray(s.start, s.end));
    else if (s.marker === 0xfe) removed.add('Comments');
    else if (s.marker === 0xe1 && sig.startsWith('Exif')) removed.add('EXIF');
    else if (s.marker === 0xe1) removed.add('XMP');
    else if (s.marker === 0xed) removed.add('IPTC');
    else removed.add('Other metadata');
  }
  parts.push(bytes.subarray(parsed.scanStart));
  return { data: concat(parts), removed: [...removed] };
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** Removes text chunks, EXIF and timestamps from a PNG without touching the image data. */
export function stripPng(bytes: Uint8Array): { data: Uint8Array; removed: string[] } | null {
  const chunks = pngChunks(bytes);
  if (!chunks) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed = new Set<string>();
  for (const c of chunks) {
    if (PNG_DROP.has(c.type)) removed.add(c.type === 'eXIf' ? 'EXIF' : c.type === 'tIME' ? 'Timestamp' : 'Text metadata');
    else parts.push(bytes.subarray(c.start, c.end));
  }
  return { data: concat(parts), removed: [...removed] };
}

/** Removes EXIF and XMP chunks from a WebP and fixes the VP8X flags and RIFF size. */
export function stripWebp(bytes: Uint8Array): { data: Uint8Array; removed: string[] } | null {
  const chunks = webpChunks(bytes);
  if (!chunks) return null;
  const removed = new Set<string>();
  const parts: Uint8Array[] = [bytes.slice(0, 12)];
  for (const c of chunks) {
    if (c.type === 'EXIF') removed.add('EXIF');
    else if (c.type === 'XMP ') removed.add('XMP');
    else if (c.type === 'VP8X') {
      const copy = bytes.slice(c.start, c.end);
      copy[8] = copy[8]! & ~(0x08 | 0x04); // clear EXIF + XMP flags
      parts.push(copy);
    } else parts.push(bytes.subarray(c.start, c.end));
  }
  const out = concat(parts);
  const riffSize = out.length - 8;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >> 8) & 0xff;
  out[6] = (riffSize >> 16) & 0xff;
  out[7] = (riffSize >>> 24) & 0xff;
  return { data: out, removed: [...removed] };
}
