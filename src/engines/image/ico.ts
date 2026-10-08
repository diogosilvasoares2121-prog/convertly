/**
 * Builds a Windows ICO file from PNG images (PNG-compressed entries, supported by
 * every browser and Windows Vista+). Sizes up to 256 px.
 */
export interface IcoEntry {
  size: number;
  png: Uint8Array;
}

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export function buildIco(entries: IcoEntry[]): Uint8Array {
  if (!entries.length) throw new Error('No icon sizes');
  const sorted = [...entries].sort((a, b) => a.size - b.size);
  const headerSize = 6 + 16 * sorted.length;
  const total = headerSize + sorted.reduce((n, e) => n + e.png.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0, true); // reserved
  dv.setUint16(2, 1, true); // type: icon
  dv.setUint16(4, sorted.length, true);
  let offset = headerSize;
  sorted.forEach((e, i) => {
    if (e.size < 1 || e.size > 256) throw new Error(`Invalid icon size ${e.size}`);
    const p = 6 + i * 16;
    out[p] = e.size === 256 ? 0 : e.size; // width (0 = 256)
    out[p + 1] = e.size === 256 ? 0 : e.size; // height
    out[p + 2] = 0; // palette colours
    out[p + 3] = 0; // reserved
    dv.setUint16(p + 4, 1, true); // colour planes
    dv.setUint16(p + 6, 32, true); // bits per pixel
    dv.setUint32(p + 8, e.png.length, true);
    dv.setUint32(p + 12, offset, true);
    out.set(e.png, offset);
    offset += e.png.length;
  });
  return out;
}

/** Reads the entry table of an ICO file (used by tests and detection). */
export function readIcoSizes(bytes: Uint8Array): number[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0, true) !== 0 || dv.getUint16(2, true) !== 1) return [];
  const count = dv.getUint16(4, true);
  return Array.from({ length: count }, (_, i) => bytes[6 + i * 16] || 256);
}
