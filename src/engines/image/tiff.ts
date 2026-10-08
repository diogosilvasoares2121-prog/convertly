import UTIF from 'utif';
import { AppError } from '../../core/errors';
import { quietSync } from '../../utils/quiet';

/**
 * TIFF decoding with UTIF.js (MIT). Supports uncompressed, LZW, PackBits,
 * Deflate and JPEG-in-TIFF images. Only the first page of multi-page TIFFs is used.
 */
export function decodeTiff(buffer: ArrayBuffer): { image: ImageData; pages: number } {
  try {
    return quietSync(() => decode(buffer));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('corrupted-file', err instanceof Error ? err.message : 'TIFF decode failed');
  }
}

function decode(buffer: ArrayBuffer): { image: ImageData; pages: number } {
  const ifds = UTIF.decode(buffer);
  const pages = ifds.filter((ifd) => 't256' in ifd && 't257' in ifd);
  const first = pages[0];
  if (!first) throw new AppError('corrupted-file', 'No image in TIFF');
  UTIF.decodeImage(buffer, first, ifds);
  const width = first.width;
  const height = first.height;
  if (!width || !height) throw new AppError('corrupted-file', 'Invalid TIFF dimensions');
  if (width * height > 268_000_000) throw new AppError('browser-limitation', 'Image too large');
  const rgba = UTIF.toRGBA8(first);
  if (rgba.length < width * height * 4) throw new AppError('corrupted-file', 'Unsupported TIFF encoding');
  const data = new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, width * height * 4);
  return { image: new ImageData(data, width, height), pages: pages.length };
}
