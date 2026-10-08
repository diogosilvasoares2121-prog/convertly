import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFDocument, type PDFObject } from 'pdf-lib';
import { unzlibSync } from 'fflate';
import { loadPdf } from './ops';

/**
 * Real, conservative PDF compression (runs in the PDF worker):
 * 1. Re-encodes embedded JPEG images (and, on "strong", large raw RGB/Gray images)
 *    at a lower quality / resolution — only when the result is actually smaller.
 * 2. Optionally removes document metadata.
 * 3. Re-saves with object streams (structural compression).
 * Images we cannot handle safely (CMYK, masks, unusual colour spaces, decode arrays)
 * are left untouched. Reported numbers are measured, never estimated.
 */
export type CompressPreset = 'low' | 'balanced' | 'strong';

const PRESETS: Record<CompressPreset, { quality: number; maxDim: number; flate: boolean }> = {
  low: { quality: 0.82, maxDim: 3000, flate: false },
  balanced: { quality: 0.68, maxDim: 2000, flate: false },
  strong: { quality: 0.5, maxDim: 1400, flate: true },
};

export interface CompressStats {
  imagesFound: number;
  imagesRecompressed: number;
  originalSize: number;
  resultSize: number;
}

function num(obj: PDFObject | undefined): number | null {
  return obj instanceof PDFNumber ? obj.asNumber() : null;
}

function colorComponents(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | null {
  const resolved = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  if (resolved instanceof PDFName) {
    const name = resolved.asString();
    if (name === '/DeviceRGB') return 3;
    if (name === '/DeviceGray') return 1;
    return null;
  }
  if (resolved instanceof PDFArray && resolved.size() === 2) {
    const kind = resolved.get(0);
    if (!(kind instanceof PDFName) || kind.asString() !== '/ICCBased') return null;
    const stream = doc.context.lookup(resolved.get(1));
    const n = stream instanceof PDFRawStream ? num(stream.dict.get(PDFName.of('N'))) : null;
    return n === 3 ? 3 : n === 1 ? 1 : null;
  }
  return null;
}

function singleFilter(dict: PDFDict): string | null {
  const filter = dict.get(PDFName.of('Filter'));
  if (filter instanceof PDFName) return filter.asString();
  if (filter instanceof PDFArray && filter.size() === 1) {
    const f = filter.get(0);
    return f instanceof PDFName ? f.asString() : null;
  }
  return filter === undefined ? '' : null;
}

async function decodeJpeg(bytes: Uint8Array): Promise<ImageBitmap | null> {
  try {
    // 'none': PDF viewers ignore EXIF orientation inside embedded JPEGs, so must we.
    return await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }), { imageOrientation: 'none' });
  } catch {
    return null;
  }
}

function rawToCanvas(data: Uint8Array, width: number, height: number, comps: 1 | 3): OffscreenCanvas | null {
  if (data.length < width * height * comps) return null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(width, height);
  const out = img.data;
  for (let i = 0, p = 0; i < width * height; i++, p += comps) {
    const o = i * 4;
    if (comps === 3) {
      out[o] = data[p]!;
      out[o + 1] = data[p + 1]!;
      out[o + 2] = data[p + 2]!;
    } else {
      out[o] = out[o + 1] = out[o + 2] = data[p]!;
    }
    out[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function reencode(source: ImageBitmap | OffscreenCanvas, maxDim: number, quality: number): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const scale = Math.min(1, maxDim / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  canvas.width = canvas.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

export async function compressPdf(
  source: Uint8Array,
  preset: CompressPreset,
  removeMetadata: boolean,
  onProgress?: (p: number) => void,
): Promise<{ bytes: Uint8Array; stats: CompressStats }> {
  const settings = PRESETS[preset];
  const originalSize = source.byteLength;
  const doc = await loadPdf(source);
  const images: Array<{ ref: PDFRef; stream: PDFRawStream }> = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype instanceof PDFName && subtype.asString() === '/Image') images.push({ ref, stream: obj });
  }

  let recompressed = 0;
  for (const [i, { ref, stream }] of images.entries()) {
    onProgress?.((i / Math.max(1, images.length)) * 0.85);
    const dict = stream.dict;
    if (dict.get(PDFName.of('ImageMask'))?.toString() === 'true') continue;
    if (dict.has(PDFName.of('Decode'))) continue;
    const width = num(dict.get(PDFName.of('Width')));
    const height = num(dict.get(PDFName.of('Height')));
    const bpc = num(dict.get(PDFName.of('BitsPerComponent')));
    if (!width || !height || width * height < 64 * 64) continue;
    const comps = colorComponents(doc, dict.get(PDFName.of('ColorSpace')));
    if (!comps) continue;
    const filter = singleFilter(dict);
    const original = stream.contents;

    let source: ImageBitmap | OffscreenCanvas | null = null;
    if (filter === '/DCTDecode') {
      source = await decodeJpeg(original);
    } else if (filter === '/FlateDecode' && settings.flate && bpc === 8 && !dict.has(PDFName.of('DecodeParms')) && !dict.has(PDFName.of('SMask'))) {
      try {
        source = rawToCanvas(unzlibSync(original), width, height, comps);
      } catch {
        source = null;
      }
    }
    if (!source) continue;
    try {
      const encoded = await reencode(source, settings.maxDim, settings.quality);
      if (!encoded || encoded.bytes.length >= original.length * 0.9) continue;
      const newDict = dict.clone(doc.context);
      newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      newDict.set(PDFName.of('Width'), PDFNumber.of(encoded.width));
      newDict.set(PDFName.of('Height'), PDFNumber.of(encoded.height));
      newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      newDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      newDict.delete(PDFName.of('DecodeParms'));
      newDict.delete(PDFName.of('Length'));
      doc.context.assign(ref, PDFRawStream.of(newDict, encoded.bytes));
      recompressed++;
    } finally {
      if (source instanceof ImageBitmap) source.close();
      else source.width = source.height = 0;
    }
  }

  if (removeMetadata) {
    const infoRef = doc.context.trailerInfo.Info;
    const info = infoRef ? doc.context.lookupMaybe(infoRef, PDFDict) : undefined;
    if (info) for (const key of info.keys()) info.delete(key);
    doc.catalog.delete(PDFName.of('Metadata'));
  }

  onProgress?.(0.9);
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  onProgress?.(1);
  return {
    bytes,
    stats: { imagesFound: images.length, imagesRecompressed: recompressed, originalSize, resultSize: bytes.byteLength },
  };
}
