import { PDFArray, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFDocument, type PDFObject } from 'pdf-lib';
import { unzlibSync } from 'fflate';
import { loadPdf } from './ops';

/**
 * Extracts embedded raster images from a PDF (runs in the PDF worker).
 * - JPEG (DCTDecode) and JPEG 2000 (JPXDecode) streams are saved byte-for-byte.
 * - Flate-compressed 8-bit RGB / Gray / CMYK images are converted to PNG.
 * Other encodings (CCITT fax, JBIG2, indexed palettes…) are counted and skipped.
 */
export interface ExtractedImage {
  name: string;
  blob: Blob;
  width: number;
  height: number;
}

const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : 0);

function filters(doc: PDFDocument, obj: PDFObject | undefined): string[] {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (v instanceof PDFName) return [v.asString()];
  if (v instanceof PDFArray) return v.asArray().map((x) => (x instanceof PDFName ? x.asString() : ''));
  return [];
}

function colorSpace(doc: PDFDocument, obj: PDFObject | undefined): 1 | 3 | 4 | null {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (v instanceof PDFName) {
    const n = v.asString();
    return n === '/DeviceRGB' || n === '/CalRGB' ? 3 : n === '/DeviceGray' || n === '/CalGray' ? 1 : n === '/DeviceCMYK' ? 4 : null;
  }
  if (v instanceof PDFArray && v.size() >= 2) {
    const kind = v.get(0);
    if (kind instanceof PDFName && kind.asString() === '/ICCBased') {
      const s = doc.context.lookup(v.get(1));
      const n = s instanceof PDFRawStream ? num(s.dict.get(PDFName.of('N'))) : 0;
      return n === 1 || n === 3 || n === 4 ? n : null;
    }
  }
  return null;
}

async function rawToPng(data: Uint8Array, width: number, height: number, comps: 1 | 3 | 4): Promise<Blob | null> {
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
    } else if (comps === 1) {
      out[o] = out[o + 1] = out[o + 2] = data[p]!;
    } else {
      // Naive CMYK → RGB conversion.
      const k = data[p + 3]! / 255;
      out[o] = 255 * (1 - data[p]! / 255) * (1 - k);
      out[o + 1] = 255 * (1 - data[p + 1]! / 255) * (1 - k);
      out[o + 2] = 255 * (1 - data[p + 2]! / 255) * (1 - k);
    }
    out[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  canvas.width = canvas.height = 0;
  return blob;
}

export async function extractPdfImages(
  source: Uint8Array,
  baseName: string,
  minSize: number,
  onProgress?: (p: number) => void,
): Promise<{ images: ExtractedImage[]; skipped: number; total: number }> {
  const doc = await loadPdf(source);
  const streams: PDFRawStream[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype instanceof PDFName && subtype.asString() === '/Image') streams.push(obj);
  }
  const images: ExtractedImage[] = [];
  let skipped = 0;
  for (const [i, stream] of streams.entries()) {
    onProgress?.(i / Math.max(1, streams.length));
    const d = stream.dict;
    const width = num(d.get(PDFName.of('Width')));
    const height = num(d.get(PDFName.of('Height')));
    if (width < minSize || height < minSize) continue; // icons, masks and spacer pixels
    if (d.get(PDFName.of('ImageMask'))?.toString() === 'true') continue;
    const f = filters(doc, d.get(PDFName.of('Filter')));
    const n = String(images.length + 1).padStart(3, '0');
    if (f.length === 1 && f[0] === '/DCTDecode') {
      images.push({ name: `${baseName}-image-${n}.jpg`, blob: new Blob([stream.contents as BlobPart], { type: 'image/jpeg' }), width, height });
    } else if (f.length === 1 && f[0] === '/JPXDecode') {
      images.push({ name: `${baseName}-image-${n}.jp2`, blob: new Blob([stream.contents as BlobPart], { type: 'image/jp2' }), width, height });
    } else if ((f.length === 1 && f[0] === '/FlateDecode') || f.length === 0) {
      const bpc = num(d.get(PDFName.of('BitsPerComponent')));
      const comps = colorSpace(doc, d.get(PDFName.of('ColorSpace')));
      const params = d.get(PDFName.of('DecodeParms'));
      if (bpc !== 8 || !comps || params) {
        skipped++;
        continue;
      }
      try {
        const raw = f.length ? unzlibSync(stream.contents) : stream.contents;
        const png = await rawToPng(raw, width, height, comps);
        if (png) images.push({ name: `${baseName}-image-${n}.png`, blob: png, width, height });
        else skipped++;
      } catch {
        skipped++;
      }
    } else {
      skipped++;
    }
  }
  onProgress?.(1);
  return { images, skipped, total: streams.length };
}
